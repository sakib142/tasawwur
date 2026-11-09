import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { VideoParams } from "@tasawwur/schema";
import { renderVideo, type PipelineEvent } from "./pipeline.ts";
import { readSettings } from "./settings.ts";

/**
 * Tracking render jobs.
 *
 * Rendering takes minutes, so a job outlives the request that started it. State
 * is kept in memory for the live view and written to disk alongside the output,
 * so a finished video is still findable after a restart — losing the record of
 * a render that actually succeeded is worse than losing the progress bar.
 */

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Job {
  id: string;
  state: JobState;
  progress: number;
  stage: string;
  detail?: string;
  error?: string;
  createdAt: number;
  finishedAt?: number;
  /** Relative to the storage root, so moving the folder does not break them. */
  video?: string;
  durationSeconds?: number;
  params: VideoParams;
}

export interface JobEvent {
  type: "progress" | "done" | "error";
  job: Job;
}

type Listener = (event: JobEvent) => void;

const jobs = new Map<string, Job>();
const listeners = new Map<string, Set<Listener>>();
const controllers = new Map<string, AbortController>();

export function storageRoot(): string {
  if (process.env.TASAWWUR_STORAGE) return process.env.TASAWWUR_STORAGE;
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "tasawwur", "storage");
  }
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "tasawwur", "storage");
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "tasawwur", "storage");
}

export const jobDir = (id: string) => join(storageRoot(), "videos", id);
export const materialsDir = () => join(storageRoot(), "materials");

/**
 * Fonts ship with this package.
 *
 * Resolved from this module's own location rather than the working directory,
 * which differs depending on whether the app, a test, or a script is running.
 */
export function fontsDir(): string {
  if (process.env.TASAWWUR_FONTS) return process.env.TASAWWUR_FONTS;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");
}

async function persist(job: Job) {
  try {
    await mkdir(jobDir(job.id), { recursive: true });
    await writeFile(join(jobDir(job.id), "job.json"), JSON.stringify(job, null, 2), "utf8");
  } catch {
    // The in-memory record still works; a failed write must not kill a render.
  }
}

function announce(job: Job, type: JobEvent["type"]) {
  for (const listener of listeners.get(job.id) ?? []) {
    try {
      listener({ type, job: { ...job } });
    } catch {
      // A broken listener is not the job's problem.
    }
  }
}

export function subscribe(id: string, listener: Listener): () => void {
  const set = listeners.get(id) ?? new Set();
  set.add(listener);
  listeners.set(id, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
}

export async function getJob(id: string): Promise<Job | null> {
  const live = jobs.get(id);
  if (live) return { ...live };
  // Not in memory: it may predate a restart, but the output survives.
  try {
    return JSON.parse(await readFile(join(jobDir(id), "job.json"), "utf8")) as Job;
  } catch {
    return null;
  }
}

export async function listJobs(limit = 50): Promise<Job[]> {
  const root = join(storageRoot(), "videos");
  let ids: string[];
  try {
    ids = await readdir(root);
  } catch {
    return [];
  }
  const found = await Promise.all(ids.map((id) => getJob(id)));
  return found
    .filter((j): j is Job => j !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function cancelJob(id: string): boolean {
  const controller = controllers.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

export async function deleteJob(id: string): Promise<void> {
  cancelJob(id);
  jobs.delete(id);
  await rm(jobDir(id), { recursive: true, force: true });
}

/**
 * Start a render and return immediately.
 *
 * The work runs in the background of this process — fine for a long-lived
 * server, and the reason this cannot be a serverless deployment.
 */
export async function startJob(
  params: VideoParams,
  resolvedMaterials?: string[],
): Promise<Job> {
  const id = randomUUID();
  const job: Job = {
    id,
    state: "queued",
    progress: 0,
    stage: "Starting",
    createdAt: Date.now(),
    params,
  };
  jobs.set(id, job);
  await persist(job);

  const controller = new AbortController();
  controllers.set(id, controller);

  void (async () => {
    const update = (patch: Partial<Job>, type: JobEvent["type"] = "progress") => {
      Object.assign(job, patch);
      jobs.set(id, job);
      announce(job, type);
      void persist(job);
    };

    update({ state: "running" });

    try {
      const settings = await readSettings();
      const result = await renderVideo({
        params,
        workDir: jobDir(id),
        fontsDir: fontsDir(),
        pixabayApiKey: settings.pixabayApiKey,
        resolvedMaterials,
        signal: controller.signal,
        onEvent: (event: PipelineEvent) =>
          update({ progress: event.progress, stage: event.label, detail: event.detail }),
      });

      update(
        {
          state: "done",
          progress: 100,
          stage: "Done",
          detail: undefined,
          video: `videos/${id}/final.mp4`,
          durationSeconds: result.durationSeconds,
          finishedAt: Date.now(),
        },
        "done",
      );
    } catch (cause) {
      const cancelled = controller.signal.aborted;
      update(
        {
          state: cancelled ? "cancelled" : "failed",
          error: cancelled
            ? "Cancelled."
            : cause instanceof Error
              ? cause.message
              : "Rendering failed.",
          finishedAt: Date.now(),
        },
        "error",
      );
    } finally {
      controllers.delete(id);
    }
  })();

  return { ...job };
}
