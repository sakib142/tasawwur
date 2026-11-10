import { z } from "zod";
import {
  ImageMotion,
  SubtitleAnimation,
  SubtitleDisplayMode,
  SubtitlePosition,
  VideoAspect,
  VideoConcatMode,
  VideoFitMode,
  VideoGrade,
  VideoTransitionMode,
} from "./enums.ts";

/**
 * Parameters for a single generation request.
 *
 * Field names are snake_case to match the rendering contract on the wire.
 * Renaming them here would buy a translation layer at every boundary, so the
 * contract spelling wins.
 */
/** Port of MaterialInfo. Used for the "local" video source. */
export const MaterialInfo = z.object({
  provider: z.string().default("pexels"),
  url: z.string().default(""),
  duration: z.number().int().default(0),
  /**
   * Public provenance for online assets (creator, source page, asset id).
   * Rebuilt against a field allowlist before persisting, so caller-supplied
   * signed URLs or credentials never reach task records.
   */
  source_info: z.record(z.string(), z.unknown()).nullish(),
});
export type MaterialInfo = z.infer<typeof MaterialInfo>;

export const VideoParams = z.object({
  // ---- content -----------------------------------------------------------
  /** Topic for the LLM. Ignored when video_script is supplied. */
  video_subject: z.string().default(""),
  /** A complete script. Supplying it skips LLM script generation entirely. */
  video_script: z.string().default(""),
  /** Search terms. Supplying them skips LLM keyword generation entirely. */
  video_terms: z.union([z.string(), z.array(z.string())]).nullish(),
  /** BCP-47-ish hint, e.g. "en-US". Empty means auto-detect. */
  video_language: z.string().default(""),
  paragraph_number: z.number().int().min(1).max(10).default(1),
  video_script_prompt: z.string().max(2000).default(""),
  custom_system_prompt: z.string().max(8000).default(""),

  // ---- footage -----------------------------------------------------------
  video_source: z.string().default("pexels"),
  video_aspect: VideoAspect.default("9:16"),
  video_fit_mode: VideoFitMode.default("cover"),
  video_concat_mode: VideoConcatMode.default("random"),
  /** null = no transition. */
  video_transition_mode: VideoTransitionMode.nullish(),
  /** Longest a single shot is held; shots cut on sentence ends below this. */
  video_clip_duration: z.number().int().min(1).default(5),
  /** A shared look across every clip. See VideoGrade. */
  video_grade: VideoGrade.default("natural"),
  video_clip_speed: z.number().positive().finite().default(1),
  /** Forces sequential concat and asks the LLM for ordered keywords. */
  match_materials_to_script: z.boolean().default(false),
  video_count: z.number().int().min(1).default(1),
  /** Ken Burns treatment applied to still images. */
  image_motion: ImageMotion.default("zoom"),
  /** Only for video_source "local" — caller-supplied files. */
  video_materials: z.array(MaterialInfo).nullish(),

  // ---- audio -------------------------------------------------------------
  /**
   * Selects the TTS backend by itself — the service layer dispatches on this
   * string, never on the `tts_server` setting, which is only a UI grouping.
   */
  voice_name: z.string().default(""),
  voice_volume: z.number().min(0).finite().default(1),
  voice_rate: z.number().positive().finite().default(1),
  /** Supplying this skips TTS; there is then no word-boundary timeline. */
  custom_audio_file: z.string().default(""),

  bgm_type: z.string().default("random"),
  bgm_file: z.string().default(""),
  /** <= 0 short-circuits all background-music work, including paid APIs. */
  bgm_volume: z.number().min(0).finite().default(0.2),
  video_music_prompt: z.string().max(2000).default(""),
  /** Accepted by the Python API; unused once Sonilo is dropped. */
  sonilo_bgm_prompt: z.string().max(2000).default(""),

  // ---- subtitles ---------------------------------------------------------
  subtitle_enabled: z.boolean().default(true),
  subtitle_position: SubtitlePosition.default("bottom"),
  subtitle_display_mode: SubtitleDisplayMode.default("sentence"),
  subtitle_animation: SubtitleAnimation.default("none"),
  /** Only meaningful when subtitle_position is "custom". Percent from top. */
  custom_position: z.number().min(0).max(100).default(70),
  /**
   * Must resolve inside the fonts directory — traversal is rejected.
   *
   * The previous default named a font that does not ship, so anything relying
   * on it failed at render with "Could not load the caption font".
   */
  font_name: z.string().default("BeVietnamPro-Bold.ttf"),
  font_size: z.number().int().min(1).default(72),
  text_fore_color: z.string().default("#FFFFFF"),
  /** Legacy: accepts a bool or a colour string. */
  text_background_color: z.union([z.boolean(), z.string()]).default(false),
  rounded_subtitle_background: z.boolean().default(false),
  stroke_color: z.string().default("#000000"),
  stroke_width: z.number().min(0).finite().default(3),

  // ---- execution ---------------------------------------------------------
  /** ffmpeg thread count, not pipeline concurrency. */
  n_threads: z.number().int().min(1).default(2),
});

export type VideoParams = z.infer<typeof VideoParams>;
export type VideoParamsInput = z.input<typeof VideoParams>;
