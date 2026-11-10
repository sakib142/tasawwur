import type { Cue } from "../captions.ts";

/**
 * Deciding how long each shot is held.
 *
 * Every clip used to run for exactly `video_clip_duration`, so the picture
 * changed on a metronome that had nothing to do with the voice. In a real
 * render the narration broke at 1.6 / 4.4 / 6.7 / 8.4 / 10.9s while the cuts
 * landed at 5.0 and 10.0 — both of them mid-sentence. A viewer cannot say why
 * that looks amateurish, but they can see it.
 *
 * Shots are therefore cut on cue boundaries. The cue timeline already exists
 * by the time clips are built, so this costs a function call and no new work.
 */

/**
 * How often the picture should change.
 *
 * All three cut on sentence ends — the pace never buys itself a cut by
 * slicing through someone mid-word. What changes is whether short sentences
 * are allowed to share a shot, and how long a sentence may run before it is
 * divided.
 *
 * "snappy" refuses to merge and divides sooner, so the picture turns over
 * roughly once a sentence. "measured" lets consecutive sentences sit on one
 * shot and holds it. "even" aims to use each clip about once, which is what
 * the renderer has always done.
 */
export type Pace = "snappy" | "even" | "measured";

/**
 * `target` is the merge threshold: a shot closes once it reaches it, so a low
 * value means one sentence per shot and a high one means several. `maxScale`
 * stretches or tightens the caller's shot length around that pace.
 *
 * Both scales are needed. An early version moved only the target and left the
 * ceiling alone, which made "measured" produce exactly the same cuts as
 * "even" — the ceiling was already the binding constraint, so there was
 * nothing for a longer target to do and the control looked broken.
 */
const PACING: Record<Pace, { targetScale: number; maxScale: number; minSeconds: number }> = {
  snappy: { targetScale: 0.45, maxScale: 0.6, minSeconds: 1.2 },
  even: { targetScale: 1, maxScale: 1, minSeconds: 1.5 },
  measured: { targetScale: 1.9, maxScale: 1.6, minSeconds: 2 },
};

export interface RhythmOptions {
  /** How often the picture changes. Defaults to "even". */
  pace?: Pace;
  /** Below this a shot reads as a flash rather than an image. */
  minSeconds?: number;
  /** Above this a single shot outstays its welcome. */
  maxSeconds?: number;
  /**
   * How long the picture must last overall.
   *
   * Narration carries trailing silence after the final word, so the last cue
   * ends before the audio does. The final shot is stretched to cover the
   * difference — otherwise the joiner tops the video up by repeating a clip,
   * and a whole shot reappears for the sake of half a second.
   */
  totalSeconds?: number;
}

const DEFAULTS = { minSeconds: 1.5, maxSeconds: 7 } as const;

/** No pace may hold a single shot longer than this, whatever it is asked. */
const HARD_CEILING_SECONDS = 12;

/**
 * One duration per shot, in order, cut on cue boundaries.
 *
 * The returned length is what the narration needs, which is not necessarily
 * `clipCount`: fewer shots when the script is short, more when it is long
 * enough that holding every clip for `maxSeconds` still would not cover it.
 * Callers cycle their clips over whatever comes back.
 */
/**
 * Roughly how long a shot runs at this pace, for a given base length.
 *
 * Used to work out how much footage to gather: a snappy cut needs more clips
 * to cover the same narration, and finding that out at render time would mean
 * repeating the few that were fetched.
 */
export function paceShotSeconds(base: number, pace: Pace = "even"): number {
  const pacing = PACING[pace] ?? PACING.even;
  return Math.max(
    Math.min(base * pacing.maxScale, HARD_CEILING_SECONDS),
    pacing.minSeconds,
  );
}

export function shotDurations(
  cues: Cue[],
  clipCount: number,
  options: RhythmOptions = {},
): number[] {
  const pacing = PACING[options.pace ?? "even"] ?? PACING.even;
  const base = options.maxSeconds ?? DEFAULTS.maxSeconds;
  const min = options.minSeconds ?? pacing.minSeconds;
  // The caller's figure is the shot length at an even pace; the pace moves it
  // either way. Held to a hard ceiling so that no choice here can leave one
  // shot on screen for an uncomfortably long time.
  const max = Math.max(Math.min(base * pacing.maxScale, HARD_CEILING_SECONDS), min);
  const clips = Math.max(1, Math.floor(clipCount));

  const segments = splitLongCues(cues, max);
  if (segments.length === 0) {
    // No cues at all: fall back to an even division of whatever time there is.
    const total = options.totalSeconds ?? 0;
    if (total <= 0) return [];
    return even(total, Math.max(1, Math.min(clips, Math.ceil(total / max))), min);
  }

  const spoken = segments.reduce((n, d) => n + d, 0);
  const total = Math.max(options.totalSeconds ?? spoken, spoken);

  // Aim to use every clip once, then bend that by the pace. If the result
  // would hold shots beyond `max`, more shots are needed than there are clips
  // and the caller will repeat them.
  const target = clamp((total / clips) * pacing.targetScale, min, max);

  const shots: number[] = [];
  let current = 0;
  for (const segment of segments) {
    // Closing before an overlong segment keeps the boundary on a cue edge
    // rather than slicing through the middle of a sentence to hit `target`.
    if (current > 0 && (current + segment > max || current >= target)) {
      shots.push(current);
      current = 0;
    }
    current += segment;
  }
  if (current > 0) shots.push(current);

  foldShortTail(shots, min, max);

  // Stretch onto the trailing silence so the joiner never has to loop.
  const used = shots.reduce((n, d) => n + d, 0);
  if (total > used && shots.length > 0) shots[shots.length - 1]! += total - used;

  return shots;
}

/** A cue longer than a shot may be is divided evenly rather than truncated. */
function splitLongCues(cues: Cue[], max: number): number[] {
  const out: number[] = [];
  for (const cue of cues) {
    const span = cue.end - cue.start;
    if (span <= 0) continue;
    if (span <= max) {
      out.push(span);
      continue;
    }
    const parts = Math.ceil(span / max);
    for (let i = 0; i < parts; i++) out.push(span / parts);
  }
  return out;
}

/**
 * A final shot too short to register is merged backwards.
 *
 * Only when the neighbour can absorb it — otherwise a long closing sentence
 * would produce one shot well past `max`, which is the problem this avoids.
 */
function foldShortTail(shots: number[], min: number, max: number): void {
  if (shots.length < 2) return;
  const last = shots[shots.length - 1]!;
  const previous = shots[shots.length - 2]!;
  if (last < min && previous + last <= max) {
    shots.splice(shots.length - 2, 2, previous + last);
  }
}

function even(total: number, count: number, min: number): number[] {
  const each = Math.max(total / count, min);
  return Array.from({ length: count }, () => each);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
