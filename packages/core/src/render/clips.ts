import { extname, join } from "node:path";
import { RenderError, ffmpeg, probe } from "./ffmpeg.ts";
import { CENTRE, type Framing } from "./framing.ts";

/**
 * Turning source footage into interchangeable pieces.
 *
 * Clips arrive at every resolution, frame rate, pixel aspect and colour range
 * imaginable. Concatenation needs them identical, so each one is normalised to
 * the output format first — same size, same fps, same square pixels, same
 * colour handling. Skipping this is what produces a video that plays for two
 * seconds and then stutters or goes green.
 */

/** The shared looks. Values match the VideoGrade enum on the wire. */
export type Grade = "none" | "natural" | "warm" | "cool";

/**
 * Deliberately restrained.
 *
 * The point is to make clips from different creators sit together, not to
 * stylise them — a heavy grade on footage that was already graded by its
 * author looks worse than none at all. Applied after the BT.709 conversion so
 * every clip is adjusted in the same colour space, which is the whole reason
 * it unifies them; `setparams` tagging is untouched by a pixel filter.
 */
const GRADES: Record<Grade, string> = {
  none: "",
  natural: "eq=contrast=1.06:saturation=1.08:gamma=1.02",
  warm: "eq=contrast=1.06:saturation=1.10:gamma=1.02,colorbalance=rs=0.04:gs=0.01:bs=-0.04",
  cool: "eq=contrast=1.06:saturation=1.04:gamma=1.02,colorbalance=rs=-0.04:bs=0.05",
};

/** The filter for a look, or "" when it is unavailable or switched off. */
export function gradeFilter(grade: Grade, available?: ReadonlySet<string>): string {
  const filter = GRADES[grade] ?? "";
  if (!filter) return "";
  // A build without these filters should render an ungraded video rather than
  // fail — this ffmpeg already surprised us once by having no text filters.
  const needed = filter.split(",").map((part) => part.split("=")[0]!);
  if (available && needed.some((name) => !available.has(name))) return "";
  return filter;
}

export type Transition =
  | null
  | "FadeIn"
  | "FadeOut"
  | "SlideIn"
  | "SlideOut"
  | "ZoomIn"
  | "ZoomOut";

export interface NormaliseOptions {
  source: string;
  outDir: string;
  index: number;
  width: number;
  height: number;
  /** Seconds the clip occupies in the finished video. */
  duration: number;
  fps: number;
  /** cover crops to fill; contain fits the whole frame and pads. */
  fit: "cover" | "contain";
  /** Where to take the crop from. Defaults to the middle. */
  framing?: Framing;
  /** Playback rate applied to the footage, not the narration. */
  speed: number;
  /**
   * What to do with a still. "zoom" gives it a slow push so a held photograph
   * does not read as a frozen video; "static" holds it flat.
   */
  imageMotion?: "static" | "zoom";
  transition: Transition;
  /** A shared look. Defaults to none so callers opt in. */
  grade?: Grade;
  /** Filters this ffmpeg has, so an unsupported grade is skipped not fatal. */
  availableFilters?: ReadonlySet<string>;
  /** Random side for slides, so repeated clips do not all slide the same way. */
  slideFrom?: "left" | "right" | "top" | "bottom";
  encoder: string;
  signal?: AbortSignal;
}

/**
 * Convert to BT.709 and say so.
 *
 * Players decode untagged HD as BT.709 regardless. Converting without tagging,
 * or tagging without converting, both shift the colours — most visibly in
 * skin tones and saturated skies.
 */
const COLOUR = "scale=out_color_matrix=bt709:out_range=tv,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv";

