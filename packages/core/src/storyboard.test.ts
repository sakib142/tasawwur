import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStoryboard,
  coversNarration,
  creatorSpread,
  estimateNarrationSeconds,
} from "./storyboard.ts";

/** One Pixabay hit. `creator` and `id` are what selection reasons about. */
function hit(creator: string, id = Math.floor(Math.random() * 1e6)) {
  return {
    id,
    pageURL: `https://pixabay.com/videos/id-${id}/`,
    duration: 12,
    tags: "water",
    user: creator,
    user_id: creator.length,
    isAiGenerated: false,
    isGRated: true,
    videos: {
      small: {
        url: `https://cdn/${id}.mp4`,
        width: 1080,
        height: 1920,
        size: 2_000_000,
        thumbnail: `https://cdn/${id}.jpg`,
      },
    },
  };
}

/** Each term returns its own creators. A fresh Response per call — bodies read once. */
function mockSearch(perTerm: Record<string, string[]>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const q = new URL(String(input)).searchParams.get("q") ?? "";
    const hits = (perTerm[q] ?? []).map((c) => hit(c));
    return new Response(JSON.stringify({ total: hits.length, totalHits: hits.length, hits }), {
      status: 200,
    });
  });
}

afterEach(() => vi.restoreAllMocks());

const base = { apiKey: "k", clipDuration: 5, narrationSeconds: 20 };

describe("estimateNarrationSeconds", () => {
  it("estimates from word count at narration pace", () => {
    expect(estimateNarrationSeconds("one two three four five six")).toBe(2);
    expect(estimateNarrationSeconds("")).toBe(1);
  });
});

