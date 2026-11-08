import { z } from "zod";
import { TaskState } from "./enums.ts";

/**
 * Response contracts for the rendering API. Every response is wrapped in the
 * same envelope.
 *
 * The GUI talks to this contract today via an external engine. As each service
 * is implemented here the contract stays fixed — it is the stable boundary.
 */

/** Every endpoint returns { status, message, data }. */
const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    status: z.number().int(),
    message: z.string().nullish(),
    data,
  });

/** POST /videos | /subtitle | /audio — returns only the id; poll for the rest. */
export const TaskCreated = envelope(z.object({ task_id: z.string() }));
export type TaskCreated = z.infer<typeof TaskCreated>;

/**
 * GET /tasks/{id}. `progress` is 0-100 and advances in fixed steps:
 * 5 script, 10 terms, 20 audio, 30 subtitle, 40 materials, 50 render, 100 done.
 */
export const TaskStatusData = z.object({
  task_id: z.string(),
  /** -1 failed, 1 complete, 4 processing — see TaskState. */
  state: z.number().int(),
  progress: z.number().int(),
  /** Finished renders. Populated incrementally when video_count > 1. */
  videos: z.array(z.string()).nullish(),
  /** Footage-only intermediates, before captions and audio were muxed in. */
  combined_videos: z.array(z.string()).nullish(),
  /** Which pipeline stage failed: script|terms|audio|subtitle|materials|video. */
  failed_stage: z.string().nullish(),
  error: z.string().nullish(),
  cross_post_state: z.string().nullish(),
  cross_post_results: z.array(z.unknown()).nullish(),
  cross_post_error: z.string().nullish(),

  // Present on real responses but absent from the published OpenAPI schema —
  // the controller adds them dynamically from task state.
  /** Non-fatal degradations, e.g. { code: "batch_materials_reused", video_index }. */
  warnings: z.array(z.record(z.string(), z.unknown())).nullish(),
  failed_video_index: z.number().int().nullish(),

  // Stage-scoped outputs, present only for the matching stop_at request.
  audio_file: z.string().nullish(),
  subtitle_path: z.string().nullish(),
  materials: z.array(z.string()).nullish(),
  script: z.string().nullish(),
  terms: z.union([z.string(), z.array(z.string())]).nullish(),
});
export type TaskStatusData = z.infer<typeof TaskStatusData>;
export const TaskStatus = envelope(TaskStatusData);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** GET /tasks — paginated. */
export const TaskList = envelope(
  z.object({
    tasks: z.array(z.record(z.string(), z.unknown())),
    total: z.number().int(),
    page: z.number().int(),
    page_size: z.number().int(),
  }),
);
export type TaskList = z.infer<typeof TaskList>;

/** GET /musics and GET /video_materials both return a file list. */
export const FileList = envelope(z.object({ files: z.array(z.unknown()) }));
export type FileList = z.infer<typeof FileList>;

// ---- helpers ---------------------------------------------------------------

export const isTerminal = (s: TaskStatusData): boolean =>
  s.state === TaskState.complete || s.state === TaskState.failed;

export const isFailed = (s: TaskStatusData): boolean => s.state === TaskState.failed;

/**
 * Task outputs come back as URIs rooted at the task directory — the controller
 * has already rewritten absolute host paths via _task_file_to_uri:
 *
 *   "/tasks/<task_id>/final-1.mp4"
 *
 * but /stream and /download resolve relative to that same directory, so the
 * "tasks/" segment has to come off. Verified against a live 1.3.9 server:
 * keeping the prefix returns 404.
 *
 * Absolute URLs (a provider CDN) are returned untouched.
 */
export const toStreamPath = (uri: string): string => {
  if (/^https?:\/\//.test(uri)) return uri;
  return uri.replace(/^\/?tasks\//, "");
};

/** Build a playable URL for a task output. */
export const streamUrl = (apiBase: string, uri: string): string => {
  if (/^https?:\/\//.test(uri)) return uri;
  return `${apiBase.replace(/\/$/, "")}/stream/${toStreamPath(uri)}`;
};
