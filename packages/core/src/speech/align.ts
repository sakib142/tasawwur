import type { WordCue } from "./types.ts";

/**
 * Restore punctuation to a word timeline.
 *
 * Speech services report *spoken* words, so the timeline comes back stripped:
 * "Why is the sky blue Sunlight looks white". Without punctuation there is
 * nothing to break sentences on, and captions get cut mid-phrase on length
 * alone. The script is still available, so the words are matched back onto it
 * and the written form wins.
 *
 * The walk is tolerant: a word that cannot be matched keeps its spoken form and
 * the scan moves on, so one mismatch does not shift everything after it.
 */
const normalise = (word: string) =>
  word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function alignCuesToText(cues: WordCue[], text: string): WordCue[] {
  const source = text.trim().split(/\s+/).filter(Boolean);
  if (source.length === 0 || cues.length === 0) return cues;

  const aligned: WordCue[] = [];
  let at = 0;

  for (const cue of cues) {
    const target = normalise(cue.text);

    // Look ahead a little: a service may merge or expand the odd token
    // ("twenty-one" spoken as one word, "2024" as several).
    let found = -1;
    for (let i = at; i < Math.min(at + 4, source.length); i++) {
      if (normalise(source[i]!) === target) {
        found = i;
        break;
      }
    }

    if (found === -1) {
      aligned.push(cue); // keep the spoken form rather than guessing
      continue;
    }

    // Words skipped over belong to the previous cue — attach them so no text
    // is silently dropped from the captions.
    if (found > at && aligned.length > 0) {
      const previous = aligned[aligned.length - 1]!;
      previous.text = [previous.text, ...source.slice(at, found)].join(" ");
    }

    aligned.push({ ...cue, text: source[found]! });
    at = found + 1;
  }

  // Anything left over is trailing punctuation or a final word the service
  // elided; append it so the captions end with the script.
  if (at < source.length && aligned.length > 0) {
    const last = aligned[aligned.length - 1]!;
    last.text = [last.text, ...source.slice(at)].join(" ");
  }

  return aligned;
}
