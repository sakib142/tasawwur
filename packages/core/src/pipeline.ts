import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoParams } from "@tasawwur/schema";
import { ASPECT_RESOLUTION } from "@tasawwur/schema";
import { buildSubtitles, toSrt } from "./captions.ts";
import { alignCuesToText } from "./speech/align.ts";
import { estimateCues } from "./speech/estimate.ts";
import { kokoroProvider } from "./speech/kokoro.ts";
import { resolveTrack } from "./music.ts";
import { searchPixabay } from "./pixabay.ts";
import { assemble, DURATION_MARGIN_SECONDS } from "./render/assemble.ts";
import { renderCaptions } from "./render/captions.ts";
import { normaliseClip, type Grade, type Transition } from "./render/clips.ts";
import { CENTRE, findFraming } from "./render/framing.ts";
import { shotDurations } from "./render/rhythm.ts";
import { capabilities, probe, RenderError } from "./render/ffmpeg.ts";

/**
 * The whole job: words in, finished video out.
 *
 * Each stage reports before it begins, because the slow ones are silent and a
 * progress bar that does not move is indistinguishable from a hang.
 */

export type Stage = "script" | "terms" | "audio" | "subtitle" | "materials" | "video";

export interface PipelineEvent {
  stage: Stage;
  label: string;
  progress: number;
  detail?: string;
}

export interface PipelineOptions {
  params: VideoParams;
  /** Where this job's files live. */
  workDir: string;
  /** Fonts directory. */
  fontsDir: string;
  /** Music directory. Omitted falls back to the bundled one. */
  musicDir?: string;
  /** For stock search. Not needed for local footage. */
  pixabayApiKey?: string;
  /** Already-downloaded footage, when the storyboard chose it. */
  resolvedMaterials?: string[];
  onEvent?: (event: PipelineEvent) => void;
  signal?: AbortSignal;
}

export interface PipelineResult {
  video: string;
  audio: string;
  subtitles: string;
  durationSeconds: number;
  materials: string[];
}

const FPS = 30;

/** Fractions of total progress, so the bar reflects real time spent. */
const STAGES: Array<{ stage: Stage; label: string; at: number }> = [
  { stage: "script", label: "Preparing the script", at: 5 },
  { stage: "audio", label: "Recording narration", at: 20 },
  { stage: "subtitle", label: "Timing captions", at: 30 },
  { stage: "materials", label: "Finding footage", at: 40 },
  { stage: "video", label: "Cutting and rendering", at: 50 },
];

