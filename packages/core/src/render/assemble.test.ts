import { describe, expect, it } from "vitest";
import { DURATION_MARGIN_SECONDS } from "./assemble.ts";

describe("duration margin", () => {
  it("adds a small margin past the narration", () => {
    // ffmpeg's frame rounding can land the picture a few tens of milliseconds
    // short, which shows as a black flash on the last frame.
    expect(DURATION_MARGIN_SECONDS).toBeGreaterThan(0);
    expect(DURATION_MARGIN_SECONDS).toBeLessThan(0.5);
  });
});
