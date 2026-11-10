import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DURATION_MARGIN_SECONDS, concatClips } from "./assemble.ts";
import { ffmpeg, probe } from "./ffmpeg.ts";

describe("duration margin", () => {
  it("adds a small margin past the narration", () => {
    // ffmpeg's frame rounding can land the picture a few tens of milliseconds
    // short, which shows as a black flash on the last frame.
    expect(DURATION_MARGIN_SECONDS).toBeGreaterThan(0);
    expect(DURATION_MARGIN_SECONDS).toBeLessThan(0.5);
  });
});

describe("concatClips", () => {
  let dir: string;
  let clips: string[];
  let total: number;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "tasawwur-concat-"));
    clips = [];
    // Real files, because the behaviour under test is about the durations
    // ffmpeg actually produces rather than the ones we asked for.
    for (const [i, colour] of ["red", "green", "blue"].entries()) {
      const path = join(dir, `clip-${i}.mp4`);
      await ffmpeg([
        "-f", "lavfi", "-i", `color=c=${colour}:s=64x64:d=2:r=30`,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-t", "2", path,
      ]);
      clips.push(path);
    }
    total = (
      await Promise.all(clips.map((c) => probe(c).then((info) => info.durationSeconds)))
    ).reduce((a, b) => a + b, 0);
  }, 120_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** The clips named in the ffconcat file this run wrote, in order. */
  async function listed(target: number): Promise<string[]> {
    await concatClips(clips, target, dir);
    const text = await readFile(join(dir, "concat.txt"), "utf8");
    return [...text.matchAll(/^file '(.+)'$/gm)].map((m) => m[1]!);
  }

  it("does not add a whole clip to cover rounding error", async () => {
    // The defect: shots cut to exactly the narration length still encode a few
    // milliseconds short, and covering that shortfall appended another clip.
    // One frame of it survived the final trim, so an unrelated shot flashed at
    // the end of the video.
    expect(await listed(total + 0.01)).toHaveLength(clips.length);
  });

  it("treats a shortfall inside the margin as covered", async () => {
    expect(await listed(total + DURATION_MARGIN_SECONDS - 0.001)).toHaveLength(clips.length);
  });

  it("still repeats clips when there is real narration left to cover", async () => {
    // Running out of footage is the failure a viewer cannot miss, so the
    // tolerance must not stop genuine looping.
    expect((await listed(total * 2)).length).toBeGreaterThan(clips.length);
  });

  it("uses the clips in the order given", async () => {
    expect(await listed(total)).toEqual(clips);
  });

  it("refuses an empty clip list", async () => {
    await expect(concatClips([], 5, dir)).rejects.toThrow(/no clips/i);
  });
});
