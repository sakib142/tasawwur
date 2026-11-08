import { PipelineStage, TaskState, type TaskStatusData } from "@tasawwur/schema";

/**
 * Task events.
 *
 * The browser gets one stream instead of a poll loop. Events are derived
 * server-side so the client never has to infer anything from raw numbers, and
 * so that services implemented here can publish richer entries into the same
 * channel as they land.
 */
export type TaskEvent =
  | { type: "stage"; stage: string; label: string; progress: number; at: number }
  | { type: "progress"; progress: number; at: number }
  | { type: "log"; level: "info" | "warn"; message: string; at: number }
  | { type: "done"; videos: string[]; elapsedMs: number; at: number }
  | { type: "error"; message: string; stage?: string; at: number };

/**
 * Progress checkpoints the pipeline writes, and what each means in plain words.
 * Derived from the observable progress value, which is the only signal the
 * current renderer exposes.
 */
const CHECKPOINTS: ReadonlyArray<{ at: number; stage: string; label: string }> = [
  { at: 5, stage: "script", label: "Writing the script" },
  { at: 10, stage: "terms", label: "Choosing search terms" },
  { at: 20, stage: "audio", label: "Recording narration" },
  { at: 30, stage: "subtitle", label: "Timing captions" },
  { at: 40, stage: "materials", label: "Finding footage" },
  { at: 50, stage: "video", label: "Cutting and rendering" },
];

export function checkpointFor(progress: number) {
  let current = CHECKPOINTS[0]!;
  for (const c of CHECKPOINTS) if (progress >= c.at) current = c;
  return current;
}

export interface StreamOptions {
  /** How often to ask the renderer for status. */
  pollMs?: number;
  /** Give up after this long with no terminal state. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Turn a polled task into a stream of meaningful events.
 *
 * The renderer only exposes a progress number, so the interesting work is here:
 * emit a `stage` event when the pipeline actually crosses into a new phase,
 * rather than repeating the same percentage every second.
 */
export async function* streamTask(
  getStatus: () => Promise<TaskStatusData>,
  opts: StreamOptions = {},
): AsyncGenerator<TaskEvent> {
  const { pollMs = 1000, timeoutMs = 30 * 60_000, signal } = opts;
  const started = Date.now();

  let lastStage: string | null = null;
  let lastProgress = -1;
  let reportedWarnings = 0;

  for (;;) {
    if (signal?.aborted) return;

    let status: TaskStatusData;
    try {
      status = await getStatus();
    } catch (cause) {
      yield {
        type: "error",
        message: cause instanceof Error ? cause.message : "Lost contact with the renderer.",
        at: Date.now(),
      };
      return;
    }

    // A terminal status says nothing useful about which stage we are in — a
    // task that stopped early would otherwise report entering a stage it never
    // ran. Let the done/error event speak instead.
    const terminal =
      status.state === TaskState.complete || status.state === TaskState.failed;

    const checkpoint = checkpointFor(status.progress);
    if (!terminal && checkpoint.stage !== lastStage) {
      lastStage = checkpoint.stage;
      yield {
        type: "stage",
        stage: checkpoint.stage,
        label: checkpoint.label,
        progress: status.progress,
        at: Date.now(),
      };
    } else if (!terminal && status.progress !== lastProgress) {
      yield { type: "progress", progress: status.progress, at: Date.now() };
    }
    lastProgress = status.progress;

    // Warnings arrive mid-render; surface each one once, as it appears.
    const warnings = status.warnings ?? [];
    for (const w of warnings.slice(reportedWarnings)) {
      yield {
        type: "log",
        level: "warn",
        message: String(w.code ?? "warning"),
        at: Date.now(),
      };
    }
    reportedWarnings = warnings.length;

    if (status.state === TaskState.failed) {
      yield {
        type: "error",
        message: status.error ?? "Rendering failed.",
        stage: status.failed_stage ?? undefined,
        at: Date.now(),
      };
      return;
    }

    if (status.state === TaskState.complete) {
      yield {
        type: "done",
        videos: status.videos ?? [],
        elapsedMs: Date.now() - started,
        at: Date.now(),
      };
      return;
    }

    if (Date.now() - started > timeoutMs) {
      yield {
        type: "error",
        message: `Gave up waiting after ${Math.round(timeoutMs / 60_000)} minutes.`,
        at: Date.now(),
      };
      return;
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Serialise one event as an SSE frame. */
export function toSseFrame(event: TaskEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export const PIPELINE_STAGES = PipelineStage.options;