function fitFilter(
  width: number,
  height: number,
  fit: "cover" | "contain",
  framing: Framing = CENTRE,
): string {
  if (fit !== "cover") {
    // Scale until it fits inside, then pad the remainder.
    return (
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`
    );
  }

  // Scale until both axes cover the frame, then crop the overflow. The offset
  // is a fraction of the travel available, so the same number works whatever
  // the source happens to be — ffmpeg resolves in_w and out_w itself.
  const fx = clamp01(framing.x).toFixed(4);
  const fy = clamp01(framing.y).toFixed(4);
  return (
    `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height}:(in_w-out_w)*${fx}:(in_h-out_h)*${fy}`
  );
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0.5;
}

/**
 * Extensions that hold one frame rather than a span of time.
 *
 * Detected by name rather than by duration: a still reports about a fortieth
 * of a second, and so does a genuinely very short video. Guessing wrong in
 * that direction would loop a clip that was never meant to repeat.
 *
 * GIF is absent on purpose — it animates, and is handled as video.
 */
const STILL_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".avif", ".bmp", ".tif", ".tiff", ".heic",
]);

export function isStillImage(path: string): boolean {
  return STILL_EXTENSIONS.has(extname(path).toLowerCase());
}

/**
 * The slow push that keeps a held photograph from reading as a freeze.
 *
 * A still shown flat for five seconds looks like the video has stopped. The
 * movement needs to be slight: enough that the frame is never quite still,
 * not so much that it draws attention to itself.
 *
 * Only ever zooms in from 1.0 or out to it, because zoompan samples a region
 * of the source and anything below 1.0 would have to invent edges.
 */
export function kenBurns(
  duration: number,
  fps: number,
  width: number,
  height: number,
  direction: "in" | "out",
): string {
  const frames = Math.max(1, Math.round(duration * fps));
  const depth = 0.1;
  const z =
    direction === "in"
      ? `min(1+${depth}*on/${frames},${1 + depth})`
      : `max(${1 + depth}-${depth}*on/${frames},1)`;
  // d=1 is one output frame per input frame; zoompan is otherwise a filter
  // for turning one still into many, which would multiply the length.
  return (
    `zoompan=z='${z}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
    `:s=${width}x${height}:fps=${fps}`
  );
}

/** Transitions that are a filter on the clip itself. */
function transitionFilter(
  transition: Transition,
  duration: number,
  width: number,
  height: number,
  fps: number,
): { filter: string; needsBackground: boolean } {
  // Short clips cannot carry a one-second transition without swallowing the
  // whole shot, so it shrinks to fit.
  const d = Math.min(1, duration / 2);

  switch (transition) {
    case "FadeIn":
      return { filter: `fade=t=in:st=0:d=${d}`, needsBackground: false };
    case "FadeOut":
      return { filter: `fade=t=out:st=${Math.max(duration - d, 0)}:d=${d}`, needsBackground: false };
    case "ZoomIn":
      // One output frame per input frame; zoompan is otherwise a stills filter.
      // The frame count and the output rate must both be the clip's own. Both
      // were pinned at 25 while the pipeline rendered at 30, so the zoom ran
      // a fifth too fast and finished before the shot did.
      return {
        filter:
          `zoompan=z='min(1+0.15*on/(${Math.max(duration, 0.1)}*${fps}),1.15)':d=1` +
          `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`,
        needsBackground: false,
      };
    case "ZoomOut":
      return {
        filter:
          `zoompan=z='max(1.15-0.15*on/(${Math.max(duration, 0.1)}*${fps}),1)':d=1` +
          `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`,
        needsBackground: false,
      };
    default:
      return { filter: "", needsBackground: false };
  }
}

/** Where a sliding clip starts, as an overlay expression. */
function slideExpression(
  side: NonNullable<NormaliseOptions["slideFrom"]>,
  out: boolean,
  d: number,
  duration: number,
): { x: string; y: string } {
  // Progress 0→1 over the transition; out-slides run at the end instead.
  const p = out
    ? `max(0,min(1,(t-${Math.max(duration - d, 0)})/${d}))`
    : `min(1,t/${d})`;
  const moved = out ? p : `(1-${p})`;

  switch (side) {
    case "left":
      return { x: `-W*${moved}`, y: "0" };
    case "right":
      return { x: `W*${moved}`, y: "0" };
    case "top":
      return { x: "0", y: `-H*${moved}` };
    case "bottom":
      return { x: "0", y: `H*${moved}` };
  }
}

