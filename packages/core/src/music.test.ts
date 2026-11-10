import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { listMusic, resolveTrack } from "./music.ts";

describe("music", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "tasawwur-music-"));
    for (const name of ["calm-piano.mp3", "soft_strings.wav", "notes.txt", "upbeat.m4a"]) {
      await writeFile(join(dir, name), "");
    }
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("listMusic", () => {
    it("lists audio and ignores everything else", async () => {
      const ids = (await listMusic(dir)).map((t) => t.id);
      expect(ids).toHaveLength(3);
      expect(ids).not.toContain("notes.txt");
    });

    it("gives each file a readable name", async () => {
      const labels = (await listMusic(dir)).map((t) => t.label);
      expect(labels).toContain("Calm piano");
      expect(labels).toContain("Soft strings");
    });

    it("treats a missing directory as no music, not an error", async () => {
      // Music is optional; a video without it still renders.
      await expect(listMusic(join(dir, "nope"))).resolves.toEqual([]);
    });
  });

  describe("resolveTrack", () => {
    it("honours an explicit choice", async () => {
      const path = await resolveTrack("file", "calm-piano.mp3", dir);
      expect(path && basename(path)).toBe("calm-piano.mp3");
    });

    it("returns nothing when music is switched off", async () => {
      expect(await resolveTrack("none", "", dir)).toBeNull();
      expect(await resolveTrack("", "", dir)).toBeNull();
    });

    it("picks one when asked for random", async () => {
      // Injected rather than random, so the test asserts a fact.
      const path = await resolveTrack("random", "", dir, () => 0);
      expect(path).not.toBeNull();
      expect(await listMusic(dir)).toContainEqual(
        expect.objectContaining({ id: basename(path!) }),
      );
    });

    it("refuses a name that climbs out of the music directory", async () => {
      // bgm_file arrives over the wire; a path must not reach the filesystem.
      expect(await resolveTrack("file", "../../etc/passwd", dir)).toBeNull();
      expect(await resolveTrack("file", "/etc/passwd", dir)).toBeNull();
    });

    it("returns nothing for a track that is not there", async () => {
      expect(await resolveTrack("file", "missing.mp3", dir)).toBeNull();
    });

    it("returns nothing when the directory is empty", async () => {
      const empty = await mkdtemp(join(tmpdir(), "tasawwur-empty-"));
      try {
        expect(await resolveTrack("random", "", empty)).toBeNull();
      } finally {
        await rm(empty, { recursive: true, force: true });
      }
    });
  });
});
