import { z } from "zod";

/**
 * Values mirror app/models/schema.py and app/models/const.py in
 * MoneyPrinterTurbo v1.3.10. The wire values must stay byte-identical while
 * the Python engine still serves requests, so do not "tidy" them.
 */

export const VideoAspect = z.enum(["16:9", "9:16", "1:1"]);
export type VideoAspect = z.infer<typeof VideoAspect>;

/** Target pixel size for each aspect. Portrait is the default everywhere. */
export const ASPECT_RESOLUTION: Record<VideoAspect, readonly [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
};

export const VideoFitMode = z.enum(["cover", "contain"]);
export type VideoFitMode = z.infer<typeof VideoFitMode>;

export const VideoConcatMode = z.enum(["random", "sequential"]);
export type VideoConcatMode = z.infer<typeof VideoConcatMode>;

/**
 * Capitalised on the wire — Python serialises the enum *value*, not the member
 * name. `null` means "no transition", which is also the default.
 */
export const VideoTransitionMode = z.enum([
  "Shuffle",
  "FadeIn",
  "FadeOut",
  "SlideIn",
  "SlideOut",
  "ZoomIn",
  "ZoomOut",
]);
export type VideoTransitionMode = z.infer<typeof VideoTransitionMode>;

export const ImageMotion = z.enum(["static", "zoom"]);
export type ImageMotion = z.infer<typeof ImageMotion>;

export const SubtitleDisplayMode = z.enum(["sentence", "word_by_word"]);
export type SubtitleDisplayMode = z.infer<typeof SubtitleDisplayMode>;

export const SubtitleAnimation = z.enum(["none", "pop_spring"]);
export type SubtitleAnimation = z.infer<typeof SubtitleAnimation>;

export const SubtitlePosition = z.enum([
  "top",
  "center",
  "bottom",
  "two_thirds_bottom",
  "custom",
]);
export type SubtitlePosition = z.infer<typeof SubtitlePosition>;

/** Numeric, and deliberately not 0/1/2 — these are the values Python stores. */
export const TaskState = {
  failed: -1,
  complete: 1,
  processing: 4,
} as const;
export type TaskState = (typeof TaskState)[keyof typeof TaskState];

/** Stages the pipeline can stop at; also the failure-stage vocabulary. */
export const PipelineStage = z.enum([
  "script",
  "terms",
  "audio",
  "subtitle",
  "materials",
  "video",
]);
export type PipelineStage = z.infer<typeof PipelineStage>;
