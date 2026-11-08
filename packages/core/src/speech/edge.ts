import { randomUUID } from "node:crypto";

/**
 * Speech synthesis over the Edge TTS WebSocket protocol.
 *
 * NOT EXPORTED AND NOT USABLE. Kept because the protocol work is correct and
 * worth preserving, but the service refuses the connection.
 *
 * Microsoft guards synthesis with a rotating token, Sec-MS-GEC. Its current
 * scheme (advertised as version "2-") produces a value of the form
 *
 *     EBBBAAB81C636B64-13669DF83499CF2E2312DA946D65E7617A98...
 *     └ 16 hex ──────┘ └ 64 hex ───────────────────────────┘
 *
 * where the older scheme was a bare SHA256 of the rounded FILETIME ticks plus
 * the client token. The leading component is undocumented, and the whole scheme
 * exists specifically to exclude independent clients — so it rotates. Chasing
 * it is ongoing maintenance for a keystone feature, which is the wrong trade.
 *
 * Everything else here works: frame format, SSML, binary audio parsing, and the
 * WordBoundary timeline. Only the handshake fails.
 *
 * The voice *catalogue* is unaffected — that endpoint is plain HTTPS and is
 * used by voices.ts.
 *
 * The audio is only half of what this returns. The other half is the word
 * timeline: Edge reports the offset and duration of every word it speaks, which
 * is what makes word-accurate captions free. Nothing has to transcribe the
 * result afterwards.
 */
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL =
  `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
  `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;

/** Edge reports time in 100-nanosecond ticks. */
const TICKS_PER_SECOND = 10_000_000;

export interface WordCue {
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
  text: string;
}

export interface SpeechResult {
  audio: Uint8Array;
  /** One cue per spoken word, in order. */
  cues: WordCue[];
  /**
   * Length of the audio Edge actually produced.
   *
   * Deliberately NOT the end of the last cue: Edge leaves a tail of silence
   * after the final word — around 0.9s regardless of length, which is a fifth
   * of a short clip. Sizing anything from the last cue under-counts, and in a
   * video that means footage running out before the narration does.
   */
  durationSeconds: number;
}

export interface SynthesizeOptions {
  /** e.g. "en-US-AvaNeural-Female" or "en-US-AvaNeural". */
  voice: string;
  /** 1 is normal. 0.9 is slightly slower. */
  rate?: number;
  /** 1 is normal pitch. */
  pitch?: number;
  volume?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class SpeechError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeechError";
  }
}

/** Strips the "-Female"/"-Male" suffix the catalogue ids carry. */
export function normaliseVoice(voice: string): string {
  return voice.replace(/-(Female|Male)$/i, "");
}

/** Edge wants a signed percentage; 1.0 must be "+0%", not "0%". */
function asPercent(value: number): string {
  const pct = Math.round((value - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSsml(text: string, opts: Required<Pick<SynthesizeOptions, "voice" | "rate" | "pitch" | "volume">>) {
  const voice = normaliseVoice(opts.voice);
  const locale = voice.split("-").slice(0, 2).join("-") || "en-US";
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${asPercent(opts.pitch)}' rate='${asPercent(opts.rate)}' volume='${asPercent(opts.volume)}'>` +
    `${escapeXml(text)}` +
    `</prosody></voice></speak>`
  );
}

/** Protocol frames are headers, a blank line, then a body. */
function frame(headers: Record<string, string>, body: string): string {
  const head = Object.entries(headers)
    .map(([k, v]) => `${k}:${v}`)
    .join("\r\n");
  return `${head}\r\n\r\n${body}`;
}

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\r\n")) {
    const at = line.indexOf(":");
    if (at > 0) out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return out;
}

/**
 * Synthesize speech and capture the word timeline.
 *
 * Resolves once the service signals the end of the turn.
 */
export function synthesize(text: string, opts: SynthesizeOptions): Promise<SpeechResult> {
  const trimmed = text.trim();
  if (!trimmed) return Promise.reject(new SpeechError("Nothing to speak."));

  const { voice, rate = 1, pitch = 1, volume = 1, timeoutMs = 60_000, signal } = opts;

  return new Promise<SpeechResult>((resolve, reject) => {
    const ws = new WebSocket(WSS_URL);
    ws.binaryType = "arraybuffer";

    const chunks: Uint8Array[] = [];
    const cues: WordCue[] = [];
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {
        // already closing
      }
      fn();
    };

    const fail = (message: string) => finish(() => reject(new SpeechError(message)));

    const timer = setTimeout(
      () => fail(`Speech synthesis timed out after ${Math.round(timeoutMs / 1000)}s.`),
      timeoutMs,
    );
    const onAbort = () => fail("Speech synthesis cancelled.");
    signal?.addEventListener("abort", onAbort, { once: true });

    ws.onopen = () => {
      ws.send(
        frame(
          {
            "X-Timestamp": new Date().toISOString(),
            "Content-Type": "application/json; charset=utf-8",
            Path: "speech.config",
          },
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: "false",
                    // The whole point: without this there is no timeline.
                    wordBoundaryEnabled: "true",
                  },
                  outputFormat: "audio-24khz-48kbitrate-mono-mp3",
                },
              },
            },
          }),
        ),
      );

      ws.send(
        frame(
          {
            "X-RequestId": randomUUID().replace(/-/g, ""),
            "Content-Type": "application/ssml+xml",
            "X-Timestamp": `${new Date().toISOString()}Z`,
            Path: "ssml",
          },
          buildSsml(trimmed, { voice, rate, pitch, volume }),
        ),
      );
    };

    ws.onmessage = (event) => {
      // Text frames carry metadata and control messages.
      if (typeof event.data === "string") {
        const split = event.data.indexOf("\r\n\r\n");
        const headers = parseHeaders(event.data.slice(0, split));
        const body = event.data.slice(split + 4);

        if (headers.path === "audio.metadata") {
          try {
            for (const item of JSON.parse(body).Metadata ?? []) {
              if (item.Type !== "WordBoundary") continue;
              const start = item.Data.Offset / TICKS_PER_SECOND;
              cues.push({
                start,
                end: start + item.Data.Duration / TICKS_PER_SECOND,
                text: item.Data.text.Text,
              });
            }
          } catch {
            // A malformed metadata frame costs one cue, not the whole run.
          }
        } else if (headers.path === "turn.end") {
          const audio = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let at = 0;
          for (const c of chunks) {
            audio.set(c, at);
            at += c.length;
          }
          if (audio.length === 0) {
            fail("The speech service returned no audio.");
            return;
          }
          finish(() =>
            resolve({
              audio,
              cues,
              // Measured from the file by the caller where exactness matters;
              // this is the timeline's own view and excludes the trailing
              // silence, so it is a floor rather than the true length.
              durationSeconds: cues.length ? cues[cues.length - 1]!.end : 0,
            }),
          );
        }
        return;
      }

      // Binary frames are [2-byte big-endian header length][header][audio].
      const view = new Uint8Array(event.data as ArrayBuffer);
      if (view.length < 2) return;
      const headerLength = (view[0]! << 8) | view[1]!;
      if (view.length > headerLength + 2) {
        chunks.push(view.subarray(headerLength + 2));
      }
    };

    ws.onerror = () =>
      fail("Could not reach the speech service. Check your network connection.");

    ws.onclose = (event) => {
      if (settled) return;
      fail(
        event.code === 1006
          ? "The speech service closed the connection unexpectedly."
          : `The speech service closed the connection (code ${event.code}).`,
      );
    };
  });
}
