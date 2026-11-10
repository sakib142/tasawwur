import { describe, expect, it } from "vitest";
import { describeCoverage } from "./coverage.ts";
import { coversTerm, termCoverage } from "./relevance.ts";
import type { Storyboard } from "./storyboard.ts";

/** The snow clips a search for "cold brew" actually returned. */
const SNOW = ["winter", "snow", "nature", "cold", "frost", "trees", "snowy", "icy", "frozen"];
/** A genuine result for "mountain trail". */
const TRAIL = ["mountain", "trail", "hiking", "nature", "path"];

describe("coversTerm", () => {
  it("rejects footage that answers one word of the term", () => {
    // The failure this exists for: four clips of snow for "cold brew", every
    // one tagged "cold" and not one tagged anything to do with coffee.
    expect(coversTerm(SNOW, "cold brew")).toBe(false);
    expect(coversTerm(["marina", "boats", "brighton"], "Dubai Marina")).toBe(false);
  });

  it("accepts footage that answers all of it", () => {
    expect(coversTerm(TRAIL, "mountain trail")).toBe(true);
    expect(coversTerm(["rain", "water"], "rain")).toBe(true);
  });

  it("is unmoved by how many other tags a clip carries", () => {
    // A clip tagged with thirty words must not pass by casting a wide net.
    expect(coversTerm([...SNOW, "drink", "cup"], "cold brew")).toBe(false);
  });
});

describe("termCoverage", () => {
  it("names the word the search ignored", () => {
    const words = termCoverage("cold brew", [SNOW, SNOW, SNOW]);
    expect(words.find((w) => w.word === "cold")?.share).toBe(1);
    expect(words.find((w) => w.word === "brew")?.share).toBe(0);
  });

  it("reports every word answered when the term is honoured", () => {
    for (const { share } of termCoverage("mountain trail", [TRAIL, TRAIL])) {
      expect(share).toBe(1);
    }
  });

  it("reports nothing answered when there are no results", () => {
    for (const { share } of termCoverage("cold brew", [])) expect(share).toBe(0);
  });
});

/** A storyboard with the given lines, each matched or not. */
function board(
  shots: Array<{ line: string; match: number; creator?: string }>,
  totalSeconds = 30,
  narrationSeconds = 20,
): Storyboard {
  return {
    shots: shots.map((s, i) => ({
      id: `s${i}`,
      term: "term",
      line: s.line,
      match: s.match,
      clip: { creator: s.creator ?? `c${i}` } as never,
      alternatives: [],
    })),
    clipDuration: 5,
    totalSeconds,
    narrationSeconds,
    emptyTerms: [],
  };
}

describe("describeCoverage", () => {
  it("calls out a script the library cannot illustrate", () => {
    // The coffee advert: every line about a place or product the library does
    // not hold, and the only way to find out was to watch the finished file.
    const result = describeCoverage(
      board([
        { line: "Riyadh. Seven a.m.", match: 0 },
        { line: "Ice first, then the coffee.", match: 0 },
        { line: "Dubai. Different street.", match: 0 },
        { line: "One sip, and the day begins.", match: 0 },
      ]),
    );
    expect(result.verdict).toBe("mismatched");
    expect(result.unmatched).toBe(4);
    expect(result.advice).toMatch(/supply your own footage/i);
  });

  it("passes a script the footage answers", () => {
    const result = describeCoverage(
      board([
        { line: "The forecast said rain.", match: 1 },
        { line: "The trail turned up.", match: 1 },
        { line: "Then the light.", match: 0.5 },
      ]),
    );
    expect(result.verdict).toBe("ready");
    expect(result.unmatched).toBe(0);
  });

  it("tolerates the odd line nothing could illustrate", () => {
    // "You went anyway" has no concrete word in it. No footage answers that,
    // and the shot around it carries the line — which is how writing works.
    const result = describeCoverage(
      board([
        { line: "The forecast said rain.", match: 1 },
        { line: "You went anyway.", match: 0 },
        { line: "The fog came down.", match: 1 },
      ]),
    );
    expect(result.verdict).toBe("ready");
    expect(result.unmatched).toBe(1);
    expect(result.advice).toMatch(/relies on the shot around it/i);
  });

  it("warns when there is less footage than narration", () => {
    const result = describeCoverage(
      board([{ line: "The forecast said rain.", match: 1 }], 10, 30),
    );
    expect(result.verdict).toBe("thin");
    expect(result.advice).toMatch(/clips will repeat/i);
  });

  it("measures how much one contributor supplied", () => {
    const result = describeCoverage(
      board([
        { line: "One.", match: 1, creator: "ann" },
        { line: "Two.", match: 1, creator: "ann" },
        { line: "Three.", match: 1, creator: "bob" },
      ]),
    );
    expect(result.creators).toBe(2);
    expect(result.dominance).toBeCloseTo(2 / 3, 5);
  });

  it("survives an empty arrangement", () => {
    expect(() => describeCoverage(board([]))).not.toThrow();
  });
});
