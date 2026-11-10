import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RenderError, ffmpeg, probe } from "./ffmpeg.ts";
import type { Frame } from "./captions.ts";

/**
 * Joining the normalised clips, laying the captions over them, and mixing the
 * audio into a finished file.
 */

/** A small margin past the narration, to absorb frame rounding. */
export const DURATION_MARGIN_SECONDS = 0.1;

export interface AssembleOptions {
  /** Normalised clips, in order. */
  clips: string[];
  /** Narration. Its length decides the length of the video. */
  narration: string;
  captions: Frame[];
  music?: { path: string; volume: number } | null;
  /** Filters this ffmpeg has; decides whether music can duck under speech. */
  availableFilters?: ReadonlySet<string>;
  narrationVolume: number;
  output: string;
  workDir: string;
  fps: number;
  encoder: string;
  signal?: AbortSignal;
  onProgress?: (seconds: number) => void;
}

/** ffconcat needs paths escaped; a quote or backslash in one otherwise breaks it. */
function escapeConcatPath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
}

/**
 * Join clips, looping them if they do not cover the narration.
 *
 * Running out of footage is the one failure the viewer cannot miss — the video
 * simply stops while the voice continues — so clips repeat rather than the
 * video ending early.
 *
 * The shortfall has to be worth covering, though. Encoding rounds each clip to
 * the frame, so a set cut to exactly the right length still lands a few
 * milliseconds short; covering that by appending another whole clip put a
 * single frame of unrelated footage at the end of the video. The target
 * already carries DURATION_MARGIN_SECONDS of slack for precisely this, so
 * anything inside it counts as covered.
 */
export async function concatClips(
  clips: string[],
  targetSeconds: number,
  workDir: string,
  signal?: AbortSignal,
): Promise<string> {
  if (clips.length === 0) throw new RenderError("There are no clips to join.");

  const durations = await Promise.all(clips.map((c) => probe(c).then((i) => i.durationSeconds)));
  const total = durations.reduce((n, d) => n + d, 0);
  if (total <= 0) throw new RenderError("The clips report no duration between them.");

  const ordered: string[] = [];
  let covered = 0;
  const enough = targetSeconds - DURATION_MARGIN_SECONDS;
  for (let i = 0; covered < enough; i++) {
    const at = i % clips.length;
    ordered.push(clips[at]!);
    covered += durations[at]!;
    // Guard against a pathological loop if durations are tiny.
    if (ordered.length > 500) break;
  }

  const listFile = join(workDir, "concat.txt");
  await writeFile(
    listFile,
    ordered.map((c) => `file '${escapeConcatPath(c)}'`).join("\n") + "\n",
    "utf8",
  );

  const output = join(workDir, "joined.mp4");
  // Stream copy: the clips were normalised to identical settings precisely so
  // this costs nothing and loses no quality.
  await ffmpeg(
    ["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", output],
    { signal },
  );
  return output;
}

/**
 * Lay the captions over the video and mix the audio.
 *
 * Captions are pre-rendered full-frame PNGs, so each is a plain overlay gated
 * to its own time range. The chain is built rather than looped in ffmpeg
 * because cues have individual timings.
 */
export async function assemble(opts: AssembleOptions): Promise<string> {
  const {
    clips, narration, captions, music, narrationVolume, availableFilters,
    output, workDir, fps, encoder, signal, onProgress,
  } = opts;

  await mkdir(workDir, { recursive: true });

  const narrationInfo = await probe(narration);
  if (narrationInfo.durationSeconds <= 0) {
    throw new RenderError("The narration audio is empty.");
  }

  // Measured from the written file rather than from the caption timeline: a
  // speech synthesiser leaves silence after the final word — around 0.9s,
  // which is a fifth of a short clip — and sizing the video from the last cue
  // leaves the picture ending before the voice does.
  const target = narrationInfo.durationSeconds + DURATION_MARGIN_SECONDS;

  const joined = await concatClips(clips, target, workDir, signal);

  // Input 0 is the joined video, input 1 the narration, then one per caption.
  const inputs = ["-i", joined, "-i", narration];
  for (const [index, caption] of captions.entries()) {
    inputs.push("-i", await writeCaption(caption, workDir, index));
  }

  // Build the caption overlay chain. Each PNG covers the whole frame, so the
  // only per-cue detail is when it is visible.
  const filters: string[] = [];
  let videoLabel = "0:v";
  captions.forEach((caption, i) => {
    const next = `v${i}`;
    filters.push(
      `[${videoLabel}][${i + 2}:v]overlay=0:0:enable='between(t,${caption.start.toFixed(3)},${caption.end.toFixed(3)})'[${next}]`,
    );
    videoLabel = next;
  });

  // Split the narration: one copy is heard, the other only steers the music.
  const ducks = Boolean(music) && music!.volume > 0 && (availableFilters?.has("sidechaincompress") ?? true);
  const audioInputs = ducks
    ? [`[1:a]volume=${narrationVolume},asplit=2[narration][key]`]
    : [`[1:a]volume=${narrationVolume}[narration]`];
  let audioLabel = "narration";

  if (music && music.volume > 0) {
    inputs.push("-stream_loop", "-1", "-i", music.path);
    const musicIndex = captions.length + 2;
    audioInputs.push(
      // Loop to length and fade out at the end so the music does not stop
      // dead with the picture.
      `[${musicIndex}:a]volume=${music.volume},atrim=0:${target.toFixed(3)},afade=t=out:st=${Math.max(target - 3, 0).toFixed(3)}:d=3[music]`,
    );

    if (ducks) {
      // Real ducking. A plain mix holds the music at one level throughout, so
      // it either buries the voice or is inaudible; this pulls it down while
      // someone is speaking and lets it back up in the gaps. The release is
      // long enough not to pump between words but short enough to recover
      // between sentences.
      audioInputs.push(
        `[music][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=600:makeup=1[ducked]`,
        `[narration][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]`,
      );
    } else {
      audioInputs.push(
        `[narration][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]`,
      );
    }
    audioLabel = "mixed";
  }

  const filterComplex = [...filters, ...audioInputs].join(";");

  await ffmpeg(
    [
      ...inputs,
      "-filter_complex", filterComplex,
      "-map", captions.length > 0 ? `[${videoLabel}]` : "0:v",
      "-map", `[${audioLabel}]`,
      "-t", String(target),
      "-c:v", encoder,
      ...(encoder === "libx264" ? ["-preset", "medium", "-crf", "20"] : ["-b:v", "10M"]),
      "-pix_fmt", "yuv420p",
      "-r", String(fps),
      "-c:a", "aac",
      "-b:a", "192k",
      // Put the index at the front so the file plays before it finishes downloading.
      "-movflags", "+faststart",
      output,
    ],
    { signal, onProgress },
  );

  return output;
}

/** Captions arrive as bytes; ffmpeg needs files. */
async function writeCaption(caption: Frame, workDir: string, index: number): Promise<string> {
  const path = join(workDir, `caption-${String(index).padStart(4, "0")}.png`);
  await writeFile(path, caption.png);
  return path;
}
