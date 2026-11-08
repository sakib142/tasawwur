import { describe, expect, it } from "vitest";
import type { TaskStatusData } from "@tasawwur/schema";
import { checkpointFor, streamTask, toSseFrame, type TaskEvent } from "./index.ts";

const status = (over: Partial<TaskStatusData>): TaskStatusData =>
  ({ task_id: "t", state: 4, progress: 0, ...over }) as TaskStatusData;

/** Replays a fixed sequence of statuses, one per poll. */
function scripted(sequence: TaskStatusData[]) {
  let i = 0;
  return async () => sequence[Math.min(i++, sequence.length - 1)]!;
}

async function collect(gen: AsyncGenerator<TaskEvent>) {
  const out: TaskEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("checkpointFor", () => {
  it("names the stage the pipeline is actually in", () => {
    expect(checkpointFor(5).stage).toBe("script");
    expect(checkpointFor(20).stage).toBe("audio");
    expect(checkpointFor(45).stage).toBe("materials");
    expect(checkpointFor(99).stage).toBe("video");
  });

  it("holds the previous stage between checkpoints", () => {
    // Progress creeps during the render stage; it must not fall back a stage.
    expect(checkpointFor(63).stage).toBe("video");
  });
});

describe("streamTask", () => {
  it("emits one stage event per stage, not one per poll", async () => {
    const events = await collect(
      streamTask(
        scripted([
          status({ progress: 5 }),
          status({ progress: 5 }), // same stage, no repeat
          status({ progress: 20 }),
          status({ progress: 50 }), // render begins while still processing
          status({ progress: 70 }), // still rendering, no new stage
          status({ state: 1, progress: 100, videos: ["/tasks/t/final-1.mp4"] }),
        ]),
        { pollMs: 0 },
      ),
    );
    const stages = events.filter((e) => e.type === "stage");
    expect(stages.map((e) => (e as { stage: string }).stage)).toEqual([
      "script",
      "audio",
      "video",
    ]);
  });

  it("does not claim a stage the task never entered", async () => {
    // An audio-only task finishes at progress 100 without rendering video.
    const events = await collect(
      streamTask(scripted([status({ state: 1, progress: 100 })]), { pollMs: 0 }),
    );
    expect(events.filter((e) => e.type === "stage")).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("done");
  });

  it("ends with a done event carrying the outputs and elapsed time", async () => {
    const events = await collect(
      streamTask(
        scripted([status({ state: 1, progress: 100, videos: ["/tasks/t/final-1.mp4"] })]),
        { pollMs: 0 },
      ),
    );
    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    expect((done as { videos: string[] }).videos).toEqual(["/tasks/t/final-1.mp4"]);
    expect((done as { elapsedMs: number }).elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("reports the failing stage, not just the message", async () => {
    const events = await collect(
      streamTask(
        scripted([status({ state: -1, error: "no footage", failed_stage: "materials" })]),
        { pollMs: 0 },
      ),
    );
    expect(events.at(-1)).toMatchObject({
      type: "error",
      message: "no footage",
      stage: "materials",
    });
  });

  it("surfaces each warning once, as it appears", async () => {
    const events = await collect(
      streamTask(
        scripted([
          status({ progress: 50, warnings: [{ code: "batch_materials_reused" }] }),
          status({ progress: 50, warnings: [{ code: "batch_materials_reused" }] }),
          status({ state: 1, progress: 100, warnings: [{ code: "batch_materials_reused" }] }),
        ]),
        { pollMs: 0 },
      ),
    );
    expect(events.filter((e) => e.type === "log")).toHaveLength(1);
  });

  it("ends the stream when the renderer becomes unreachable", async () => {
    const events = await collect(
      streamTask(
        async () => {
          throw new Error("connection refused");
        },
        { pollMs: 0 },
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", message: "connection refused" });
  });

  it("gives up rather than streaming forever", async () => {
    const events = await collect(
      streamTask(scripted([status({ progress: 50 })]), { pollMs: 0, timeoutMs: 0 }),
    );
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect((events.at(-1) as { message: string }).message).toMatch(/gave up/i);
  });

  it("stops promptly when the caller aborts", async () => {
    const ac = new AbortController();
    ac.abort();
    const events = await collect(
      streamTask(scripted([status({ progress: 50 })]), { pollMs: 0, signal: ac.signal }),
    );
    expect(events).toHaveLength(0);
  });
});

describe("toSseFrame", () => {
  it("writes a named event the browser can listen for", () => {
    const frame = toSseFrame({ type: "stage", stage: "audio", label: "x", progress: 20, at: 1 });
    expect(frame.startsWith("event: stage\n")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(JSON.parse(frame.split("data: ")[1]!.trim())).toMatchObject({ stage: "audio" });
  });
});
