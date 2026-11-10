import type { VideoAspect } from "@tasawwur/schema";
import { type Clip, searchPixabay } from "./pixabay.ts";
import { relevance, sentences } from "./relevance.ts";
import { paceShotSeconds, type Pace } from "./render/rhythm.ts";

/**
 * Choosing and ordering the clips for a video, before anything is rendered.
 *
 * The renderer, given a list of local materials in sequential mode, uses them
 * in exactly the order supplied and takes one cut from each. So a storyboard is
 * simply that list — which means it can be shown, rearranged, and rendered
 * without the renderer making any choices of its own.
 */

export interface Shot {
  /** Stable across reorders, so the UI can track rows. */
  id: string;
  /** Which search term produced it. */
  term: string;
  clip: Clip;
  /** Other results from the same term, for swapping. Thumbnails only. */
  alternatives: Clip[];
  /** The line this shot is expected to sit under, when a script was given. */
  line?: string;
  /** How well the clip's tags match that line, 0 to 1. */
  match?: number;
}

export interface Storyboard {
  shots: Shot[];
  /** Seconds each shot occupies — one value for all, as the renderer requires. */
  clipDuration: number;
  /** Total footage time the arrangement provides. */
  totalSeconds: number;
  /** What it needs to cover. */
  narrationSeconds: number;
  /** Terms that returned nothing usable, so the UI can say which. */
  emptyTerms: string[];
}

export interface BuildOptions {
  apiKey: string;
  terms: string[];
  /** Estimated from the script; exact timing needs TTS and is not worth a round trip. */
  narrationSeconds: number;
  clipDuration: number;
  /** Used to match each shot to the line it will cover. Optional. */
  script?: string;
  /** A snappier cut needs more clips to cover the same narration. */
  pace?: Pace;
  aspect?: VideoAspect;
  signal?: AbortSignal;
}

/**
 * What reusing a contributor costs, in units of relevance.
 *
 * Diversity exists because one contributor supplied five of fourteen clips in
 * an early render and the result looked repetitive. Relevance exists because
 * a calm river under "it meets a cliff, and it falls" looks worse still.
 * Neither should win outright: at 0.35 a clip has to match the line markedly
 * better to be worth repeating a creator for.
 */
const REPEAT_CREATOR_COST = 0.35;

/** Words per second at a natural narration pace, matching the term checker. */
export const WORDS_PER_SECOND = 2.6;

export function estimateNarrationSeconds(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_SECOND));
}

/**
 * Choose shots, round-robin across terms and preferring unseen creators.
 *
 * Two failure modes this is built to avoid, both observed in real renders:
 * exhausting one keyword before touching the next, which makes the footage stop
 * following the script; and letting one contributor supply most of the clips,
 * which is invisible in a result count and obvious in the finished video.
 */
function chooseShots(
  byTerm: Map<string, Clip[]>,
  wanted: number,
  lines: string[] = [],
): { shots: Omit<Shot, "id">[]; leftovers: Map<string, Clip[]> } {
  const remaining = new Map([...byTerm].map(([term, clips]) => [term, [...clips]]));
  const usedCreators = new Set<string>();
  const usedClipIds = new Set<number>();
  const shots: Omit<Shot, "id">[] = [];

  // Round-robin: one pass takes at most one clip from each term in turn.
  while (shots.length < wanted) {
    let tookAny = false;

    for (const [term, clips] of remaining) {
      if (shots.length >= wanted) break;
      if (clips.length === 0) continue;

      // Shots are cut on sentence ends, so shot n sits under line n. With no
      // script there is no line, every candidate scores zero, and selection
      // falls back to creator diversity and the provider's own ordering.
      const line = lines.length > 0 ? lines[shots.length % lines.length]! : "";

      let index = -1;
      let best = -Infinity;
      for (const [at, clip] of clips.entries()) {
        if (usedClipIds.has(clip.id)) continue;
        const score =
          (line ? relevance(clip.tags, line) : 0) -
          (usedCreators.has(clip.creator) ? REPEAT_CREATOR_COST : 0) -
          // The provider ranked these by its own relevance; keep that as the
          // tiebreak so an unscored set comes back in the order it arrived.
          at * 0.001;
        if (score > best) {
          best = score;
          index = at;
        }
      }
      if (index === -1) continue;

      const [chosen] = clips.splice(index, 1);
      if (!chosen) continue;

      usedCreators.add(chosen.creator);
      usedClipIds.add(chosen.id);
      shots.push({
        term,
        clip: chosen,
        alternatives: [],
        ...(line ? { line, match: relevance(chosen.tags, line) } : {}),
      });
      tookAny = true;
    }

    // Every term is exhausted; stop rather than spinning.
    if (!tookAny) break;
  }

  return { shots, leftovers: remaining };
}

/**
 * Build a storyboard. Searches only — nothing is downloaded.
 *
 * Thumbnails come back with the search response, so a whole arrangement can be
 * shown and rearranged at no bandwidth cost. Files are fetched only on commit.
 */
export async function buildStoryboard(opts: BuildOptions): Promise<Storyboard> {
  const { apiKey, terms, narrationSeconds, clipDuration, script = "", pace = "even", aspect = "9:16", signal } = opts;

  const cleaned = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  if (cleaned.length === 0) {
    throw new Error("Add at least one search term before previewing clips.");
  }

  const results = await Promise.all(
    cleaned.map(async (term) => {
      try {
        return [term, await searchPixabay(term, { apiKey, aspect, signal })] as const;
      } catch {
        return [term, [] as Clip[]] as const;
      }
    }),
  );

  const byTerm = new Map(results);
  const emptyTerms = results.filter(([, clips]) => clips.length === 0).map(([t]) => t);

  // One spare: the renderer trims to the narration, and running a shot short is
  // worse than having one too many. Shots are shorter at a snappy pace, so the
  // same narration needs more of them.
  const shotSeconds = paceShotSeconds(clipDuration, pace);
  const wanted = Math.ceil(narrationSeconds / shotSeconds) + 1;
  const { shots, leftovers } = chooseShots(byTerm, wanted, sentences(script));

  return {
    shots: shots.map((shot, i) => ({
      ...shot,
      id: `${shot.clip.id}-${i}`,
      alternatives: (leftovers.get(shot.term) ?? []).slice(0, 8),
    })),
    clipDuration: shotSeconds,
    totalSeconds: shots.length * shotSeconds,
    narrationSeconds,
    emptyTerms,
  };
}

/** Does the arrangement cover the narration, or will clips repeat? */
export function coversNarration(board: Pick<Storyboard, "totalSeconds" | "narrationSeconds">) {
  return board.totalSeconds >= board.narrationSeconds;
}

/** How many distinct contributors the arrangement draws on. */
export function creatorSpread(shots: Shot[]): { creators: number; dominance: number } {
  if (shots.length === 0) return { creators: 0, dominance: 0 };
  const counts = new Map<string, number>();
  for (const s of shots) counts.set(s.clip.creator, (counts.get(s.clip.creator) ?? 0) + 1);
  const top = Math.max(...counts.values());
  return { creators: counts.size, dominance: top / shots.length };
}
