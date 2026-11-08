import { describe, expect, it } from "vitest";
import { alignCuesToText } from "./align.ts";
import type { WordCue } from "./types.ts";

/** A spoken timeline: words only, punctuation stripped, as services report it. */
const spoken = (words: string[]): WordCue[] =>
  words.map((text, i) => ({ start: i, end: i + 0.9, text }));

describe("alignCuesToText", () => {
  it("restores punctuation from the script", () => {
    const cues = alignCuesToText(
      spoken(["Why", "is", "the", "sky", "blue", "Sunlight", "looks", "white"]),
      "Why is the sky blue? Sunlight looks white,",
    );
    expect(cues.map((c) => c.text)).toEqual([
      "Why", "is", "the", "sky", "blue?", "Sunlight", "looks", "white,",
    ]);
  });

  it("preserves the timings exactly", () => {
    const original = spoken(["one", "two"]);
    const aligned = alignCuesToText(original, "One, two.");
    expect(aligned.map((c) => [c.start, c.end])).toEqual([
      [0, 0.9],
      [1, 1.9],
    ]);
  });

  it("loses no words when the service elides one", () => {
    // "and" spoken but not reported.
    const cues = alignCuesToText(spoken(["rock", "goes"]), "rock and goes");
    expect(cues.map((c) => c.text).join(" ")).toBe("rock and goes");
  });

  it("appends trailing script text rather than dropping it", () => {
    const cues = alignCuesToText(spoken(["water", "finds"]), "water finds a way.");
    expect(cues.at(-1)!.text).toBe("finds a way.");
  });

  it("keeps the spoken form when a word cannot be matched", () => {
    const cues = alignCuesToText(spoken(["hello", "zzzz", "world"]), "hello world");
    expect(cues.map((c) => c.text)).toContain("zzzz");
    expect(cues).toHaveLength(3);
  });

  it("matches case-insensitively and ignores punctuation when comparing", () => {
    expect(alignCuesToText(spoken(["WATER"]), "Water,")[0]!.text).toBe("Water,");
  });

  it("returns the input unchanged for empty text", () => {
    const cues = spoken(["a"]);
    expect(alignCuesToText(cues, "")).toEqual(cues);
    expect(alignCuesToText([], "anything")).toEqual([]);
  });

  it("does not shift everything after a single mismatch", () => {
    // A mismatch early must not corrupt the rest of the alignment.
    const cues = alignCuesToText(
      spoken(["the", "XXX", "meets", "a", "rock"]),
      "the river meets a rock.",
    );
    expect(cues.at(-1)!.text).toBe("rock.");
  });
});
