/**
 * Speech providers.
 *
 * Synthesis is pluggable because providers differ in one way that matters: some
 * report when each word is spoken, and some only return audio. Word-accurate
 * captions are free with the first kind and estimated with the second, so the
 * capability is declared rather than assumed.
 */

export interface WordCue {
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
  text: string;
}

export interface SpeechOutput {
  audio: Uint8Array;
  /** Container of the returned bytes, so callers know what they are writing. */
  format: "mp3" | "wav";
  /** Present only when the provider reports word timings. */
  cues?: WordCue[];
}

export interface SpeechRequest {
  text: string;
  /** Provider-specific voice identifier. */
  voice: string;
  /** 1 is normal. */
  rate?: number;
  signal?: AbortSignal;
}

export interface SpeechProvider {
  readonly id: string;
  readonly label: string;
  /**
   * Whether this provider reports when each word is spoken.
   *
   * False means captions are estimated from word length, which is fine for
   * sentence captions and visibly wrong for word-by-word ones.
   */
  readonly wordTimings: boolean;
  /** Whether it can run right now — a missing model or key makes it false. */
  available(): Promise<boolean>;
  synthesize(request: SpeechRequest): Promise<SpeechOutput>;
}

export class SpeechError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeechError";
  }
}

/** A voice the speech provider can use. */
export interface Voice {
  /** Passed straight to the provider. */
  id: string;
  name: string;
  language: string;
  gender: "Male" | "Female";
  /**
   * The model authors' own rating, A through F. Quality varies a great deal
   * between voices, so this is surfaced rather than hidden.
   */
  grade: string;
}
