import { describe, expect, it } from "vitest";
import {
  buildSubtitles,
  estimateCues,
  formatTimestamp,
  toSentenceCues,
  toSrt,
  toWordCues,
  type WordCue,
} from "./index.ts";

/** Builds an evenly spaced timeline from a sentence. */
function timeline(text: string, perWord = 0.4): WordCue[] {
  return text.split(" ").map((w, i) => ({
    start: i * perWord,
    end: i * perWord + perWord * 0.9,
    text: w,
  }));
}

describe("formatTimestamp", () => {
  it("writes SRT timestamps", () => {
    expect(formatTimestamp(0)).toBe("00:00:00,000");
    expect(formatTimestamp(3.5)).toBe("00:00:03,500");
    expect(formatTimestamp(3661.125)).toBe("01:01:01,125");
  });

  it("clamps negatives rather than emitting a broken timestamp", () => {
    expect(formatTimestamp(-1)).toBe("00:00:00,000");
  });
});

describe("toSentenceCues", () => {
  it("breaks at sentence punctuation", () => {
    const cues = toSentenceCues(timeline("A river has no plan. It meets a rock."));
    expect(cues).toHaveLength(2);
    expect(cues[0]!.text).toBe("A river has no plan.");
    expect(cues[1]!.text).toBe("It meets a rock.");
  });

  it("keeps captions within the character budget", () => {
    const long =
      "sunlight reaches the air above us and bumps into tiny bits of air smaller " +
      "than you can possibly see from down here on the ground";
    for (const c of toSentenceCues(timeline(long), { maxChars: 50 })) {
      expect(c.text.length).toBeLessThanOrEqual(64); // budget plus the final word
    }
  });

  it("breaks on an audible pause, not mid-phrase", () => {
    const words: WordCue[] = [
      { start: 0, end: 0.4, text: "Nothing" },
      { start: 0.4, end: 0.8, text: "about" },
      { start: 0.8, end: 1.2, text: "a" },
      { start: 1.2, end: 1.6, text: "river" },
      { start: 1.6, end: 2.0, text: "is" },
      { start: 2.0, end: 2.4, text: "forceful" },
      // a full second of silence
      { start: 3.4, end: 3.8, text: "It" },
      { start: 3.8, end: 4.2, text: "carves" },
      { start: 4.2, end: 4.6, text: "canyons" },
    ];
    const cues = toSentenceCues(words, { maxChars: 40, pauseSeconds: 0.3 });
    expect(cues[0]!.text).toBe("Nothing about a river is forceful");
  });

  it("folds an unreadably short caption into its neighbour", () => {
    const words = [
      ...timeline("Water always finds a way."),
      { start: 2.1, end: 2.2, text: "Yes." },
    ];
    const cues = toSentenceCues(words, { minSeconds: 1.0 });
    expect(cues).toHaveLength(1);
    expect(cues[0]!.text).toContain("Yes.");
  });

  it("returns nothing for an empty timeline", () => {
    expect(toSentenceCues([])).toEqual([]);
  });

  it("never produces a cue that ends before it starts", () => {
    for (const c of toSentenceCues(timeline("One two three four five six seven."))) {
      expect(c.end).toBeGreaterThanOrEqual(c.start);
    }
  });
});

describe("toWordCues", () => {
  it("produces one cue per word", () => {
    expect(toWordCues(timeline("one two three"))).toHaveLength(3);
  });

  it("holds a word until the next so it does not blink off in a gap", () => {
    const words: WordCue[] = [
      { start: 0, end: 0.3, text: "one" },
      { start: 0.5, end: 0.8, text: "two" },
    ];
    const cues = toWordCues(words, 0.4);
    expect(cues[0]!.end).toBe(0.5); // extended to meet the next word
  });

  it("does not hold across a long pause", () => {
    const words: WordCue[] = [
      { start: 0, end: 0.3, text: "one" },
      { start: 5, end: 5.3, text: "two" },
    ];
    expect(toWordCues(words, 0.4)[0]!.end).toBeCloseTo(0.7); // capped by the hold
  });
});

describe("estimateCues", () => {
  it("spans exactly the audio length", () => {
    const cues = estimateCues("a short sentence here", 4);
    expect(cues[0]!.start).toBe(0);
    expect(cues.at(-1)!.end).toBeCloseTo(4, 5);
  });

  it("gives longer words more time", () => {
    const [a, b] = estimateCues("a extraordinarily", 2);
    expect(b!.end - b!.start).toBeGreaterThan(a!.end - a!.start);
  });

  it("returns nothing for empty input or zero duration", () => {
    expect(estimateCues("", 5)).toEqual([]);
    expect(estimateCues("hello", 0)).toEqual([]);
  });
});

describe("toSrt", () => {
  it("writes valid SRT", () => {
    const srt = toSrt([{ index: 1, start: 0, end: 1.5, text: "Hello" }]);
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,500\nHello\n");
  });

  it("separates entries with a blank line and ends with a newline", () => {
    // Long enough that neither caption is folded into the other for being
    // too short to read.
    const { srt, cues } = buildSubtitles(
      timeline("A river has no plan at all. It simply meets a rock and goes around."),
      "sentence",
    );
    expect(cues.length).toBeGreaterThan(1);
    expect(srt.split("\n\n").length).toBe(cues.length);
    expect(srt.endsWith("\n")).toBe(true);
  });
});
