/**
 * Compare our renderer against the reference implementation.
 *
 * Takes a finished task directory, re-renders the same inputs with our own
 * pipeline, and measures the difference. The point is to find out whether the
 * two produce the same video — not merely whether ours produces a good one.
 *
 *   pnpm tsx scripts/compare-render.mts <task-dir>
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  assemble,
  capabilities,
  normaliseClip,
  probe,
  renderCaptions,
  type Cue,
} from "../packages/core/src/index.ts";

const run = promisify(execFile);

const MPT = `${process.env.HOME}/Library/Application Support/MoneyPrinterTurbo`;
const FONTS = `${MPT}/resource/fonts`;
const LOCAL = `${MPT}/storage/local_videos`;

/** Parse the reference SRT so both renderers get byte-identical caption text. */
function parseSrt(raw: string): Cue[] {
  const toSeconds = (t: string) => {
    const [h, m, rest] = t.split(":");
    const [s, ms] = rest!.split(",");
    return +h! * 3600 + +m! * 60 + +s! + +ms! / 1000;
  };
  return raw
    .trim()
    .split(/\n\s*\n/)
    .map((block, i) => {
      const [, time, ...text] = block.split("\n");
      const [start, end] = time!.split(" --> ");
      return { index: i + 1, start: toSeconds(start!), end: toSeconds(end!), text: text.join(" ").trim() };
    });
}

async function ssim(a: string, b: string, at: number): Promise<number | null> {
  try {
    const { stderr } = await run(
      "ffmpeg",
      [
        "-hide_banner", "-nostdin",
        "-ss", String(at), "-i", a,
        "-ss", String(at), "-i", b,
        "-frames:v", "1",
        "-lavfi", "[0:v][1:v]ssim",
        "-f", "null", "-",
      ],
      { timeout: 60_000 },
    );
    const match = /All:([0-9.]+)/.exec(stderr);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

const taskDir = process.argv[2];
if (!taskDir) {
  console.error("Usage: compare-render.mts <task-dir>");
  process.exit(1);
}

const params = JSON.parse(await readFile(join(taskDir, "script.json"), "utf8")).params;
const reference = join(taskDir, "final-1.mp4");
const narration = join(taskDir, "audio.mp3");
const cues = parseSrt(await readFile(join(taskDir, "subtitle.srt"), "utf8"));

const work = await mkdtemp(join(tmpdir(), "compare-"));
const { workingEncoders } = await capabilities();
const encoder = workingEncoders[0]!;

const [width, height] =
  params.video_aspect === "16:9" ? [1920, 1080] : params.video_aspect === "1:1" ? [1080, 1080] : [1080, 1920];

console.log(`reference : ${reference}`);
console.log(`inputs    : ${params.video_materials.length} clips, ${cues.length} cues, ${encoder}\n`);

const started = Date.now();
const clips: string[] = [];
for (const [i, material] of params.video_materials.entries()) {
  clips.push(
    await normaliseClip({
      source: join(LOCAL, material.url),
      outDir: work,
      index: i,
      width,
      height,
      duration: params.video_clip_duration,
      fps: 30,
      fit: params.video_fit_mode,
      speed: params.video_clip_speed ?? 1,
      transition: params.video_transition_mode ?? null,
      encoder,
    }),
  );
}

const captions = renderCaptions(cues, width, height, {
  fontPath: join(FONTS, params.font_name),
  fontSize: params.font_size,
  color: params.text_fore_color,
  strokeColor: params.stroke_color,
  strokeWidth: params.stroke_width,
  background: params.text_background_color === false ? false : params.text_background_color,
  roundedBackground: params.rounded_subtitle_background ?? false,
  position: params.subtitle_position ?? "bottom",
  customPosition: params.custom_position,
});

const ours = await assemble({
  clips,
  narration,
  captions,
  music: null, // the reference picked a random track; comparing audio is separate
  narrationVolume: params.voice_volume ?? 1,
  output: join(work, "ours.mp4"),
  workDir: work,
  fps: 30,
  encoder,
});
const elapsed = Date.now() - started;

const [a, b] = await Promise.all([probe(reference), probe(ours)]);

console.log("                    reference      ours");
console.log("-".repeat(46));
const row = (label: string, x: unknown, y: unknown, ok: boolean) =>
  console.log(`  ${label.padEnd(16)} ${String(x).padEnd(14)} ${String(y).padEnd(10)} ${ok ? "match" : "DIFFERS"}`);

row("duration", a.durationSeconds.toFixed(2) + "s", b.durationSeconds.toFixed(2) + "s",
    Math.abs(a.durationSeconds - b.durationSeconds) < 0.2);
row("width", a.width, b.width, a.width === b.width);
row("height", a.height, b.height, a.height === b.height);
row("has audio", a.hasAudio, b.hasAudio, a.hasAudio === b.hasAudio);

console.log("\n  frame similarity (SSIM, 1.0 = identical)");
const span = Math.min(a.durationSeconds, b.durationSeconds);
for (const at of [0.5, span * 0.25, span * 0.5, span * 0.75, span - 0.5]) {
  const score = await ssim(reference, ours, at);
  const verdict = score === null ? "" : score > 0.95 ? "near-identical" : score > 0.8 ? "close" : "different";
  console.log(`    t=${at.toFixed(1).padStart(5)}s   ${score?.toFixed(4) ?? "n/a"}  ${verdict}`);
}

console.log(`\n  ours rendered in ${(elapsed / 1000).toFixed(1)}s`);
console.log(`  output: ${ours}`);
console.log(`  (work dir left in place for inspection: ${work})`);
