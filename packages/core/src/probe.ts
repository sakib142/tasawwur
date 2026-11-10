import type { VideoAspect } from "@tasawwur/schema";
import { type Clip, searchPixabay } from "./pixabay.ts";
import { termCoverage } from "./relevance.ts";

/**
 * Score search terms before committing a script to them.
 *
 * Measured while testing: three videos were generated with an identical,
 * working pipeline, and only one was good. The two failures shared a cause —
 * a single contributor supplied most of the clips for the strongest term, so
 * the footage was repetitive or wildly off-topic. Result counts hide this
 * completely. Creator spread exposes it.
 *
 * Counting is not enough on its own either. The provider matches loosely, on
 * any word rather than all of them, so a term can come back full and come back
 * wrong. "cold brew" returned four clips from three creators — winter, snow,
 * frost, and a father playing with a baby in the snow, with no coffee in any
 * of them — and this reported "plenty of variety" and a tick. A whole advert
 * was built on that before anyone saw a frame.
 */
export type Verdict = "good" | "thin" | "dominated" | "partial" | "empty";

export interface TermReport {
  term: string;
  /** Usable clips at the requested aspect, after filtering. */
  clips: number;
  distinctCreators: number;
  /** Share of results from the single most prolific contributor, 0-1. */
  dominance: number;
  topCreator: string | null;
  /** Clips Pixabay flagged as AI-generated, excluded from `clips`. */
  aiGeneratedExcluded: number;
  /** Words of the term the results do not answer at all. */
  ignoredWords: string[];
  /** Total seconds of footage available — how much timeline this can fill. */
  totalSeconds: number;
  verdict: Verdict;
  advice: string;
  sample: Clip[];
  error?: string;
}

export interface ProbeOptions {
  apiKey: string;
  aspect?: VideoAspect;
  /** Fewer usable clips than this is too thin to carry a term. */
  minClips?: number;
  /** Reject when one creator supplies more than this share. */
  maxDominance?: number;
  /**
   * A word answered by fewer than this share of results counts as ignored.
   *
   * Low on purpose. Tags are patchy, so a word can be under-represented and
   * still be what the footage is about; this is meant to catch a word the
   * search dropped entirely, not to grade how well it was honoured.
   */
  minWordShare?: number;
  signal?: AbortSignal;
}