/**
 * Normalise one clip to a standalone intermediate file.
 *
 * Audio is dropped: the narration replaces it entirely, and carrying source
 * audio through only to discard it later wastes an encode on every clip.
 */
export async function normaliseClip(opts: NormaliseOptions): Promise<string> {
  const {
    source, outDir, index, width, height, duration, fps, fit, speed,
    framing = CENTRE, transition, grade = "none", availableFilters,
    imageMotion = "zoom", slideFrom = "left", encoder, signal,
  } = opts;

  if (duration <= 0) throw new RenderError("A clip needs a duration above zero.");

  const still = isStillImage(source);
  const info = await probe(source);
  // A still legitimately reports about a fortieth of a second — that is one
  // frame, not a corrupt file.
  if (!still && info.durationSeconds <= 0) {
    throw new RenderError(`“${source}” reports no duration; it may be corrupt.`);
  }

  // How much source is needed depends on the speed: at 2x, four seconds of
  // output needs eight seconds of footage.
  const sourceNeeded = duration * speed;
  const output = join(outDir, `clip-${String(index).padStart(3, "0")}.mp4`);

  /*
   * A still has to be looped to fill its shot.
   *
   * Without this the input was clamped to the one frame the file contains and
   * the shot came out a thirtieth of a second long — an upload of photographs
   * produced a video in which each one flashed past. The frame rate is set on
   * the input too, so the loop generates frames at the rate the rest of the
   * chain expects rather than ffmpeg's default.
   */
  const inputArgs = still
    ? ["-loop", "1", "-framerate", String(fps), "-t", String(duration), "-i", source]
    : ["-t", String(Math.min(sourceNeeded, info.durationSeconds)), "-i", source];

  const isSlide = transition === "SlideIn" || transition === "SlideOut";
  // Direction alternates so a run of stills does not all push the same way,
  // which reads as a mannerism rather than as movement.
  const motion =
    still && imageMotion === "zoom"
      ? kenBurns(duration, fps, width, height, index % 2 === 0 ? "in" : "out")
      : "";

  const base = [
    fitFilter(width, height, fit, framing),
    motion,
    // Speed is a property of footage. A still has no motion to hurry, and
    // retiming the generated frames would only cut the shot short.
    !still && speed !== 1 ? `setpts=PTS/${speed}` : "",
    `fps=${fps}`,
    "setsar=1",
    COLOUR,
    gradeFilter(grade, availableFilters),
  ].filter(Boolean);

  let filterArgs: string[];

  if (isSlide) {
    // A slide needs something to slide over, so the clip is composited onto
    // black rather than filtered in place.
    const d = Math.min(1, duration / 2);
    const { x, y } = slideExpression(slideFrom, transition === "SlideOut", d, duration);
    filterArgs = [
      "-f", "lavfi", "-i", `color=black:s=${width}x${height}:d=${duration}:r=${fps}`,
      "-filter_complex",
      `[0:v]${base.join(",")}[fg];[1:v][fg]overlay=x='${x}':y='${y}':shortest=1,format=yuv420p[v]`,
      "-map", "[v]",
    ];
  } else {
    // A still already moving under Ken Burns does not want a second zoom on
    // top of it; the other transitions still apply.
    const zooming = transition === "ZoomIn" || transition === "ZoomOut";
    const extra =
      motion && zooming
        ? ""
        : transitionFilter(transition, duration, width, height, fps).filter;
    filterArgs = [
      "-vf",
      [...base, extra, "format=yuv420p"].filter(Boolean).join(","),
      "-map", "0:v:0",
    ];
  }

  await ffmpeg(
    [
      ...inputArgs,
      ...filterArgs,
      "-an",
      "-c:v", encoder,
      ...(encoder === "libx264" ? ["-preset", "veryfast", "-crf", "20"] : ["-b:v", "8M"]),
      "-t", String(duration),
      output,
    ],
    { signal },
  );

  return output;
}