export async function renderVideo(opts: PipelineOptions): Promise<PipelineResult> {
  const { params, workDir, fontsDir, musicDir, pixabayApiKey, resolvedMaterials, onEvent, signal } = opts;

  const emit = (stage: Stage, detail?: string) => {
    const found = STAGES.find((s) => s.stage === stage);
    onEvent?.({
      stage,
      label: found?.label ?? stage,
      progress: found?.at ?? 0,
      detail,
    });
  };

  const stop = () => {
    if (signal?.aborted) throw new RenderError("Rendering cancelled.");
  };

  await mkdir(workDir, { recursive: true });
  const [width, height] = ASPECT_RESOLUTION[params.video_aspect];
  const { workingEncoders, filters } = await capabilities();
  const encoder = workingEncoders[0]!;

  // ---- script -------------------------------------------------------------
  emit("script");
  const script = params.video_script.trim();
  if (!script) {
    throw new RenderError(
      "There is no script to narrate. Write one, or use the topic field to have one written.",
    );
  }
  stop();

  // ---- narration ----------------------------------------------------------
  emit("audio");
  if (!(await kokoroProvider.available())) {
    throw new RenderError(
      "Local speech is not installed. Run: npx pnpm@12 install, which fetches the optional kokoro-js.",
    );
  }
  const speech = await kokoroProvider.synthesize({
    text: script,
    voice: params.voice_name || "af_heart",
    rate: params.voice_rate,
    signal,
  });
  const audioPath = join(workDir, "audio.wav");
  await writeFile(audioPath, speech.audio);
  const { durationSeconds } = await probe(audioPath);
  stop();

  // ---- captions -----------------------------------------------------------
  emit("subtitle");
  // The timeline carries spoken words, which arrive without punctuation.
  // Matching them back onto the script is what lets captions break at
  // sentences rather than mid-phrase on length alone.
  const aligned = alignCuesToText(
    speech.cues ?? estimateCues(script, durationSeconds),
    script,
  );
  const { cues } = buildSubtitles(aligned, params.subtitle_display_mode);
  // Shots follow sentences even when captions are drawn a word at a time —
  // cutting the picture on every word would be a strobe, not an edit.
  const sentenceCues =
    params.subtitle_display_mode === "sentence"
      ? cues
      : buildSubtitles(aligned, "sentence").cues;
  const subtitlePath = join(workDir, "subtitle.srt");
  await writeFile(subtitlePath, toSrt(cues), "utf8");
  stop();

  // ---- footage ------------------------------------------------------------
  emit("materials");
  let sources: string[];

  if (resolvedMaterials?.length) {
    sources = resolvedMaterials;
  } else if (params.video_source === "local") {
    sources = (params.video_materials ?? []).map((m) => m.url).filter(Boolean);
    if (sources.length === 0) {
      throw new RenderError("No footage was supplied. Upload some files, or pick a stock source.");
    }
  } else {
    if (!pixabayApiKey) {
      throw new RenderError("No Pixabay API key configured. Add a free key in Settings.");
    }
    const terms = (
      typeof params.video_terms === "string"
        ? params.video_terms.split(",")
        : (params.video_terms ?? [])
    )
      .map((t) => t.trim())
      .filter(Boolean);
    if (terms.length === 0) {
      throw new RenderError("There are no search terms, so there is nothing to look for.");
    }
    throw new RenderError(
      "Stock footage must be chosen through Preview clips before rendering.",
    );
  }
  stop();

  // ---- render -------------------------------------------------------------
  emit("video", `${sources.length} clips`);
  const clipsDir = join(workDir, "clips");
  await mkdir(clipsDir, { recursive: true });

  const transition = (params.video_transition_mode ?? null) as Transition;
  const sides = ["left", "right", "top", "bottom"] as const;

  // Shots are cut where the voice breaks rather than on a fixed interval, so
  // the picture never changes mid-sentence. `video_clip_duration` becomes the
  // longest a shot may be held, which is what the setting always meant to the
  // person choosing it.
  const durations = shotDurations(sentenceCues, sources.length, {
    maxSeconds: Math.max(params.video_clip_duration, 1.5),
    totalSeconds: durationSeconds + DURATION_MARGIN_SECONDS,
  });

  const clips: string[] = [];
  for (const [index, duration] of durations.entries()) {
    stop();
    onEvent?.({
      stage: "video",
      label: "Cutting and rendering",
      // The clip stage occupies 50-80%; the final mux takes the rest.
      progress: 50 + Math.round((index / durations.length) * 30),
      detail: `clip ${index + 1} of ${durations.length}`,
    });
    const source = sources[index % sources.length]!;

    // Where to crop from. Cheap enough to do per shot — the same clip used
    // twice may want a different part of the frame each time once trimming
    // lands — and it falls back to the middle on anything unexpected.
    let framing = CENTRE;
    if (params.video_fit_mode === "cover") {
      const info = await probe(source).catch(() => null);
      if (info) {
        framing = await findFraming({
          source,
          sourceWidth: info.width,
          sourceHeight: info.height,
          width,
          height,
          signal,
        });
      }
    }

    clips.push(
      await normaliseClip({
        // More shots than clips means the narration outran the footage; the
        // clips cycle rather than any one of them being stretched.
        source,
        outDir: clipsDir,
        index,
        width,
        height,
        duration,
        fps: FPS,
        fit: params.video_fit_mode,
        framing,
        speed: params.video_clip_speed,
        transition,
        grade: params.video_grade as Grade,
        availableFilters: filters,
        slideFrom: sides[index % sides.length],
        encoder,
        signal,
      }),
    );
  }

  const captions = params.subtitle_enabled
    ? renderCaptions(cues, width, height, {
        fontPath: join(fontsDir, params.font_name),
        fontSize: params.font_size,
        color: params.text_fore_color,
        strokeColor: params.stroke_color,
        strokeWidth: params.stroke_width,
        background:
          params.text_background_color === false ? false : String(params.text_background_color),
        roundedBackground: params.rounded_subtitle_background,
        position: params.subtitle_position,
        customPosition: params.custom_position,
      })
    : [];

  onEvent?.({ stage: "video", label: "Cutting and rendering", progress: 80, detail: "mixing" });

  // Narration over silence is the loudest sign that something was generated
  // rather than made. A missing track is not an error — it just renders dry.
  const trackPath =
    params.bgm_volume > 0
      ? await resolveTrack(params.bgm_type, params.bgm_file, musicDir)
      : null;

  const video = join(workDir, "final.mp4");
  await assemble({
    clips,
    narration: audioPath,
    captions,
    music: trackPath ? { path: trackPath, volume: params.bgm_volume } : null,
    availableFilters: filters,
    narrationVolume: params.voice_volume,
    output: video,
    workDir: join(workDir, "assemble"),
    fps: FPS,
    encoder,
    signal,
  });

  // The normalised intermediates are large and serve no purpose once joined.
  await rm(clipsDir, { recursive: true, force: true }).catch(() => {});

  return { video, audio: audioPath, subtitles: subtitlePath, durationSeconds, materials: sources };
}
