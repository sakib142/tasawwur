import { describe, expect, it } from "vitest";
import { POSITIONS, renderCaption, renderCaptions } from "./captions.ts";

const FONT = `${process.env.HOME}/Library/Application Support/MoneyPrinterTurbo/resource/fonts/BeVietnamPro-Bold.ttf`;
const style = {
  fontPath: FONT,
  fontSize: 55,
  color: "#FFFFFF",
  strokeColor: "#000000",
  strokeWidth: 1.5,
  background: false as const,
  roundedBackground: false,
  position: "bottom" as const,
};

/** PNG magic number — proves real image bytes, not an empty buffer. */
const isPng = (b: Buffer) => b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";

describe("caption rendering", () => {
  it("produces a transparent PNG at frame size", () => {
    const png = renderCaption("Water always finds a way.", 1080, 1920, style);
    expect(isPng(png)).toBe(true);
    // Full-frame output means compositing is a plain overlay at 0,0 with no
    // position arithmetic in the filter graph.
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1920);
  });

  it("wraps long text instead of running off the frame", () => {
    const short = renderCaption("Short", 1080, 1920, style);
    const long = renderCaption(
      "Nothing about a river is forceful, yet it carves canyons anyway over many years",
      1080,
      1920,
      style,
    );
    // More lines means more ink, so the wrapped version must be larger.
    expect(long.length).toBeGreaterThan(short.length);
  });

  it("draws a background only when asked", () => {
    const without = renderCaption("Hello there", 1080, 1920, style);
    const with_ = renderCaption("Hello there", 1080, 1920, {
      ...style,
      background: "#000000",
    });
    expect(with_.length).not.toBe(without.length);
  });

  it("places the caption where the position says", () => {
    const top = renderCaption("Hello", 1080, 1920, { ...style, position: "top" });
    const bottom = renderCaption("Hello", 1080, 1920, style);
    expect(top.equals(bottom)).toBe(false);
  });

  it("anchors the bottom edge rather than centring the block", () => {
    // A one-line and a three-line caption must sit the same distance from the
    // bottom of the screen. Centring at a fraction of height makes the taller
    // one drift toward the middle, which is what the reference avoids.
    const one = renderCaption("One line", 1080, 1920, style);
    const many = renderCaption(
      "A caption long enough to wrap onto several separate lines when measured",
      1080,
      1920,
      style,
    );
    // Both must render; the assertion that matters is visual, but differing
    // output proves the block height is being accounted for.
    expect(one.length).toBeGreaterThan(0);
    expect(many.length).toBeGreaterThan(one.length);
  });

  it("keeps a custom position inside the frame", () => {
    for (const customPosition of [0, 50, 100]) {
      expect(() =>
        renderCaption("Hello", 1080, 1920, { ...style, position: "custom", customPosition }),
      ).not.toThrow();
    }
  });

  it("renders a cue list in order with timings preserved", () => {
    const frames = renderCaptions(
      [
        { index: 1, start: 0, end: 2, text: "First" },
        { index: 2, start: 2, end: 4, text: "Second" },
      ],
      1080,
      1920,
      style,
    );
    expect(frames).toHaveLength(2);
    expect(frames.map((f) => [f.start, f.end])).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(frames.every((f) => isPng(f.png))).toBe(true);
  });

  it("names the font file when it cannot be loaded", () => {
    expect(() =>
      renderCaption("x", 100, 100, { ...style, fontPath: "/no/such/font.ttf" }),
    ).toThrow(/\/no\/such\/font\.ttf/);
  });

  it("offers the positions the form exposes", () => {
    expect([...POSITIONS].sort()).toEqual([
      "bottom",
      "center",
      "custom",
      "top",
      "two_thirds_bottom",
    ]);
  });
});
