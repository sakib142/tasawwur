import { describe, expect, it } from "vitest";
import { contentWords, relevance, sentences } from "./relevance.ts";

describe("contentWords", () => {
  it("drops words that carry no meaning", () => {
    expect([...contentWords("it meets a rock, and it goes around")]).toEqual(
      expect.arrayContaining(["meet", "rock", "around"]),
    );
    expect(contentWords("it and the a of").size).toBe(0);
  });

  it("folds a plural onto its singular", () => {
    // "rivers" must find a clip tagged "river", which is the common case.
    expect(contentWords("rivers")).toEqual(contentWords("river"));
    expect(contentWords("falls")).toEqual(contentWords("fall"));
    expect(contentWords("skies")).toEqual(contentWords("sky"));
  });

  it("keeps a word that merely ends in s", () => {
    // Stripping the s from "grass" would leave "gras", matching nothing.
    expect(contentWords("grass").has("grass")).toBe(true);
  });

  it("ignores punctuation and case", () => {
    expect(contentWords("Cliff, and it FALLS.")).toEqual(contentWords("cliff falls"));
  });
});

describe("relevance", () => {
  const CLIFF = "It meets a cliff, and it falls.";

  it("prefers footage that shows what the line is about", () => {
    const waterfall = relevance(["waterfall", "cliff", "cascade"], CLIFF);
    const calm = relevance(["lake", "calm", "reflection"], CLIFF);
    expect(waterfall).toBeGreaterThan(calm);
  });

  it("matches a word inside a compound", () => {
    // The defect this is for: a clip tagged "waterfall" ignored for a line
    // about something that falls.
    expect(relevance(["waterfall"], "it falls")).toBeGreaterThan(0);
    expect(relevance(["rainstorm"], "the rain")).toBeGreaterThan(0);
  });

  it("scores against the line, not the tag list", () => {
    // A clip tagged with everything must not win by casting a wide net.
    const broad = relevance(
      ["lake", "tree", "sky", "cloud", "stone", "moss", "bird", "cliff"],
      CLIFF,
    );
    const exact = relevance(["cliff", "falls"], CLIFF);
    expect(exact).toBeGreaterThanOrEqual(broad);
  });

  it("is zero when nothing matches", () => {
    expect(relevance(["office", "laptop"], CLIFF)).toBe(0);
  });

  it("handles empty input without throwing", () => {
    expect(relevance([], CLIFF)).toBe(0);
    expect(relevance(["river"], "")).toBe(0);
    expect(relevance(["river"], "the and of")).toBe(0);
  });

  it("stays within 0 and 1", () => {
    for (const tags of [["cliff", "falls"], ["river"], []]) {
      const score = relevance(tags, CLIFF);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe("sentences", () => {
  it("splits on terminal punctuation", () => {
    expect(sentences("A river has no plan. It meets a rock. It goes around!")).toEqual([
      "A river has no plan.",
      "It meets a rock.",
      "It goes around!",
    ]);
  });

  it("returns a single line when there is no punctuation", () => {
    // A topic typed into the form rather than a written script.
    expect(sentences("why rivers always find a way")).toEqual([
      "why rivers always find a way",
    ]);
  });

  it("returns nothing for an empty script", () => {
    expect(sentences("")).toEqual([]);
    expect(sentences("   ")).toEqual([]);
  });
});
