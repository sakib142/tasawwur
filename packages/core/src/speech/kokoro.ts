import { estimateCues } from "./estimate.ts";
import { sentences } from "../relevance.ts";
import {
  SpeechError,
  type SpeechOutput,
  type SpeechProvider,
  type SpeechRequest,
  type WordCue,
} from "./types.ts";
import { DEFAULT_VOICE } from "./voices.ts";

/**
 * Kokoro — speech synthesis that runs on this machine.
 *
 * Apache-2.0 model, no account, no network after the first download, and
 * nothing anyone can revoke. That last point is the reason it is here: Edge TTS
 * is gated behind a rotating token specifically to exclude independent clients.
 *
 * NOT A DECLARED DEPENDENCY, deliberately. The ONNX runtime it pulls in is
 * roughly 400MB, which is a lot to force on someone who only wants to try the
 * interface. It is imported dynamically and reports itself unavailable when
 * absent, so the install is opt-in:
 *
 *     npm install kokoro-js --prefix packages/core
 *
 * (npm rather than pnpm: pnpm 10.15 runs out of heap extracting the runtime.)
 */

/** The slice of kokoro-js used here, declared locally since it may be absent. */
interface KokoroModel {
  voices: Record<string, { name?: string; language?: string; gender?: string }>;
  generate(
    text: string,
    options: { voice: string; speed?: number },
  ): Promise<{ audio: Float32Array; sampling_rate: number }>;
}

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/**
 * Held in a variable rather than written inline: a literal specifier would be
 * resolved at compile time, and this package must typecheck whether or not the
 * optional dependency is present.
 */
const PACKAGE = "kokoro-js";

let cached: Promise<KokoroModel> | null = null;

async function loadModel(): Promise<KokoroModel> {
  // Loading takes seconds and the model is tens of megabytes resident, so it is
  // loaded once and reused for the life of the process.
  cached ??= (async () => {
    let mod: { KokoroTTS: { from_pretrained(id: string, o: object): Promise<KokoroModel> } };
    try {
      mod = (await import(PACKAGE)) as never;
    } catch {
      throw new SpeechError(
        "Local speech is not installed. Run: npm install kokoro-js --prefix packages/core",
      );
    }
    // q8 keeps the model near 100MB and runs comfortably on CPU.
    return mod.KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: "cpu" });
  })();

  try {
    return await cached;
  } catch (error) {
    cached = null; // a failed load must not be cached forever
    throw error;
  }
}

/**
 * Silence between sentences.
 *
 * Kokoro is given the whole script at once by default and reads it straight
 * through, so sentences run into each other at an even clip and the result
 * sounds like something being recited rather than said. A short rest is most
 * of the difference. Divided by the speaking rate, because someone who has
 * asked for a faster read does not want the pauses left behind at full
 * length.
 */
const SENTENCE_GAP_SECONDS = 0.28;

/**
 * Quiet after the final word.
 *
 * The video is sized from the narration, so with the model's own padding
 * trimmed away the picture would cut out on the last syllable. Deliberate,
 * and the same every time, rather than however much the model happened to
 * leave behind.
 */
const END_PAD_SECONDS = 0.5;

/**
 * Strip the model's own silence from the ends of a generation.
 *
 * Kokoro pads what it returns with roughly three quarters of a second of
 * quiet. Given the whole script that happens once, at the end, and nobody
 * notices. Given a sentence at a time it happens between every sentence, and
 * the first attempt at adding rests produced pauses of nearly a second —
 * narration that dragged rather than breathed.
 *
 * A little is kept on each side: cutting to the exact first loud sample
 * clips the attack off a word and makes the speech sound bitten.
 */
function trimSilence(samples: Float32Array, sampleRate: number): Float32Array {
  const threshold = 0.012;
  const pad = Math.round(sampleRate * 0.03);

  let first = 0;
  while (first < samples.length && Math.abs(samples[first]!) < threshold) first++;
  if (first === samples.length) return samples; // all quiet; leave it alone

  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]!) < threshold) last--;

  return samples.subarray(Math.max(0, first - pad), Math.min(samples.length, last + pad + 1));
}

