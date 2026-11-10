import type { Storyboard } from "./storyboard.ts";

/**
 * Whether a script can actually be illustrated, line by line.
 *
 * The term check answers "is there footage for these words". It does not
 * answer the question anyone actually has, which is "can this script be made".
 * A coffee advert set in Riyadh passed every term it was given and produced
 * eighteen seconds of snow and the wrong cities, and the only way to find out
 * was to watch it.
 *
 * This reads a storyboard back the other way: here is each line, here is what
 * was found for it, and here is where nothing was found at all. It costs
 * nothing — the storyboard has already been built — and it is the difference
 * between discovering the limit now and discovering it in the finished file.
 */

export interface LineCoverage {
  /** The line of script this shot sits under. */
  line: string;
  /** The search term the footage came from. */
  term: string;
  /** How well the clip's tags answer the line, 0-1. */
  match: number;
  /** Nothing in the footage relates to this line. */
  unmatched: boolean;
}

export interface ScriptCoverage {
  lines: LineCoverage[];
  /** Lines with footage that has nothing to do with them. */
  unmatched: number;
  /** Distinct contributors across the whole arrangement. */
  creators: number;
  /** Share of shots from the single most used contributor, 0-1. */
  dominance: number;
  verdict: "ready" | "thin" | "mismatched";
  advice: string;
}

/**
 * A line is only reported as unmatched when it had something to match with.
 *
 * "You went anyway" contains no concrete word at all, so no footage on earth
 * could answer it and counting it as a failure would be noise. Lines like
 * that are carried by the shot around them, which is how writing works.
 */
function couldMatch(line: string): boolean {
  return line.trim().length > 0;
}

export function describeCoverage(board: Storyboard): ScriptCoverage {
  const lines: LineCoverage[] = board.shots.map((shot) => ({
    line: shot.line ?? "",
    term: shot.term,
    match: shot.match ?? 0,
    unmatched: couldMatch(shot.line ?? "") && (shot.match ?? 0) === 0,
  }));

  const counts = new Map<string, number>();
  for (const shot of board.shots) {
    counts.set(shot.clip.creator, (counts.get(shot.clip.creator) ?? 0) + 1);
  }
  const dominance = board.shots.length
    ? Math.max(...counts.values()) / board.shots.length
    : 0;

  const unmatched = lines.filter((l) => l.unmatched).length;
  const short = board.totalSeconds < board.narrationSeconds;

  // Ordered by how badly each spoils the result. Footage about the wrong
  // thing is worse than too little of the right thing, which is worse than
  // one contributor shooting all of it.
  if (unmatched > lines.length / 2 && lines.length > 1) {
    return {
      lines,
      unmatched,
      creators: counts.size,
      dominance,
      verdict: "mismatched",
      advice:
        `${unmatched} of ${lines.length} lines have footage that does not relate to them. ` +
        `The library does not hold what this script is about — either write toward what ` +
        `it does hold, or supply your own footage.`,
    };
  }

  if (short) {
    return {
      lines,
      unmatched,
      creators: counts.size,
      dominance,
      verdict: "thin",
      advice:
        `Only ${board.totalSeconds}s of footage for ${board.narrationSeconds}s of ` +
        `narration, so clips will repeat. Add a search term.`,
    };
  }

  return {
    lines,
    unmatched,
    creators: counts.size,
    dominance,
    verdict: "ready",
    advice: unmatched
      ? unmatched === 1
        ? "1 line relies on the shot around it, which is usually fine."
        : `${unmatched} lines rely on the shots around them, which is usually fine.`
      : `Every line has footage that relates to it, from ${counts.size} contributors.`,
  };
}
