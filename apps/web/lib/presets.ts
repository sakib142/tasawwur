import type { VideoParamsInput } from "@tasawwur/schema";

/**
 * Starting points derived from what actually produced good output in testing.
 *
 * A preset SEEDS the form rather than locking it: selecting one fills the
 * controls, and every one of them stays editable afterwards. Presets that
 * silently controlled a dozen hidden settings were indistinguishable from
 * buttons that did nothing.
 *
 * The lesson from those runs: footage quality is governed by keyword choice,
 * not by render settings. Terms here were chosen because Pixabay's vertical
 * library genuinely covers them with clips from *many different creators* —
 * terms dominated by a single contributor produce visibly repetitive video.
 */
export interface Preset {
  id: string;
  label: string;
  hint: string;
  params: VideoParamsInput;
}

/**
 * The differences between presets, in the words someone choosing one would use.
 *
 * A preset changes ten settings, and the form shows almost none of them — so
 * without this the three buttons look interchangeable and the choice reads as
 * decoration. Derived from the params rather than written out separately, so it
 * cannot drift from what is actually sent.
 */
export function describePreset(preset: Preset): string[] {
  const p = preset.params;
  const shape = p.video_aspect === "16:9" ? "Landscape 16:9" : "Vertical 9:16";
  const captions =
    p.subtitle_display_mode === "word_by_word"
      ? `One word at a time${p.subtitle_animation === "pop_spring" ? ", popping in" : ""}`
      : "Full sentences";
  return [
    shape,
    captions,
    `${p.video_clip_duration}s cuts`,
    `${p.font_size}px captions`,
  ];
}

const CAPTION_BASE = {
  font_name: "BeVietnamPro-Bold.ttf",
  text_fore_color: "#FFFFFF",
  stroke_color: "#000000",
  subtitle_enabled: true,
} satisfies VideoParamsInput;

export const PRESETS: Preset[] = [
  {
    id: "documentary",
    label: "Documentary",
    hint: "Calm two-line captions, slow cuts. Matches the upstream gallery look.",
    params: {
      ...CAPTION_BASE,
      video_aspect: "9:16",
      video_clip_duration: 5,
      video_transition_mode: null,
      subtitle_display_mode: "sentence",
      subtitle_animation: "none",
      font_size: 55,
      stroke_width: 1.5,
      voice_name: "en-US-AvaNeural-Female",
      voice_rate: 0.95,
      bgm_volume: 0.1,
    },
  },
  {
    id: "shorts",
    label: "Shorts",
    hint: "Word-by-word captions with a pop. Faster cuts, bigger type.",
    params: {
      ...CAPTION_BASE,
      video_aspect: "9:16",
      video_clip_duration: 3,
      // Deliberately not "Shuffle": mixing FadeIn and FadeOut at a cut blinks
      // through black. A 40s test render showed five such flashes.
      video_transition_mode: null,
      subtitle_display_mode: "word_by_word",
      subtitle_animation: "pop_spring",
      font_size: 78,
      stroke_width: 3,
      stroke_color: "#1A1A1A",
      voice_name: "en-US-AnaNeural-Female",
      voice_rate: 1,
      bgm_volume: 0.12,
    },
  },
  {
    id: "landscape",
    label: "Landscape",
    hint: "16:9 for YouTube. Far more stock footage is shot this way.",
    params: {
      ...CAPTION_BASE,
      video_aspect: "16:9",
      video_clip_duration: 5,
      video_transition_mode: null,
      subtitle_display_mode: "sentence",
      subtitle_animation: "none",
      font_size: 48,
      stroke_width: 1.5,
      voice_name: "en-US-AvaMultilingualNeural-Female",
      voice_rate: 1,
      bgm_volume: 0.1,
    },
  },
];

/** Free, no API key. The engine picks its backend from this string alone. */
export const VOICES = [
  { id: "en-US-AvaNeural-Female", label: "Ava — natural, warm" },
  { id: "en-US-AvaMultilingualNeural-Female", label: "Ava Multilingual — richer, slower to stream" },
  { id: "en-US-AndrewNeural-Male", label: "Andrew — natural, male" },
  { id: "en-US-EmmaNeural-Female", label: "Emma — bright" },
  { id: "en-US-AnaNeural-Female", label: "Ana — child, playful" },
  { id: "en-AU-NatashaNeural-Female", label: "Natasha — Australian" },
  { id: "en-GB-SoniaNeural-Female", label: "Sonia — British" },
];

/** Progress checkpoints the engine writes, used to name the current stage. */
export const STAGES: ReadonlyArray<{ at: number; label: string }> = [
  { at: 5, label: "Writing the script" },
  { at: 10, label: "Choosing search terms" },
  { at: 20, label: "Recording narration" },
  { at: 30, label: "Timing captions" },
  { at: 40, label: "Finding footage" },
  { at: 50, label: "Cutting and rendering" },
  { at: 100, label: "Done" },
];

export function stageLabel(progress: number): string {
  let current = STAGES[0]!.label;
  for (const s of STAGES) if (progress >= s.at) current = s.label;
  return current;
}
