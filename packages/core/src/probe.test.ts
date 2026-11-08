import { afterEach, describe, expect, it, vi } from "vitest";
import { probeTerm, probeTerms, searchPixabay } from "./index.ts";

/** Minimal Pixabay hit; overrides let each test vary one thing. */
function hit(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: Math.floor(Math.random() * 1e6),
    pageURL: "https://pixabay.com/videos/id-1/",
    duration: 10,
    tags: "water, river",
    user: "alice",
    user_id: 1,
    isAiGenerated: false,
    isGRated: true,
    isLowQuality: false,
    videos: {
      large: { url: "https://x/large.mp4", width: 2160, height: 3840, size: 200_000_000 },
      small: { url: "https://x/small.mp4", width: 1080, height: 1920, size: 20_000_000 },
      tiny: { url: "https://x/tiny.mp4", width: 720, height: 1280, size: 5_000_000 },
    },
    ...over,
  };
}

/**
 * A Response body can only be read once, so every call must get a fresh one.
 * Returning a single shared Response silently breaks the second caller.
 */
function mockHits(hits: unknown[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ total: hits.length, totalHits: hits.length, hits }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("searchPixabay", () => {
  it("picks the smallest rendition that still meets the target size", async () => {
    // The 4K rendition is 200MB for no visible gain at 1080x1920 output, and
    // large files have blown download caps in practice.
    mockHits([hit()]);
    const [clip] = await searchPixabay("river", { apiKey: "k", aspect: "9:16" });
    expect(clip!.width).toBe(1080);
    expect(clip!.bytes).toBe(20_000_000);
  });

  it("rejects clips with no rendition at the requested orientation", async () => {
    mockHits([
      hit({ videos: { large: { url: "u", width: 3840, height: 2160 } } }), // landscape only
    ]);
    expect(await searchPixabay("river", { apiKey: "k", aspect: "9:16" })).toHaveLength(0);
  });

  it("excludes AI-generated clips by default and includes them on request", async () => {
    mockHits([hit({ isAiGenerated: true }), hit()]);
    expect(await searchPixabay("cat", { apiKey: "k" })).toHaveLength(1);
    expect(
      await searchPixabay("cat", { apiKey: "k", excludeAiGenerated: false }),
    ).toHaveLength(2);
  });

  it("excludes clips that are not family friendly by default", async () => {
    mockHits([hit({ isGRated: false }), hit()]);
    expect(await searchPixabay("x", { apiKey: "k" })).toHaveLength(1);
  });

  it("drops clips shorter than one cut", async () => {
    mockHits([hit({ duration: 1 }), hit({ duration: 10 })]);
    expect(await searchPixabay("x", { apiKey: "k", minDurationSeconds: 3 })).toHaveLength(1);
  });

  it("asks for a key rather than failing obscurely", async () => {
    await expect(searchPixabay("x", { apiKey: "" })).rejects.toThrow(/Settings/);
  });

  it("never leaks the API key in an error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    await expect(searchPixabay("x", { apiKey: "SUPER-SECRET" })).rejects.toThrow(
      expect.not.stringContaining("SUPER-SECRET") as unknown as string,
    );
  });

  it("explains a rate limit instead of surfacing a bare 429", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));
    await expect(searchPixabay("x", { apiKey: "k" })).rejects.toThrow(/rate limit/i);
  });
});

describe("probeTerm", () => {
  it("flags a term where one creator dominates", async () => {
    // The real failure mode: 'cat paw' returned five near-identical clips
    // from one contributor, and the finished video looked repetitive.
    mockHits([hit({ user: "bob" }), hit({ user: "bob" }), hit({ user: "bob" }), hit()]);
    const r = await probeTerm("cat paw", { apiKey: "k" });
    expect(r.verdict).toBe("dominated");
    expect(r.topCreator).toBe("bob");
    expect(r.advice).toMatch(/repetitive/);
  });

  it("passes a term with broad creator spread", async () => {
    mockHits(["a", "b", "c", "d", "e"].map((u) => hit({ user: u })));
    const r = await probeTerm("waterfall", { apiKey: "k" });
    expect(r.verdict).toBe("good");
    expect(r.distinctCreators).toBe(5);
    expect(r.dominance).toBeCloseTo(0.2);
  });

  it("reports an empty term rather than pretending it is merely thin", async () => {
    mockHits([]);
    expect((await probeTerm("office desk", { apiKey: "k" })).verdict).toBe("empty");
  });

  it("reports how many clips were dropped for being AI-generated", async () => {
    mockHits([hit({ isAiGenerated: true }), hit({ isAiGenerated: true }), hit()]);
    expect((await probeTerm("cat", { apiKey: "k" })).aiGeneratedExcluded).toBe(2);
  });

  it("returns a report instead of throwing when the search fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const r = await probeTerm("x", { apiKey: "k" });
    expect(r.verdict).toBe("empty");
    expect(r.error).toMatch(/offline/);
  });
});

describe("probeTerms", () => {
  it("deduplicates clips shared between overlapping terms", async () => {
    // Two terms returning the same clip add no variety to the finished video.
    const shared = hit({ id: 999 });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ total: 1, totalHits: 1, hits: [shared] }), {
        status: 200,
      }),
    );
    const s = await probeTerms(["river", "stream"], { apiKey: "k" });
    expect(s.uniqueClips).toBe(1);
  });

  it("names the terms worth replacing", async () => {
    mockHits([]);
    const s = await probeTerms(["office desk"], { apiKey: "k" });
    expect(s.verdict).toBe("risky");
    expect(s.advice).toMatch(/office desk/);
  });

  it("ignores blank and duplicate terms", async () => {
    mockHits([hit()]);
    const s = await probeTerms(["river", " river ", "", "  "], { apiKey: "k" });
    expect(s.reports).toHaveLength(1);
  });
});

describe("known limitation: topical relevance", () => {
  it("cannot tell that on-topic-looking footage is about the wrong subject", async () => {
    // 'quiet room reading' scores well on spread but returned religious study
    // footage for a video about workplace attention. The probe measures
    // variety, not meaning. Catching this needs semantic scoring.
    mockHits(["a", "b", "c", "d", "e"].map((u) => hit({ user: u, tags: "mosque, study" })));
    expect((await probeTerm("quiet room reading", { apiKey: "k" })).verdict).toBe("good");
  });
});
