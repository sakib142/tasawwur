import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Running ffmpeg, and finding out what this particular build can do.
 *
 * Builds differ enormously in which filters and encoders they include — the
 * one this was developed against has no text filters at all — so capabilities
 * are probed rather than assumed, and an encoder is only used after it has
 * actually encoded a frame.
 */

export class RenderError extends Error {
  readonly command?: string;
  readonly stderrTail?: string;

  constructor(message: string, opts: { command?: string; stderrTail?: string } = {}) {
    super(message);
    this.name = "RenderError";
    this.command = opts.command;
    this.stderrTail = opts.stderrTail;
  }
}

export interface Capabilities {
  ffmpegPath: string;
  ffprobePath: string;
  version: string;
  /** Encoders that exist AND produced a frame when tried. */
  workingEncoders: string[];
  filters: Set<string>;
}

let cached: Promise<Capabilities> | null = null;

/** Preference order: predictable software encoding first, hardware as an opt-in. */
const CANDIDATE_ENCODERS = ["libx264", "h264_videotoolbox", "h264_nvenc", "h264_qsv"];

/**
 * An encoder can be listed and still fail at runtime — hardware encoders in
 * particular, when no device is available. The only reliable test is to encode
 * something, so each candidate renders one frame of colour to null.
 */
async function encoderWorks(ffmpeg: string, encoder: string): Promise<boolean> {
  try {
    await run(
      ffmpeg,
      [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.1",
        "-c:v", encoder, "-frames:v", "1", "-f", "null", "-",
      ],
      { timeout: 20_000 },
    );
    return true;
  } catch {
    return false;
  }
}

export async function capabilities(
  ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg",
  ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe",
): Promise<Capabilities> {
  cached ??= (async () => {
    let version: string;
    try {
      const { stdout } = await run(ffmpegPath, ["-version"], { timeout: 15_000 });
      version = stdout.split("\n")[0] ?? "unknown";
    } catch {
      throw new RenderError(
        `ffmpeg not found at “${ffmpegPath}”. Install it, or set FFMPEG_PATH.`,
      );
    }

    const { stdout: filterList } = await run(
      ffmpegPath,
      ["-hide_banner", "-filters"],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const filters = new Set(
      filterList
        .split("\n")
        .map((line) => line.trim().split(/\s+/)[1])
        .filter((name): name is string => Boolean(name)),
    );

    const { stdout: encoderList } = await run(
      ffmpegPath,
      ["-hide_banner", "-encoders"],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
    );

    const workingEncoders: string[] = [];
    for (const encoder of CANDIDATE_ENCODERS) {
      if (!encoderList.includes(encoder)) continue;
      if (await encoderWorks(ffmpegPath, encoder)) workingEncoders.push(encoder);
    }

    if (workingEncoders.length === 0) {
      throw new RenderError(
        "No usable H.264 encoder. Install an ffmpeg built with libx264.",
      );
    }

    return { ffmpegPath, ffprobePath, version, workingEncoders, filters };
  })();

  try {
    return await cached;
  } catch (error) {
    cached = null; // a failed probe must not be cached for the process lifetime
    throw error;
  }
}

/** For tests, and for retrying after an ffmpeg is installed mid-session. */
export function resetCapabilities() {
  cached = null;
}

export interface MediaInfo {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export async function probe(path: string, ffprobePath = "ffprobe"): Promise<MediaInfo> {
  try {
    const { stdout } = await run(
      ffprobePath,
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-show_entries", "stream=codec_type,width,height",
        "-of", "json",
        path,
      ],
      { timeout: 30_000 },
    );
    const data = JSON.parse(stdout);
    const streams: Array<Record<string, unknown>> = data.streams ?? [];
    const video = streams.find((s) => s.codec_type === "video");
    return {
      durationSeconds: Number(data.format?.duration ?? 0),
      width: Number(video?.width ?? 0),
      height: Number(video?.height ?? 0),
      hasAudio: streams.some((s) => s.codec_type === "audio"),
    };
  } catch {
    throw new RenderError(`Could not read “${path}”. It may be corrupt or not a video.`);
  }
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Called with ffmpeg's reported position, for progress. */
  onProgress?: (seconds: number) => void;
  timeoutMs?: number;
}

/**
 * Run ffmpeg to completion.
 *
 * stderr is kept but only surfaced on failure: ffmpeg writes its entire
 * progress log there, and dumping it on success buries anything that matters.
 */
export function ffmpeg(args: string[], opts: RunOptions = {}): Promise<void> {
  const { signal, onProgress, timeoutMs = 60 * 60_000 } = opts;

  return capabilities().then(
    ({ ffmpegPath }) =>
      new Promise<void>((resolve, reject) => {
        const full = ["-hide_banner", "-nostdin", "-y", ...args];
        const child = spawn(ffmpegPath, full, { stdio: ["ignore", "ignore", "pipe"] });

        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new RenderError(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)}s.`));
        }, timeoutMs);

        child.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          // Keep only the tail: a long encode produces megabytes of progress.
          stderr = (stderr + text).slice(-8000);
          if (onProgress) {
            const match = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(text);
            if (match) {
              onProgress(+match[1]! * 3600 + +match[2]! * 60 + +match[3]!);
            }
          }
        });

        signal?.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });

        child.on("error", (error) => {
          clearTimeout(timer);
          reject(new RenderError(`Could not start ffmpeg: ${error.message}`));
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve();
            return;
          }
          if (signal?.aborted) {
            reject(new RenderError("Rendering cancelled."));
            return;
          }
          reject(
            new RenderError(`ffmpeg exited with code ${code}.`, {
              command: `ffmpeg ${full.join(" ")}`,
              stderrTail: stderr.trim().split("\n").slice(-12).join("\n"),
            }),
          );
        });
      }),
  );
}
