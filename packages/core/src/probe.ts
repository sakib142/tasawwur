import type { VideoAspect } from "@tasawwur/schema";
import { type Clip, searchPixabay } from "./pixabay.ts";

/**
 * Score search terms before committing a script to them.
 *
 * Measured while testing: three videos were generated with an identical,
 * working pipeline, and only one was good. The two failures shared a cause —
 * a single contributor supplied most of the clips for the strongest term, so
 * the footage was repetitive or wildly off-topic. Result counts hide this
 * completely. Creator spread exposes it.
 */
export type Verdict = "good" | "thin" | "dominated" | "empty";

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
  signal?: AbortSignal;
}

function judge(
  clips: Clip[],
  minClips: number,
  maxDominance: number,
): { verdict: Verdict; dominance: number; topCreator: string | null; advice: string } {
  if (clips.length === 0) {
    return {
      verdict: "empty",
      dominance: 0,
      topCreator: null,
      advice: "No usable footage at this aspect ratio. Try a broader or more visual word.",
    };
  }

  const byCreator = new Map<string, number>();
  for (const c of clips) byCreator.set(c.creator, (byCreator.get(c.creator) ?? 0) + 1);

  const [topCreator, topCount] = [...byCreator.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const dominance = topCount / clips.length;

  if (dominance > maxDominance && clips.length > 1) {
    return {
      verdict: "dominated",
      dominance,
      topCreator,
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
      advice: `Only ${clips.length} usable clips — fine as a supporting term, not as a main one.`,
    };
  }

  return {
    verdict: "good",
    dominance,
    topCreator,
    advice: `${clips.length} clips from ${byCreator.size} creators. Plenty of variety.`,
  };
}

/** Probe a single term. Never throws — failures come back as a report. */
export async function probeTerm(term: string, opts: ProbeOptions): Promise<TermReport> {
  const { apiKey, aspect = "9:16", minClips = 4, maxDominance = 0.5, signal } = opts;

  const base = {
    term,
    clips: 0,
    distinctCreators: 0,
    dominance: 0,
    topCreator: null,
    aiGeneratedExcluded: 0,
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

    const { verdict, dominance, topCreator, advice } = judge(usable, minClips, maxDominance);

    return {
      ...base,
      clips: usable.length,
      distinctCreators: new Set(usable.map((c) => c.creator)).size,
      dominance,
      topCreator,
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

  const uniqueSeconds = [...seen.values()].reduce((n, c) => n + c.durationSeconds, 0);
  const ready = good >= 2 && bad.length < reports.length / 2;

  return {
    reports,
    uniqueClips: seen.size,
    uniqueSeconds: Math.round(uniqueSeconds),
    verdict: ready ? "ready" : "risky",
    advice: ready
      ? `${good} strong terms. Good footage variety.`
      : bad.length
        ? `Replace ${bad.map((r) => `"${r.term}"`).join(", ")} — they add little or repeat one creator.`
        : "Add a couple more terms so the footage has variety.",
  };
}
