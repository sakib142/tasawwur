import { estimateCues } from "./estimate.ts";
import { SpeechError, type SpeechOutput, type SpeechProvider, type SpeechRequest } from "./types.ts";

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
   * Captions are therefore estimated from word length. That is fine for
   * sentence captions and visibly off for word-by-word ones, which is exactly
   * why this is declared rather than assumed.
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

    const chosen = voice in model.voices ? voice : "af_heart";
    const result = await model.generate(trimmed, { voice: chosen, speed: rate });

    const durationSeconds = result.audio.length / result.sampling_rate;
    return {
      audio: toWav(result.audio, result.sampling_rate),
      format: "wav",
      // Estimated, not measured. Honest about which it is.
      cues: estimateCues(trimmed, durationSeconds),
    };
  },
};

/** Voices the model ships with, when it is installed. */
export async function listKokoroVoices(): Promise<string[]> {
  return Object.keys((await loadModel()).voices);
}
