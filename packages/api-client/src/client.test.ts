import { afterAll, describe, expect, it } from "vitest";
import { TasawwurClient } from "./index.ts";

/**
 * Integration tests — these drive a REAL engine and a REAL TTS endpoint.
 *
 * They skip themselves when nothing is listening, so `pnpm test` stays green
 * on a machine with no backend. To run them, start the engine first:
 *     see docs/RUNNING.md
 */
const BASE = process.env.TASAWWUR_API ?? "http://127.0.0.1:8080/api/v1";

const engineUp = await fetch(`${BASE.replace(/\/api\/v1$/, "")}/ping`, {
  signal: AbortSignal.timeout(2000),
})
  .then((r) => r.ok)
  .catch(() => false);

const api = new TasawwurClient({ baseUrl: BASE });
const created: string[] = [];

afterAll(async () => {
  // Leave no task records behind on a shared engine.
  await Promise.allSettled(created.map((id) => api.deleteTask(id)));
});

describe.skipIf(!engineUp)("TasawwurClient against a live engine", () => {
  it("rejects an unknown task with a typed ApiError", async () => {
    await expect(
      api.getTask("00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ name: "ApiError", status: 404 });
  });

  it("validates params before sending anything", async () => {
    // Fails locally in zod — never reaches the network.
    await expect(api.createVideo({ video_aspect: "4:3" } as never)).rejects.toThrow();
  });

  it(
    "runs an audio-only task end to end and serves byte ranges",
    async () => {
      const id = await api.createAudio({
        video_subject: "integration",
        video_script: "Water always finds a way.",
        voice_name: "en-US-AvaNeural-Female",
      });
      created.push(id);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      const seen: number[] = [];
      const done = await api.waitForTask(id, {
        intervalMs: 1000,
        timeoutMs: 90_000,
        onProgress: (s) => seen.push(s.progress),
      });

      expect(done.state).toBe(1);
      expect(done.error).toBeFalsy();
      expect(done.audio_file).toMatch(/^\/tasks\/.+\/audio\.mp3$/);
      // Progress must advance, not jump straight to done.
      expect(Math.max(...seen)).toBe(100);

      const url = api.streamUrl(done.audio_file!);
      const head = await fetch(url, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(Number(head.headers.get("content-length"))).toBeGreaterThan(1000);

      const ranged = await fetch(url, { headers: { Range: "bytes=0-1023" } });
      expect(ranged.status).toBe(206);
      expect((await ranged.arrayBuffer()).byteLength).toBe(1024);
    },
    120_000,
  );
});

describe.skipIf(engineUp)("engine not running", () => {
  it("skipped the integration suite", () => {
    expect(engineUp).toBe(false);
  });
});
