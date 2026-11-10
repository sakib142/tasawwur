import { describe, expect, it } from "vitest";
import { gradeFilter, type Grade } from "./clips.ts";

/** Every filter the grades can call for. */
const ALL = new Set(["eq", "colorbalance"]);

describe("gradeFilter", () => {
  it("builds nothing when the look is off", () => {
    expect(gradeFilter("none", ALL)).toBe("");
  });

  it.each<Grade>(["natural", "warm", "cool"])("builds a chain for %s", (grade) => {
    const filter = gradeFilter(grade, ALL);
    expect(filter).toContain("eq=");
    // Every chain must parse as name=args, or ffmpeg rejects the whole graph.
    for (const part of filter.split(",")) expect(part).toMatch(/^[a-z]+=\S+$/);
  });

  it("tints warm and cool in opposite directions", () => {
    // A warm look lifts red and drops blue; cool does the reverse. Getting
    // these the same way round would make the presets indistinguishable.
    expect(gradeFilter("warm", ALL)).toContain("rs=0.04");
    expect(gradeFilter("cool", ALL)).toContain("rs=-0.04");
  });

  it("stays subtle", () => {
    // A heavy grade on footage its author already graded looks worse than
    // none. Nothing here should move a value by more than a tenth.
    for (const grade of ["natural", "warm", "cool"] as const) {
      for (const [, value] of gradeFilter(grade, ALL).matchAll(/=(-?\d+\.\d+)/g)) {
        const n = Number(value);
        // Rounded because 1.10 - 1 is 0.10000000000000009 in binary floating
        // point, and that is not the kind of failure this test is looking for.
        const distance = Number(Math.abs(n > 0.5 ? n - 1 : n).toFixed(6));
        expect(distance).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it("skips a look this ffmpeg cannot apply", () => {
    // An ffmpeg without colorbalance should render ungraded, not fail — this
    // build already turned out to have no text filters at all.
    expect(gradeFilter("warm", new Set(["eq"]))).toBe("");
    expect(gradeFilter("natural", new Set())).toBe("");
  });

  it("applies the look when filters are not declared", () => {
    // Callers that do not probe get the grade rather than silently losing it.
    expect(gradeFilter("natural")).toContain("eq=");
  });
});
