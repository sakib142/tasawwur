import { ffmpegCapture } from "./ffmpeg.ts";

/**
 * Deciding which part of a wide frame to keep.
 *
 * Turning 16:9 footage into 9:16 throws away about two thirds of the width.
 * Cropping dead centre is a guess that happens to be right when the subject is
 * centred and badly wrong when it is not — a person standing left of frame is
 * simply cut out of their own video.
 *
 * The subject is found by asking where the detail is. ffmpeg writes a few
 * frames out as raw grey bytes, which is one luma value per pixel and needs no
 * image decoding, and the column with the most horizontal change is the column
 * with something in it. Flat sky and still water score near zero; a treeline,
 * a face, a waterfall do not.
 *
 * Nothing here is clever enough to be trusted blindly, so it only overrules the
 * centre when the case is clear. See CONFIDENCE.
 */

/** Analysis size. Large enough to locate a subject, small enough to be free. */
const SAMPLE_WIDTH = 160;
const SAMPLE_HEIGHT = 90;
/** Frames to look at. A subject that moves should not be judged from one. */
const SAMPLE_FRAMES = 3;

/**
 * How much better than centre a window must be before it is used.
 *
 * Edge energy is a proxy for interest, not a detector. On footage with no
 * clear subject — open water, a plain sky — the scores are near enough equal
 * everywhere that the winner is noise, and drifting off-centre for noise looks
 * worse than the centre crop it replaced. 15% is the margin at which the
 * difference stopped being arbitrary on real footage.
 */
const CONFIDENCE = 1.15;

/** Where to take the crop from, as a fraction of the available overflow. */
export interface Framing {
  /** 0 is hard left, 0.5 centre, 1 hard right. */
  x: number;
  /** 0 is top, 0.5 centre, 1 bottom. */
  y: number;
}

export const CENTRE: Framing = { x: 0.5, y: 0.5 };

/**
 * Sum of absolute differences between neighbouring pixels, per column.
 *
 * Horizontal change only. A horizon runs across every column equally and says
 * nothing about where to crop; a vertical edge — a trunk, a limb, a falling
 * line of water — belongs to one column and is exactly the signal wanted.
 */
export function columnEnergy(
  grey: Buffer,
  width: number,
  height: number,
  frames: number,
): number[] {
  const energy = new Array<number>(width).fill(0);
  const frameSize = width * height;

  for (let f = 0; f < frames; f++) {
    const base = f * frameSize;
    if (base + frameSize > grey.length) break;
    for (let y = 0; y < height; y++) {
      const row = base + y * width;
      for (let x = 1; x < width; x++) {
        energy[x]! += Math.abs(grey[row + x]! - grey[row + x - 1]!);
      }
    }
  }
  return energy;
}

/** Same, for rows — needed when a tall source is cropped to a wide target. */
export function rowEnergy(
  grey: Buffer,
  width: number,
  height: number,
  frames: number,
): number[] {
  const energy = new Array<number>(height).fill(0);
  const frameSize = width * height;

  for (let f = 0; f < frames; f++) {
    const base = f * frameSize;
    if (base + frameSize > grey.length) break;
    for (let y = 1; y < height; y++) {
      const row = base + y * width;
      const above = base + (y - 1) * width;
      for (let x = 0; x < width; x++) {
        energy[y]! += Math.abs(grey[row + x]! - grey[above + x]!);
      }
    }
  }
  return energy;
}

/**
 * The best place to put a window of `fraction` of the whole, 0 to 1.
 *
 * Returns null when no position is convincingly better than the middle, which
 * is the common case on footage without a subject.
 */
export function bestWindow(energy: number[], fraction: number): number | null {
  const total = energy.length;
  const span = Math.max(1, Math.round(total * fraction));
  if (span >= total) return null;

  // Running sum, so every candidate position costs one addition.
  const sums: number[] = [];
  let window = 0;
  for (let i = 0; i < span; i++) window += energy[i]!;
  sums.push(window);
  for (let i = span; i < total; i++) {
    window += energy[i]! - energy[i - span]!;
    sums.push(window);
  }

  const best = Math.max(...sums);
  if (best <= 0) return null;

  const centreAt = Math.round((total - span) / 2);
  const centre = sums[centreAt] ?? 0;

  // A centre with detail in it has to be beaten convincingly. A centre with
  // nothing in it does not — that is the clearest case there is for moving,
  // and an earlier version of this guard rejected exactly those.
  if (centre > 0 && best < centre * CONFIDENCE) return null;

  // Among windows that are as good as each other, take the most central.
  // A subject that fits anywhere in a wide band should not be shoved to one
  // side because that position happened to be scanned first.
  const tolerance = best * 0.02;
  let bestAt = centreAt;
  let nearest = Infinity;
  for (const [at, value] of sums.entries()) {
    if (value < best - tolerance) continue;
    const distance = Math.abs(at - centreAt);
    if (distance < nearest) {
      nearest = distance;
      bestAt = at;
    }
  }

  // As a fraction of the travel available, which is what crop needs.
  return bestAt / (total - span);
}

export interface FramingOptions {
  source: string;
  /** Source dimensions, already probed. */
  sourceWidth: number;
  sourceHeight: number;
  /** Target dimensions. */
  width: number;
  height: number;
  signal?: AbortSignal;
}

/**
 * Where to crop this clip from.
 *
 * Falls back to the centre on any failure. A crop that is merely centred is a
 * fine video; a render that dies because a probe did not like a file is not.
 */
export async function findFraming(opts: FramingOptions): Promise<Framing> {
  const { source, sourceWidth, sourceHeight, width, height, signal } = opts;
  if (sourceWidth <= 0 || sourceHeight <= 0) return CENTRE;

  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = width / height;

  // How much of the scaled frame survives the crop, per axis. Only the axis
  // that actually overflows is worth analysing.
  const keepX = targetAspect < sourceAspect ? targetAspect / sourceAspect : 1;
  const keepY = targetAspect > sourceAspect ? sourceAspect / targetAspect : 1;
  if (keepX >= 1 && keepY >= 1) return CENTRE;

  let grey: Buffer;
  try {
    grey = await ffmpegCapture(
      [
        "-i", source,
        // Even spacing across the clip rather than the first frames, which on
        // stock footage are often a fade from black.
        "-vf", `thumbnail=n=${SAMPLE_FRAMES * 10},scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT},format=gray`,
        "-frames:v", String(SAMPLE_FRAMES),
        "-f", "rawvideo", "-pix_fmt", "gray",
        "-",
      ],
      { signal, timeoutMs: 30_000 },
    );
  } catch {
    return CENTRE;
  }

  const frames = Math.floor(grey.length / (SAMPLE_WIDTH * SAMPLE_HEIGHT));
  if (frames < 1) return CENTRE;

  const x =
    keepX < 1
      ? bestWindow(columnEnergy(grey, SAMPLE_WIDTH, SAMPLE_HEIGHT, frames), keepX)
      : null;
  const y =
    keepY < 1
      ? bestWindow(rowEnergy(grey, SAMPLE_WIDTH, SAMPLE_HEIGHT, frames), keepY)
      : null;

  return { x: x ?? 0.5, y: y ?? 0.5 };
}
