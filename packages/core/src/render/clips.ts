import { join } from "node:path";
import { RenderError, ffmpeg, probe } from "./ffmpeg.ts";

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
  /** Playback rate applied to the footage, not the narration. */
  speed: number;
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

function fitFilter(width: number, height: number, fit: "cover" | "contain"): string {
  return fit === "cover"
    ? // Scale until both axes cover the frame, then crop the overflow.
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
    : // Scale until it fits inside, then pad the remainder.
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
}

/** Transitions that are a filter on the clip itself. */
function transitionFilter(
  transition: Transition,
  duration: number,
  width: number,
  height: number,
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
      return {
        filter:
          `zoompan=z='min(1+0.15*on/(${Math.max(duration, 0.1)}*25),1.15)':d=1` +
          `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=25`,
        needsBackground: false,
      };
    case "ZoomOut":
      return {
        filter:
          `zoompan=z='max(1.15-0.15*on/(${Math.max(duration, 0.1)}*25),1)':d=1` +
          `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=25`,
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
    transition, grade = "none", availableFilters, slideFrom = "left", encoder, signal,
  } = opts;

  if (duration <= 0) throw new RenderError("A clip needs a duration above zero.");

  const info = await probe(source);
  if (info.durationSeconds <= 0) {
    throw new RenderError(`“${source}” reports no duration; it may be corrupt.`);
  }

  // How much source is needed depends on the speed: at 2x, four seconds of
  // output needs eight seconds of footage.
  const sourceNeeded = duration * speed;
  const output = join(outDir, `clip-${String(index).padStart(3, "0")}.mp4`);

  const isSlide = transition === "SlideIn" || transition === "SlideOut";
  const base = [
    fitFilter(width, height, fit),
    speed !== 1 ? `setpts=PTS/${speed}` : "",
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
    const extra = transitionFilter(transition, duration, width, height).filter;
    filterArgs = [
      "-vf",
      [...base, extra, "format=yuv420p"].filter(Boolean).join(","),
      "-map", "0:v:0",
    ];
  }

  await ffmpeg(
    [
      // Seeking before the input is far faster, and clips are used from the
      // start, so there is nothing to lose by it.
      "-t", String(Math.min(sourceNeeded, info.durationSeconds)),
      "-i", source,
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
