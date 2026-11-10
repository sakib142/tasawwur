import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capabilities, ffmpeg, probe } from "./ffmpeg.ts";
import { gradeFilter, isStillImage, kenBurns, normaliseClip, type Grade } from "./clips.ts";

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

describe("isStillImage", () => {
  it("recognises the formats people upload", () => {
    for (const name of ["a.jpg", "A.JPEG", "b.png", "c.webp", "d.heic", "e.AVIF"]) {
      expect(isStillImage(name)).toBe(true);
    }
  });

  it("treats video as video", () => {
    for (const name of ["a.mp4", "b.mov", "c.webm", "d.mkv"]) {
      expect(isStillImage(name)).toBe(false);
    }
  });

  it("leaves gif to the video path, because it animates", () => {
    expect(isStillImage("loop.gif")).toBe(false);
  });

  it("decides by name, not by duration", () => {
    // A still reports about a fortieth of a second and so does a very short
    // video; looping the latter would repeat footage never meant to repeat.
    expect(isStillImage("/some/path/with.mp4/inside/photo.png")).toBe(true);
  });
});

describe("kenBurns", () => {
  it("counts frames at the rate the clip is rendered at", () => {
    // The zoom used to be pinned at 25 while the pipeline rendered at 30, so
    // it ran a fifth too fast and finished before the shot did.
    const filter = kenBurns(5, 30, 1080, 1920, "in");
    expect(filter).toContain("/150");
    expect(filter).toContain("fps=30");
    expect(filter).not.toContain("25");
  });

  it("pushes in and pulls out", () => {
    expect(kenBurns(5, 30, 1080, 1920, "in")).toContain("min(1+");
    expect(kenBurns(5, 30, 1080, 1920, "out")).toContain("max(1.1-");
  });

  it("never samples below 1, which would mean inventing edges", () => {
    for (const direction of ["in", "out"] as const) {
      const filter = kenBurns(5, 30, 1080, 1920, direction);
      for (const [, value] of filter.matchAll(/,(\d+(?:\.\d+)?)\)/g)) {
        expect(Number(value)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("emits one output frame per input frame", () => {
    // Without d=1 zoompan turns one still into many and multiplies the length.
    expect(kenBurns(5, 30, 1080, 1920, "in")).toContain("d=1");
  });

  it("survives a shot shorter than one frame", () => {
    expect(() => kenBurns(0.001, 30, 1080, 1920, "in")).not.toThrow();
    expect(kenBurns(0.001, 30, 1080, 1920, "in")).not.toContain("/0");
  });
});

describe("normaliseClip with a still", () => {
  let dir: string;
  let photo: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "tasawwur-still-"));
    photo = join(dir, "photo.png");
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=1280x720:d=1", "-frames:v", "1", photo]);
  }, 120_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function render(index: number, imageMotion: "zoom" | "static") {
    const { workingEncoders } = await capabilities();
    const out = await normaliseClip({
      source: photo,
      outDir: dir,
      index,
      width: 540,
      height: 960,
      duration: 3,
      fps: 30,
      fit: "cover",
      speed: 1,
      imageMotion,
      transition: null,
      encoder: workingEncoders[0]!,
    });
    return probe(out);
  }

  it("holds a still for the whole shot", async () => {
    // The defect: the input was clamped to the single frame the file holds,
    // so a shot came out a thirtieth of a second long and an upload of
    // photographs produced a video of flashes.
    const info = await render(0, "zoom");
    expect(info.durationSeconds).toBeGreaterThan(2.9);
    expect(info.durationSeconds).toBeLessThan(3.2);
  }, 120_000);

  it("holds it just as long without the push", async () => {
    const info = await render(1, "static");
    expect(info.durationSeconds).toBeGreaterThan(2.9);
    expect(info.durationSeconds).toBeLessThan(3.2);
  }, 120_000);

  it("renders at the size asked for", async () => {
    const info = await render(2, "zoom");
    expect([info.width, info.height]).toEqual([540, 960]);
  }, 120_000);
});

describe("a still is not footage", () => {
  it("ignores playback speed", async () => {
    // Retiming generated frames would only cut the shot short: at 2x a
    // three-second hold became a second and a half of nothing in particular.
    const dir = await mkdtemp(join(tmpdir(), "tasawwur-speed-"));
    try {
      const photo = join(dir, "p.png");
      await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=640x360:d=1", "-frames:v", "1", photo]);
      const { workingEncoders } = await capabilities();
      const out = await normaliseClip({
        source: photo, outDir: dir, index: 0, width: 540, height: 960,
        duration: 3, fps: 30, fit: "cover", speed: 2, transition: null,
        encoder: workingEncoders[0]!,
      });
      expect((await probe(out)).durationSeconds).toBeGreaterThan(2.9);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
