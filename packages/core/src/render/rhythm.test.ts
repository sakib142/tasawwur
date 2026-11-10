import { describe, expect, it } from "vitest";
import { shotDurations } from "./rhythm.ts";
import type { Cue } from "../captions.ts";

/** Cues from a list of [start, end] pairs; the text never matters here. */
function cues(...spans: Array<[number, number]>): Cue[] {
  return spans.map(([start, end], i) => ({ index: i + 1, start, end, text: `cue ${i + 1}` }));
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

describe("shotDurations", () => {
  // The defect this exists to prevent: in job dfc41d95 the voice broke at
  // 1.611 / 4.350 / 6.709 / 8.401 / 10.900 and the picture cut at 5 and 10.
  it("cuts where the voice breaks, not on a fixed interval", () => {
    const timeline = cues(
      [0, 1.611],
      [1.611, 4.35],
      [4.35, 6.709],
      [6.709, 8.401],
      [8.401, 10.9],
    );
    const durations = shotDurations(timeline, 3, { totalSeconds: 11 });

    const boundaries: number[] = [];
    let at = 0;
    for (const d of durations.slice(0, -1)) {
      at += d;
      boundaries.push(at);
    }

    const edges = [1.611, 4.35, 6.709, 8.401];
    for (const boundary of boundaries) {
      expect(edges.some((e) => Math.abs(e - boundary) < 0.001)).toBe(true);
    }
    // The old behaviour put a cut at 5.0, inside the third sentence.
    expect(boundaries).not.toContain(5);
  });

  it("covers the whole narration including trailing silence", () => {
    // Speech synthesis leaves a tail after the last word. If the shots stop
    // at the final cue the joiner repeats a clip to fill the gap.
    const durations = shotDurations(cues([0, 3], [3, 6], [6, 9]), 3, { totalSeconds: 10.2 });
    expect(sum(durations)).toBeCloseTo(10.2, 5);
  });

  it("holds no shot longer than the maximum", () => {
    const timeline = cues([0, 4], [4, 8], [8, 12], [12, 16], [16, 20]);
    for (const d of shotDurations(timeline, 2, { maxSeconds: 7 }).slice(0, -1)) {
      expect(d).toBeLessThanOrEqual(7);
    }
  });

  it("divides a sentence that is too long to hold as one shot", () => {
    // A 20s cue cannot be a single shot, so it becomes several equal ones.
    const durations = shotDurations(cues([0, 20]), 1, { maxSeconds: 7 });
    expect(durations.length).toBeGreaterThan(1);
    for (const d of durations) expect(d).toBeLessThanOrEqual(7.001);
    expect(sum(durations)).toBeCloseTo(20, 5);
  });

  it("folds a clipped final sentence into the shot before it", () => {
    // "And that was that." on its own would flash past.
    const durations = shotDurations(cues([0, 3], [3, 3.4]), 2, { minSeconds: 1.5 });
    expect(durations).toHaveLength(1);
    expect(sum(durations)).toBeCloseTo(3.4, 5);
  });

  it("asks for more shots than there are clips when the script outruns them", () => {
    // Two clips cannot cover 30s without being held far too long, so the
    // caller is told to cycle them rather than stretching each to 15s.
    const timeline = cues(...Array.from({ length: 10 }, (_, i) => [i * 3, i * 3 + 3] as [number, number]));
    const durations = shotDurations(timeline, 2, { maxSeconds: 7 });
    expect(durations.length).toBeGreaterThan(2);
    for (const d of durations) expect(d).toBeLessThanOrEqual(7.001);
  });

  it("uses every clip when the narration gives it room", () => {
    const timeline = cues(...Array.from({ length: 8 }, (_, i) => [i * 2, i * 2 + 2] as [number, number]));
    expect(shotDurations(timeline, 4, { totalSeconds: 16 })).toHaveLength(4);
  });

  it("survives a script of one short sentence", () => {
    const durations = shotDurations(cues([0, 1.2]), 3, { totalSeconds: 1.4 });
    expect(durations).toHaveLength(1);
    expect(sum(durations)).toBeCloseTo(1.4, 5);
  });

  it("falls back to an even division when there are no cues", () => {
    // Captions can be switched off, and the picture still has to be cut.
    const durations = shotDurations([], 3, { totalSeconds: 12 });
    expect(durations.length).toBeGreaterThan(0);
    expect(sum(durations)).toBeCloseTo(12, 5);
  });

  it("returns nothing when there is no time to fill", () => {
    expect(shotDurations([], 3)).toEqual([]);
  });

  it("ignores cues with no duration", () => {
    const durations = shotDurations(cues([0, 0], [0, 4]), 1);
    expect(sum(durations)).toBeCloseTo(4, 5);
  });
});