function judge(
  term: string,
  clips: Clip[],
  minClips: number,
  maxDominance: number,
  minWordShare: number,
): {
  verdict: Verdict;
  dominance: number;
  topCreator: string | null;
  ignoredWords: string[];
  advice: string;
} {
  const coverage = termCoverage(term, clips.map((c) => c.tags));
  const ignoredWords = coverage.filter((c) => c.share < minWordShare).map((c) => c.word);
  const answered = coverage.filter((c) => c.share >= minWordShare).map((c) => c.word);

  if (clips.length === 0) {
    return {
      verdict: "empty",
      dominance: 0,
      topCreator: null,
      ignoredWords: [],
      advice: "No usable footage at this aspect ratio. Try a broader or more visual word.",
    };
  }

  const byCreator = new Map<string, number>();
  for (const c of clips) byCreator.set(c.creator, (byCreator.get(c.creator) ?? 0) + 1);

  const [topCreator, topCount] = [...byCreator.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const dominance = topCount / clips.length;

  // Said before anything about counts: a term can come back full and come
  // back about something else entirely, and that is the failure that reaches
  // the finished video looking deliberate.
  if (ignoredWords.length > 0 && answered.length > 0) {
    return {
      verdict: "partial",
      dominance,
      topCreator,
      ignoredWords,
      advice:
        `The search ignored ${ignoredWords.map((w) => `"${w}"`).join(" and ")} — these ` +
        `clips match ${answered.map((w) => `"${w}"`).join(" and ")} only. Fine if that ` +
        `is the subject; not if it is the adjective.`,
    };
  }

  if (dominance > maxDominance && clips.length > 1) {
    return {
      verdict: "dominated",
      dominance,
      topCreator,
      ignoredWords,
      advice:
        `${topCount} of ${clips.length} clips are by ${topCreator}, so the footage will ` +
        `look repetitive. Try a different wording.`,
    };
  }

  if (clips.length < minClips) {
    return {
      verdict: "thin",
      dominance,
      topCreator,
      ignoredWords,
      advice: `Only ${clips.length} usable clips — fine as a supporting term, not as a main one.`,
    };
  }

  return {
    verdict: "good",
    dominance,
    topCreator,
    ignoredWords,
    advice: `${clips.length} clips from ${byCreator.size} creators. Plenty of variety.`,
  };
}

/** Probe a single term. Never throws — failures come back as a report. */
export async function probeTerm(term: string, opts: ProbeOptions): Promise<TermReport> {
  const {
    apiKey, aspect = "9:16", minClips = 4, maxDominance = 0.5, minWordShare = 0.2, signal,
  } = opts;

  const base = {
    term,
    clips: 0,
    distinctCreators: 0,
    dominance: 0,
    topCreator: null,
    aiGeneratedExcluded: 0,
    ignoredWords: [] as string[],
    totalSeconds: 0,
    sample: [] as Clip[],
  };

  try {
    // One request, filtered in memory. Probing eight terms would otherwise burn
    // sixteen of the hundred-per-minute budget, and the only reason for a second
    // pass was to count what the first had already seen.
    const all = await searchPixabay(term, {
      apiKey,
      aspect,
      excludeAiGenerated: false,
      signal,
    });
    const usable = all.filter((c) => !c.aiGenerated);

    const { verdict, dominance, topCreator, ignoredWords, advice } = judge(
      term, usable, minClips, maxDominance, minWordShare,
    );

    return {
      ...base,
      clips: usable.length,
      distinctCreators: new Set(usable.map((c) => c.creator)).size,
      dominance,
      topCreator,
      ignoredWords,
      aiGeneratedExcluded: all.length - usable.length,
      totalSeconds: Math.round(usable.reduce((n, c) => n + c.durationSeconds, 0)),
      verdict,
      advice,
      sample: usable.slice(0, 4),
    };
  } catch (cause) {
    return {
      ...base,
      verdict: "empty",
      advice: "Could not check this term.",
      error: cause instanceof Error ? cause.message : "unknown error",
    };
  }
}

export interface ProbeSummary {
  reports: TermReport[];
  /** Usable clips across all good and thin terms, deduplicated by clip id. */
  uniqueClips: number;
  /** Seconds of distinct footage available — compare against narration length. */
  uniqueSeconds: number;
  verdict: "ready" | "risky";
  advice: string;
}

/**
 * Probe a set of terms together.
 *
 * Deduplicates across terms, because overlapping terms returning the same clip
 * inflate a per-term count without adding any variety to the finished video.
 */
export async function probeTerms(
  terms: string[],
  opts: ProbeOptions,
): Promise<ProbeSummary> {
  const cleaned = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  const reports = await Promise.all(cleaned.map((t) => probeTerm(t, opts)));

  const seen = new Map<number, Clip>();
  for (const r of reports) {
    if (r.verdict === "dominated" || r.verdict === "empty") continue;
    for (const c of r.sample) seen.set(c.id, c);
  }

  const good = reports.filter((r) => r.verdict === "good").length;
  const bad = reports.filter((r) => r.verdict === "dominated" || r.verdict === "empty");
  // Not failures, but not something to render without looking at.
  const partial = reports.filter((r) => r.verdict === "partial");

  const uniqueSeconds = [...seen.values()].reduce((n, c) => n + c.durationSeconds, 0);
  const ready = good >= 2 && bad.length < reports.length / 2;

  return {
    reports,
    uniqueClips: seen.size,
    uniqueSeconds: Math.round(uniqueSeconds),
    verdict: ready ? "ready" : "risky",
    advice: ready
      ? partial.length
        ? `${good} strong terms, but check ${partial.map((r) => `"${r.term}"`).join(", ")} — ` +
          `the search only honoured part of each.`
        : `${good} strong terms. Good footage variety.`
      : bad.length
        ? `Replace ${bad.map((r) => `"${r.term}"`).join(", ")} — they repeat one creator or find nothing.`
        : "Add a couple more terms so the footage has variety.",
  };
}
