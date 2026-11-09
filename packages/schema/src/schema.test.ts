import { describe, expect, it } from "vitest";
import {
  ASPECT_RESOLUTION,
  TaskState,
  TaskStatusData,
  VideoParams,
  isFailed,
  isTerminal,
  streamUrl,
  toStreamPath,
} from "./index.ts";

/**
 * These lock the wire contract against the Python engine. If one fails after a
 * change, the GUI and the engine have drifted apart — fix the drift, do not
 * relax the test.
 */

describe("VideoParams", () => {
  it("parses an empty object into engine defaults", () => {
    const d = VideoParams.parse({});
    expect(d.video_aspect).toBe("9:16");
    expect(d.video_clip_duration).toBe(5);
    expect(d.video_source).toBe("pexels");
    expect(d.subtitle_display_mode).toBe("sentence");
    expect(d.bgm_volume).toBe(0.2);
    expect(d.font_size).toBe(60);
  });

  it("accepts the params that produced the reference water video", () => {
    const p = VideoParams.parse({
      video_script: "A river has no plan.",
      video_terms: "waterfall, river water, rain window",
      video_aspect: "9:16",
      video_clip_duration: 5,
      video_transition_mode: null,
      voice_name: "am_michael",
      subtitle_display_mode: "sentence",
      font_name: "BeVietnamPro-Bold.ttf",
      font_size: 55,
      bgm_volume: 0.1,
    });
    expect(p.voice_name).toBe("am_michael");
    expect(p.video_transition_mode).toBeNull();
  });

  it("accepts video_terms as either a string or an array", () => {
    expect(VideoParams.safeParse({ video_terms: "a, b" }).success).toBe(true);
    expect(VideoParams.safeParse({ video_terms: ["a", "b"] }).success).toBe(true);
  });

  it.each([
    ["an unsupported aspect", { video_aspect: "4:3" }],
    ["paragraph_number above the engine max of 10", { paragraph_number: 11 }],
    ["a negative bgm_volume", { bgm_volume: -1 }],
    ["a zero clip duration", { video_clip_duration: 0 }],
    ["a non-positive voice_rate", { voice_rate: 0 }],
    ["an unknown subtitle animation", { subtitle_animation: "bounce" }],
  ])("rejects %s", (_label, input) => {
    expect(VideoParams.safeParse(input).success).toBe(false);
  });

  it("matches the engine's VideoParams field count exactly", () => {
    // Guards against silently dropping a field the engine still expects.
    expect(Object.keys(VideoParams.shape)).toHaveLength(40);
  });
});

describe("ASPECT_RESOLUTION", () => {
  it("maps each aspect to the engine's target size", () => {
    expect(ASPECT_RESOLUTION["9:16"]).toEqual([1080, 1920]);
    expect(ASPECT_RESOLUTION["16:9"]).toEqual([1920, 1080]);
    expect(ASPECT_RESOLUTION["1:1"]).toEqual([1080, 1080]);
  });
});

describe("toStreamPath", () => {
  // Verified against a live server: keeping the "tasks/" prefix returns 404.
  it("strips the tasks/ prefix the controller adds", () => {
    expect(toStreamPath("/tasks/abc-123/final-1.mp4")).toBe("abc-123/final-1.mp4");
    expect(toStreamPath("tasks/abc-123/audio.mp3")).toBe("abc-123/audio.mp3");
  });

  it("leaves absolute URLs alone", () => {
    const cdn = "https://cdn.example.com/a.mp4";
    expect(toStreamPath(cdn)).toBe(cdn);
  });

  it("builds a playable URL without doubling slashes", () => {
    expect(streamUrl("http://x/api/v1/", "/tasks/t/final-1.mp4")).toBe(
      "http://x/api/v1/stream/t/final-1.mp4",
    );
  });
});

describe("task state", () => {
  const base = { task_id: "t", progress: 0 };

  it("uses the engine's numeric states, not 0/1/2", () => {
    expect(TaskState.failed).toBe(-1);
    expect(TaskState.complete).toBe(1);
    expect(TaskState.processing).toBe(4);
  });

  it("treats complete and failed as terminal, processing as not", () => {
    expect(isTerminal(TaskStatusData.parse({ ...base, state: 1 }))).toBe(true);
    expect(isTerminal(TaskStatusData.parse({ ...base, state: -1 }))).toBe(true);
    expect(isTerminal(TaskStatusData.parse({ ...base, state: 4 }))).toBe(false);
  });

  it("detects failure", () => {
    expect(isFailed(TaskStatusData.parse({ ...base, state: -1 }))).toBe(true);
    expect(isFailed(TaskStatusData.parse({ ...base, state: 1 }))).toBe(false);
  });

  it("tolerates the undocumented fields the server actually sends", () => {
    const s = TaskStatusData.parse({
      ...base,
      state: 1,
      warnings: [{ code: "batch_materials_reused", video_index: 1 }],
      failed_video_index: null,
      audio_file: "/tasks/t/audio.mp3",
    });
    expect(s.warnings?.[0]?.code).toBe("batch_materials_reused");
    expect(s.audio_file).toBe("/tasks/t/audio.mp3");
  });
});
