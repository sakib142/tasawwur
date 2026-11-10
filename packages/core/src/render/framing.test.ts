import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CENTRE, bestWindow, columnEnergy, findFraming, rowEnergy } from "./framing.ts";
import { ffmpeg } from "./ffmpeg.ts";

/** One grey frame, `width`x`height`, with a bright bar at `barAt` columns. */
function frameWithBar(width: number, height: number, barAt: number, barWidth = 4): Buffer {
  const buf = Buffer.alloc(width * height, 40);
  for (let y = 0; y < height; y++) {
    for (let x = barAt; x < Math.min(barAt + barWidth, width); x++) {
      buf[y * width + x] = 230;
    }
  }
  return buf;
}

describe("columnEnergy", () => {
  it("finds the column where the picture changes", () => {
    const energy = columnEnergy(frameWithBar(40, 10, 30), 40, 10, 1);
    const peak = energy.indexOf(Math.max(...energy));
    // The bar's leading edge is at 30; the trailing edge is at 34.
    expect([30, 34]).toContain(peak);
  });

  it("is flat on a flat picture", () => {
    const energy = columnEnergy(Buffer.alloc(40 * 10, 128), 40, 10, 1);
    expect(Math.max(...energy)).toBe(0);
  });

  it("ignores a horizon, which says nothing about where to crop", () => {
    // Top half dark, bottom half light: every column is identical.
    const buf = Buffer.alloc(40 * 10, 30);
    buf.fill(200, 40 * 5);
    const energy = columnEnergy(buf, 40, 10, 1);
    expect(Math.max(...energy)).toBe(0);
  });

  it("adds up across frames", () => {
    const one = frameWithBar(40, 10, 30);
    const two = Buffer.concat([one, one]);
    const a = columnEnergy(one, 40, 10, 1);
    const b = columnEnergy(two, 40, 10, 2);
    expect(b[30]).toBe(a[30]! * 2);
  });

  it("stops at the end of short data rather than reading past it", () => {
    // Claiming three frames when one arrived must not throw.
    expect(() => columnEnergy(frameWithBar(40, 10, 10), 40, 10, 3)).not.toThrow();
  });
});

describe("rowEnergy", () => {
  it("finds the row where the picture changes", () => {
    const buf = Buffer.alloc(40 * 20, 30);
    buf.fill(220, 40 * 12, 40 * 14);
    const energy = rowEnergy(buf, 40, 20, 1);
    expect([12, 14]).toContain(energy.indexOf(Math.max(...energy)));
  });
});

describe("bestWindow", () => {
  it("picks the window containing the subject", () => {
    const energy = columnEnergy(frameWithBar(160, 90, 130), 160, 90, 1);
    // A third of the width, as a 16:9 source cropped to 9:16 would be.
    const at = bestWindow(energy, 0.32);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThan(0.6);
  });

  it("stays centred when the subject already is", () => {
    const energy = columnEnergy(frameWithBar(160, 90, 78), 160, 90, 1);
    const at = bestWindow(energy, 0.32);
    // Either it declines to move, or it lands near the middle.
    expect(at === null || Math.abs(at - 0.5) < 0.2).toBe(true);
  });

  it("declines to move on footage with no subject", () => {
    // The guard that matters: drifting off-centre for noise looks worse than
    // the centre crop it replaced.
    expect(bestWindow(new Array<number>(160).fill(100), 0.32)).toBeNull();
  });

  it("declines when the window is the whole frame", () => {
    expect(bestWindow(new Array<number>(160).fill(100), 1)).toBeNull();
  });

  it("declines when there is no energy at all", () => {
    expect(bestWindow(new Array<number>(160).fill(0), 0.32)).toBeNull();
  });
});

describe("findFraming", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "tasawwur-framing-"));
  }, 120_000);
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("moves the crop toward an off-centre subject", async () => {
    // A 16:9 clip, black but for a bright bar well right of centre. Cropped
    // to 9:16 and centred, the bar would be cut out entirely.
    const path = join(dir, "right.mp4");
    await ffmpeg([
      "-f", "lavfi", "-i", "color=c=black:s=1280x720:d=2:r=10",
      "-f", "lavfi", "-i", "color=c=white:s=90x720:d=2:r=10",
      "-filter_complex", "[0][1]overlay=x=1050:y=0,format=yuv420p[v]",
      "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", "-t", "2", path,
    ]);

    const framing = await findFraming({
      source: path,
      sourceWidth: 1280,
      sourceHeight: 720,
      width: 1080,
      height: 1920,
    });
    expect(framing.x).toBeGreaterThan(0.6);
  }, 120_000);

  it("centres footage with nothing to find", async () => {
    const path = join(dir, "flat.mp4");
    await ffmpeg([
      "-f", "lavfi", "-i", "color=c=gray:s=1280x720:d=2:r=10",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-t", "2", path,
    ]);

    expect(
      await findFraming({
        source: path,
        sourceWidth: 1280,
        sourceHeight: 720,
        width: 1080,
        height: 1920,
      }),
    ).toEqual(CENTRE);
  }, 120_000);

  it("centres when nothing is cropped away", async () => {
    // Same aspect in and out: there is no overflow to position.
    expect(
      await findFraming({
        source: join(dir, "does-not-exist.mp4"),
        sourceWidth: 1080,
        sourceHeight: 1920,
        width: 1080,
        height: 1920,
      }),
    ).toEqual(CENTRE);
  });

  it("centres rather than failing on an unreadable file", async () => {
    // A render must not die because a probe did not like a file.
    expect(
      await findFraming({
        source: join(dir, "missing.mp4"),
        sourceWidth: 1280,
        sourceHeight: 720,
        width: 1080,
        height: 1920,
      }),
    ).toEqual(CENTRE);
  }, 60_000);
});
