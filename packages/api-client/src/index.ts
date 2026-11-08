import {
  FileList,
  TaskCreated,
  TaskStatus,
  type TaskStatusData,
  VideoParams,
  type VideoParamsInput,
  isTerminal,
  streamUrl,
} from "@tasawwur/schema";

export class ApiError extends Error {
  // Written out longhand rather than as constructor parameter properties:
  // those are not supported by Node's type-stripping, and this package is
  // imported directly by the worker without a build step.
  readonly status: number;
  readonly path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
  }
}

export interface ClientOptions {
  /** Base URL including the version prefix, e.g. http://127.0.0.1:8080/api/v1 */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE = "http://127.0.0.1:8080/api/v1";

/**
 * Typed client for the generation API.
 *
 * Stage 1 points this at the Python server. Stages 2-3 swap the implementation
 * behind the same routes, so nothing above this layer has to change.
 */
export class TasawwurClient {
  private readonly base: string;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(opts: ClientOptions = {}) {
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(
    path: string,
    schema: { parse: (v: unknown) => T },
    init?: RequestInit,
  ): Promise<T> {
    const res = await this.doFetch(`${this.base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiError(`Non-JSON response (HTTP ${res.status})`, res.status, path);
    }

    // The API returns its own status inside the envelope and does not always
    // set a matching HTTP code, so check both.
    const envelopeStatus =
      typeof body === "object" && body !== null && "status" in body
        ? Number((body as { status: unknown }).status)
        : res.status;

    if (!res.ok || envelopeStatus >= 400) {
      const message =
        typeof body === "object" && body !== null && "message" in body
          ? String((body as { message: unknown }).message)
          : res.statusText;
      throw new ApiError(message, envelopeStatus, path);
    }

    return schema.parse(body);
  }

  /** Kick off a full render. Returns immediately with a task id. */
  async createVideo(params: VideoParamsInput): Promise<string> {
    const body = VideoParams.parse(params);
    const res = await this.request("/videos", TaskCreated, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return res.data.task_id;
  }

  /** Narration only — no footage, no render. Useful for previewing a voice. */
  async createAudio(params: VideoParamsInput): Promise<string> {
    const body = VideoParams.parse(params);
    const res = await this.request("/audio", TaskCreated, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return res.data.task_id;
  }

  async getTask(taskId: string): Promise<TaskStatusData> {
    const res = await this.request(`/tasks/${encodeURIComponent(taskId)}`, TaskStatus);
    return res.data;
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.doFetch(`${this.base}/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
    });
  }

  async listMusic(): Promise<unknown[]> {
    const res = await this.request("/musics", FileList);
    return res.data.files;
  }

  /** Playable URL for a task output URI from `videos`/`audio_file`/etc. */
  streamUrl(uri: string): string {
    return streamUrl(this.base, uri);
  }

  /**
   * Poll until the task reaches a terminal state.
   *
   * Renders run for minutes, so the default interval is deliberately relaxed;
   * this is a fallback for callers without a live log stream.
   */
  async waitForTask(
    taskId: string,
    opts: {
      intervalMs?: number;
      timeoutMs?: number;
      signal?: AbortSignal;
      onProgress?: (s: TaskStatusData) => void;
    } = {},
  ): Promise<TaskStatusData> {
    const { intervalMs = 2000, timeoutMs = 30 * 60_000, signal, onProgress } = opts;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      if (signal?.aborted) throw new Error("Polling aborted");
      const status = await this.getTask(taskId);
      onProgress?.(status);
      if (isTerminal(status)) return status;
      if (Date.now() > deadline) {
        throw new Error(`Task ${taskId} did not finish within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
