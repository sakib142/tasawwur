import type { WordCue } from "./types.ts";

/**
 * Estimate word timings when a provider does not report them.
 *
 * Distributes the audio across words by length rather than evenly — "a" and
 * "extraordinary" plainly do not take the same time to say. Longer words also
 * get proportionally less time than their letter count suggests, because
 * speaking rate per character falls as words get longer.
 *
 * This is good enough for sentence captions. It is NOT good enough for
 * word-by-word captions, where being 200ms out is visible on every word.
 */
export function estimateCues(text: string, durationSeconds: number): WordCue[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || durationSeconds <= 0) return [];

  // Square root compresses the range: a 12-letter word takes roughly twice as
  // long as a 3-letter one, not four times.
  const weights = words.map((w) => Math.sqrt(w.replace(/[^\p{L}\p{N}]/gu, "").length || 1));
  const total = weights.reduce((n, w) => n + w, 0);

  const cues: WordCue[] = [];
  let at = 0;
  for (let i = 0; i < words.length; i++) {
    const span = (weights[i]! / total) * durationSeconds;
    cues.push({ start: at, end: at + span, text: words[i]! });
    at += span;
  }
  return cues;
}