describe("buildStoryboard", () => {
  it("chooses enough shots to cover the narration, plus one spare", async () => {
    // 20s of narration at 5s a shot needs four, and a spare guards against
    // running short, which is worse than one clip too many.
    mockSearch({ a: ["p1", "p2", "p3", "p4", "p5", "p6"] });
    const board = await buildStoryboard({ ...base, terms: ["a"] });
    expect(board.shots).toHaveLength(5);
    expect(coversNarration(board)).toBe(true);
  });

  it("round-robins across terms rather than exhausting one", async () => {
    // Taking everything from the first keyword stops the footage following
    // the script.
    mockSearch({ a: ["a1", "a2", "a3"], b: ["b1", "b2", "b3"], c: ["c1", "c2", "c3"] });
    const board = await buildStoryboard({ ...base, terms: ["a", "b", "c"] });
    expect(board.shots.slice(0, 3).map((s) => s.term)).toEqual(["a", "b", "c"]);
  });

  it("prefers creators it has not used yet", async () => {
    // The measured failure: one contributor supplied five of fourteen clips
    // and the finished video looked repetitive.
    mockSearch({ a: ["same", "same", "same", "fresh"] });
    const board = await buildStoryboard({ ...base, terms: ["a"], narrationSeconds: 10 });
    const { creators } = creatorSpread(board.shots);
    expect(creators).toBeGreaterThan(1);
  });

  it("falls back to a used creator rather than leaving the video short", async () => {
    // Variety is preferred, not required. Running out of footage is worse.
    mockSearch({ a: ["only", "only", "only", "only", "only"] });
    const board = await buildStoryboard({ ...base, terms: ["a"] });
    expect(board.shots.length).toBeGreaterThanOrEqual(4);
  });

  it("never repeats the same clip", async () => {
    mockSearch({ a: ["p1", "p2"], b: ["p3", "p4"] });
    const board = await buildStoryboard({ ...base, terms: ["a", "b"] });
    const ids = board.shots.map((s) => s.clip.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports terms that returned nothing instead of hiding them", async () => {
    mockSearch({ a: ["p1", "p2", "p3", "p4", "p5"], dud: [] });
    const board = await buildStoryboard({ ...base, terms: ["a", "dud"] });
    expect(board.emptyTerms).toEqual(["dud"]);
    expect(board.shots.length).toBeGreaterThan(0);
  });

  it("keeps the unused results as swap alternatives", async () => {
    mockSearch({ a: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"] });
    const board = await buildStoryboard({ ...base, terms: ["a"], narrationSeconds: 5 });
    expect(board.shots[0]!.alternatives.length).toBeGreaterThan(0);
  });

  it("stops rather than looping when every term is exhausted", async () => {
    mockSearch({ a: ["p1"] });
    const board = await buildStoryboard({ ...base, terms: ["a"], narrationSeconds: 60 });
    expect(board.shots).toHaveLength(1);
    expect(coversNarration(board)).toBe(false); // the UI warns; it does not hang
  });

  it("asks for terms rather than returning an empty board", async () => {
    mockSearch({});
    await expect(buildStoryboard({ ...base, terms: ["  ", ""] })).rejects.toThrow(
      /search term/i,
    );
  });

  it("gives every shot a stable id", async () => {
    mockSearch({ a: ["p1", "p2", "p3", "p4", "p5"] });
    const board = await buildStoryboard({ ...base, terms: ["a"] });
    expect(new Set(board.shots.map((s) => s.id)).size).toBe(board.shots.length);
  });
});

describe("creatorSpread", () => {
  it("reports dominance so a one-contributor board can be flagged", () => {
    const shot = (creator: string) =>
      ({ id: creator, term: "a", clip: { creator }, alternatives: [] }) as never;
    expect(creatorSpread([shot("x"), shot("x"), shot("y")])).toEqual({
      creators: 2,
      dominance: 2 / 3,
    });
    expect(creatorSpread([])).toEqual({ creators: 0, dominance: 0 });
  });
});

describe("matching clips to the script", () => {
  /** A hit whose tags and creator are both controllable. */
  function tagged(creator: string, tags: string, id: number) {
    return {
      id,
      pageURL: `https://pixabay.com/videos/id-${id}/`,
      duration: 12,
      tags,
      user: creator,
      user_id: id,
      isAiGenerated: false,
      isGRated: true,
      videos: {
        small: {
          url: `https://cdn/${id}.mp4`,
          width: 1080,
          height: 1920,
          size: 2_000_000,
          thumbnail: `https://cdn/${id}.jpg`,
        },
      },
    };
  }

  /** One term, returning a fixed candidate list in a fixed order. */
  function mockOneTerm(hits: ReturnType<typeof tagged>[]) {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ total: hits.length, totalHits: hits.length, hits }), {
          status: 200,
        }),
    );
  }

  const SCRIPT = "A river has no plan. It meets a cliff, and it falls.";

  it("puts the footage that fits the line under that line", async () => {
    // The calm shot is first in the provider's order, so without matching it
    // would take the opening line and the waterfall would follow it.
    mockOneTerm([
      tagged("ann", "lake, calm, reflection", 1),
      tagged("bob", "waterfall, cliff, falling water", 2),
      tagged("cal", "river, plan, meander", 3),
    ]);

    const board = await buildStoryboard({
      ...base,
      terms: ["water"],
      narrationSeconds: 10,
      script: SCRIPT,
    });

    expect(board.shots[1]!.clip.tags).toContain("waterfall");
    expect(board.shots[1]!.line).toBe("It meets a cliff, and it falls.");
  });

  it("reports how well each shot matched", async () => {
    mockOneTerm([tagged("ann", "river, water", 1), tagged("bob", "cliff, falls", 2)]);
    const board = await buildStoryboard({
      ...base,
      terms: ["water"],
      narrationSeconds: 10,
      script: SCRIPT,
    });
    for (const shot of board.shots) {
      expect(shot.match).toBeGreaterThanOrEqual(0);
      expect(shot.match).toBeLessThanOrEqual(1);
    }
  });

  it("still spreads across creators when nothing matches better", async () => {
    // Relevance must not override diversity on a tie — this is the failure
    // that made an early render look repetitive.
    mockOneTerm([
      tagged("ann", "water", 1),
      tagged("ann", "water", 2),
      tagged("ann", "water", 3),
      tagged("bob", "water", 4),
      tagged("cal", "water", 5),
    ]);

    const board = await buildStoryboard({
      ...base,
      terms: ["water"],
      narrationSeconds: 15,
      script: SCRIPT,
    });

    expect(creatorSpread(board.shots).creators).toBeGreaterThan(1);
  });

  it("keeps the provider's order when there is no script", async () => {
    // Nothing to match against, so the first result should still win.
    mockOneTerm([
      tagged("ann", "lake, calm", 1),
      tagged("bob", "waterfall, cliff", 2),
    ]);
    const board = await buildStoryboard({ ...base, terms: ["water"], narrationSeconds: 4 });
    expect(board.shots[0]!.clip.id).toBe(1);
    expect(board.shots[0]!.line).toBeUndefined();
  });

  it("never uses the same clip twice", async () => {
    mockOneTerm([
      tagged("ann", "cliff, falls", 1),
      tagged("bob", "cliff, falls", 2),
      tagged("cal", "cliff, falls", 3),
    ]);
    const board = await buildStoryboard({
      ...base,
      terms: ["water"],
      narrationSeconds: 15,
      script: SCRIPT,
    });
    const ids = board.shots.map((s) => s.clip.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