function concatAudio(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Minimal RIFF/WAVE header for 32-bit float PCM. */
function toWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 4;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // 3 = IEEE float
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 32, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    view.setFloat32(44 + i * bytesPerSample, samples[i]!, true);
  }
  return new Uint8Array(buffer);
}

export const kokoroProvider: SpeechProvider = {
  id: "kokoro",
  label: "Kokoro (runs on this machine)",

  /**
   * Kokoro returns audio and nothing else — no word boundaries.
   *
   * Still false, and for the same reason: individual words are placed by
   * estimating from their length, which is visibly off for word-by-word
   * captions. Sentence boundaries are a different matter — those are measured,
   * because each sentence is synthesised separately and its length is read
   * from the samples. So the estimate no longer drifts across a whole script,
   * only within one sentence.
   */
  wordTimings: false,

  async available() {
    try {
      await import(PACKAGE);
      return true;
    } catch {
      return false;
    }
  },

  async synthesize({ text, voice, rate = 1, signal }: SpeechRequest): Promise<SpeechOutput> {
    const trimmed = text.trim();
    if (!trimmed) throw new SpeechError("Nothing to speak.");

    const model = await loadModel();
    if (signal?.aborted) throw new SpeechError("Speech synthesis cancelled.");

    // Falling back rather than failing, because losing a three-minute render
    // over a voice name is worse than an unexpected voice. But say so — a
    // silent substitution here is what let the picker offer voices this model
    // could not speak, with nothing in the output to show it.
    const chosen = voice in model.voices ? voice : DEFAULT_VOICE;
    if (chosen !== voice) {
      console.warn(
        `[speech] no voice "${voice}"; using "${chosen}". Valid ids come from KOKORO_VOICES.`,
      );
    }
    /*
     * Spoken a sentence at a time.
     *
     * Two things fall out of this. The obvious one is that a rest can be put
     * between sentences. The useful one is that each sentence's position in
     * the audio stops being a guess: its length is measured from the samples
     * that came back. Shots are cut on sentence ends, so those boundaries
     * being exact rather than estimated is the difference between a cut that
     * lands on the pause and one that lands near it.
     *
     * Words within a sentence are still estimated. The drift that causes no
     * longer accumulates across the whole script, though — it is reset at
     * every full stop.
     */
    const lines = sentences(trimmed);
    const spoken = lines.length > 0 ? lines : [trimmed];
    const gap = SENTENCE_GAP_SECONDS / Math.max(rate, 0.1);

    const parts: Float32Array[] = [];
    const cues: WordCue[] = [];
    let sampleRate = 24_000;
    let at = 0;

    for (const [index, line] of spoken.entries()) {
      if (signal?.aborted) throw new SpeechError("Speech synthesis cancelled.");

      const result = await model.generate(line, { voice: chosen, speed: rate });
      sampleRate = result.sampling_rate;
      const audio = trimSilence(result.audio, sampleRate);
      const durationSeconds = audio.length / sampleRate;
      const last = index === spoken.length - 1;

      for (const word of estimateCues(line, durationSeconds)) {
        cues.push({ start: at + word.start, end: at + word.end, text: word.text });
      }
      // Hold the last word through the rest that follows it. Otherwise the
      // caption blinks off into the silence, and the cut taken at this
      // boundary lands on the final syllable instead of after it.
      const tail = cues[cues.length - 1];
      if (tail && !last) tail.end = at + durationSeconds + gap;

      parts.push(audio);
      at += durationSeconds;

      const rest = last ? END_PAD_SECONDS : gap;
      parts.push(new Float32Array(Math.round(rest * sampleRate)));
      at += rest;
    }

    return { audio: toWav(concatAudio(parts), sampleRate), format: "wav", cues };
  },
};

/** Voices the model ships with, when it is installed. */
export async function listKokoroVoices(): Promise<string[]> {
  return Object.keys((await loadModel()).voices);
}
