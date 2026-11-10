/**
 * Does the picture change when the voice does?
 *
 * The defect this checks for was visible in job dfc41d95: the narration broke
 * at 1.611 / 4.350 / 6.709 / 8.401 / 10.900 while the clips cut at a fixed 5.0
 * and 10.0, so the shot changed halfway through a sentence, twice.
 *
 * Rather than trusting that the new timings are applied, this renders a real
 * video and measures where the cuts actually landed in the file it produced.
 *
 *   pnpm tsx scripts/check-cuts.mts <material.mp4> [more.mp4 ...]
 */
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VideoParams } from "../packages/schema/src/video-params.ts";
import { renderVideo } from "../packages/core/src/pipeline.ts";
import { fontsDir } from "../packages/core/src/jobs.ts";
import { probe } from "../packages/core/src/render/ffmpeg.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Spawned here rather than widening the library surface for a test tool. */
const execFileAsync = promisify(execFile);
async function ffmpegStderr(args: string[]): Promise<string> {
  try {
    const { stderr } = await execFileAsync("ffmpeg", args, { maxBuffer: 32 * 1024 * 1024 });
    return stderr;
  } catch (cause) {
    // showinfo writes to stderr and ffmpeg exits non-zero on "-f null -"
    // in some builds; the output is what matters, not the status.
    return (cause as { stderr?: string }).stderr ?? "";
  }
}

const SCRIPT =
  "A river has no plan. It meets a rock, and it goes around. " +
  "It meets a cliff, and it falls. Patience is not slowness. " +
  "It is knowing the sea is certain.";

/** Cue end times from the SRT the render wrote. */
function cueEdges(srt: string): number[] {
  const edges: number[] = [];
  for (const [, h, m, s, ms] of srt.matchAll(
    /--> (\d\d):(\d\d):(\d\d),(\d\d\d)/g,
  )) {
    edges.push(Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000);
  }
  return edges;
}

const materials = process.argv.slice(2);
if (materials.length === 0) {
  console.error("Pass at least one video file to use as footage.");
  process.exit(1);
}

const keep = join(tmpdir(), "tasawwur-cuts.mp4");
const workDir = await mkdtemp(join(tmpdir(), "tasawwur-cuts-"));
try {
  console.log(`Rendering with ${materials.length} clips…`);
  const result = await renderVideo({
    params: VideoParams.parse({
      video_script: SCRIPT,
      video_source: "local",
      video_aspect: "9:16",
      video_clip_duration: 5,
      voice_name: "af_heart",
      subtitle_display_mode: "sentence",
      font_name: "BeVietnamPro-Bold.ttf",
      bgm_volume: 0,
    }),
    workDir,
    fontsDir: fontsDir(),
    resolvedMaterials: materials,
  });

  const edges = cueEdges(await readFile(result.subtitles, "utf8"));

  // Where the cuts actually are, found in the finished file rather than
  // inferred from what we meant to do. The clip intermediates are deleted
  // once joined, so the video itself is the only honest witness.
  const stderr = await ffmpegStderr([
    "-hide_banner",
    "-i", result.video,
    "-vf", "select='gt(scene,0.4)',showinfo",
    "-f", "null", "-",
  ]);
  const boundaries = [...stderr.matchAll(/pts_time:([\d.]+)/g)]
    .map((m) => Number(m[1]))
    .filter((t) => t > 0.2);

  console.log(`\nVoice breaks at: ${edges.map((e) => e.toFixed(2)).join(", ")}`);
  console.log(`Picture cuts at: ${boundaries.map((b) => b.toFixed(2)).join(", ")}`);

  let bad = 0;
  for (const boundary of boundaries) {
    // Two frames of tolerance: encode rounds durations to the frame, and
    // scene detection reports the first frame that differs.
    const nearest = Math.min(...edges.map((e) => Math.abs(e - boundary)));
    const ok = nearest <= 2 / 30 + 0.01;
    if (!ok) bad++;
    console.log(
      `  cut at ${boundary.toFixed(2)}s — ${ok ? "on a sentence end" : `MID-SENTENCE (${nearest.toFixed(3)}s from the nearest)`}`,
    );
  }

  const info = await probe(result.video);
  console.log(
    `\n${info.durationSeconds.toFixed(2)}s, ${info.width}x${info.height}, ` +
      `${boundaries.length} detected cuts`,
  );
  await copyFile(result.video, keep);
  console.log(`Video kept at ${keep}`);
  console.log(
    bad === 0
      ? "\nPASS: every detected cut lands on a sentence end."
      : `\nFAIL: ${bad} cut(s) mid-sentence.`,
  );
  if (bad > 0) process.exitCode = 1;
} finally {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}
