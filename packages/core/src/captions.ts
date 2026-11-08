import type { WordCue } from "./speech/types.ts";

/**
 * Turn a word timeline into subtitles.
 *
 * Two shapes, because they are read differently. Sentence captions are read;
 * word-by-word captions are watched. Sentence captions need to be short enough
 * to take in at a glance and must break at natural pauses, not mid-phrase.
 */
export interface Cue {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface SentenceOptions {
  /** Characters per caption before it must break. Two readable lines. */
  maxChars?: number;
  /** A caption shorter than this is hard to read; merge it forward. */
  minSeconds?: number;
  /** A gap this long reads as a pause, and is a natural break. */
  pauseSeconds?: number;
}

const SENTENCE_END = /[.!?…]["')\]]?$/;
const CLAUSE_END = /[,;:—]$/;

/**
 * Group words into sentence captions.
 *
 * Breaks on sentence punctuation first, then on clause punctuation or an
 * audible pause, then on length. Breaking purely on length splits phrases in
 * the middle and reads badly.
 */
export function toSentenceCues(words: WordCue[], opts: SentenceOptions = {}): Cue[] {
  const { maxChars = 64, minSeconds = 0.7, pauseSeconds = 0.35 } = opts;
  if (words.length === 0) return [];

  const groups: WordCue[][] = [];
  let current: WordCue[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    current.push(word);

    const next = words[i + 1];
    const textSoFar = current.map((w) => w.text).join(" ");
    const gapAhead = next ? next.start - word.end : 0;

    const mustBreak = !next || textSoFar.length >= maxChars;
    const wantsBreak =
      SENTENCE_END.test(word.text) ||
      ((CLAUSE_END.test(word.text) || gapAhead >= pauseSeconds) &&
        textSoFar.length >= maxChars * 0.55);

    if (mustBreak || wantsBreak) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);

  // A caption too short to read gets folded into its neighbour.
  const merged: WordCue[][] = [];
  for (const group of groups) {
    const span = group[group.length - 1]!.end - group[0]!.start;
    const previous = merged[merged.length - 1];
    const previousText = previous?.map((w) => w.text).join(" ") ?? "";
    if (
      previous &&
      span < minSeconds &&
      previousText.length + group.map((w) => w.text).join(" ").length < maxChars
    ) {
      previous.push(...group);
    } else {
      merged.push(group);
    }
  }

  return merged.map((group, i) => ({
    index: i + 1,
    start: group[0]!.start,
    end: group[group.length - 1]!.end,
    text: group.map((w) => w.text).join(" "),
  }));
}

/**
 * One caption per word.
 *
 * A word's cue is extended to meet the next so nothing blinks off during a
 * short gap, which looks like a dropped frame rather than a pause.
 */
export function toWordCues(words: WordCue[], maxHoldSeconds = 0.4): Cue[] {
  return words.map((word, i) => {
    const next = words[i + 1];
    const end = next ? Math.min(next.start, word.end + maxHoldSeconds) : word.end;
    return {
      index: i + 1,
      start: word.start,
      end: Math.max(end, word.end),
      text: word.text,
    };
  });
}

/** SRT wants HH:MM:SS,mmm. */
export function formatTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const ms = Math.round(clamped * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/** Serialise cues as SRT. */
export function toSrt(cues: Cue[]): string {
  return (
    cues
      .map(
        (c) =>
          `${c.index}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text}`,
      )
      .join("\n\n") + "\n"
  );
}

/** Build subtitles in either shape from a word timeline. */
export function buildSubtitles(
  words: WordCue[],
  mode: "sentence" | "word_by_word",
  opts?: SentenceOptions,
): { cues: Cue[]; srt: string } {
  const cues = mode === "word_by_word" ? toWordCues(words) : toSentenceCues(words, opts);
  return { cues, srt: toSrt(cues) };
}
