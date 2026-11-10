"use client";

import { Field, Section, Select, Slider, Toggle } from "@/components/ui/Form";
import type { Params } from "@/lib/useVideoParams";
import { LocalMaterials } from "./LocalMaterials.tsx";

/**
 * Video Settings — shape, pacing and footage handling.
 *
 * Every control here was already accepted by the renderer and simply had no way
 * to be set.
 */
export function VideoSection({
  params,
  set,
  sources,
}: {
  params: Params;
  set: <K extends keyof Params>(k: K, v: Params[K]) => void;
  /** Footage sources that are actually usable — a missing key disables one. */
  sources: ReadonlyArray<{ value: string; label: string; ready: boolean }>;
}) {
  const summary = [
    params.video_aspect,
    params.video_pace === "even" ? `${params.video_clip_duration}s cuts` : params.video_pace,
    params.video_grade !== "none" ? params.video_grade : null,
    params.video_count > 1 ? `${params.video_count} versions` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Section title="Video" summary={summary}>
      <Field
        label="Footage source"
        warning={
          sources.find((s) => s.value === params.video_source)?.ready === false
            ? "This source has no API key yet. Add one in Settings, or pick another."
            : null
        }
      >
        <Select
          value={params.video_source}
          onChange={(v) => set("video_source", v)}
          options={sources.map((s) => ({
            value: s.value,
            label: s.ready ? s.label : `${s.label} — needs a key`,
          }))}
        />
      </Field>

      {params.video_source === "local" && <LocalMaterials params={params} set={set} />}

      <Field label="Shape" hint="9:16 for phones, 16:9 for YouTube, 1:1 for feeds.">
        <Select
          value={params.video_aspect}
          onChange={(v) => set("video_aspect", v)}
          options={[
            { value: "9:16", label: "Vertical 9:16 — 1080×1920" },
            { value: "16:9", label: "Landscape 16:9 — 1920×1080" },
            { value: "1:1", label: "Square 1:1 — 1080×1080" },
          ]}
        />
      </Field>

      <Field
        label="Fit"
        hint="Cover fills the frame and crops the edges. Contain keeps the whole shot and adds bars."
      >
        <Select
          value={params.video_fit_mode}
          onChange={(v) => set("video_fit_mode", v)}
          options={[
            { value: "cover", label: "Cover — fill the frame, crop the rest" },
            { value: "contain", label: "Contain — whole shot, with bars" },
          ]}
        />
      </Field>

      <Field
        label="Pace"
        hint="All three cut where a sentence ends — none of them buys a cut by changing the picture mid-word. What changes is whether short sentences share a shot."
      >
        <Select
          value={params.video_pace}
          onChange={(v) => set("video_pace", v)}
          options={[
            { value: "snappy", label: "Snappy — a shot per sentence" },
            { value: "even", label: "Even — a shot per clip, roughly" },
            { value: "measured", label: "Measured — let a shot sit" },
          ]}
        />
      </Field>

      <Field
        label="Shot length"
        hint={
          params.video_pace === "even"
            ? "Shots vary, because sentences do. This is about the longest one."
            : `The length at an even pace; ${params.video_pace} works around it.`
        }
      >
        <Slider
          value={params.video_clip_duration}
          onChange={(v) => set("video_clip_duration", v)}
          min={2}
          max={12}
          format={(v) => `${v}s`}
        />
      </Field>

      <Field
        label="Look"
        hint="One grade across every clip. Stock footage arrives from different creators with different white balance; matching it is most of what makes a montage look deliberate."
      >
        <Select
          value={params.video_grade}
          onChange={(v) => set("video_grade", v)}
          options={[
            { value: "natural", label: "Natural — a little more contrast and colour" },
            { value: "warm", label: "Warm — golden, for anything sunlit" },
            { value: "cool", label: "Cool — blue, for night and water" },
            { value: "none", label: "None — leave each clip as it came" },
          ]}
        />
      </Field>

      <Field
        label="Transition"
        warning={
          params.video_transition_mode === "Shuffle"
            ? "Shuffle picks a random transition per cut, so a fade-out can meet a fade-in and blink through black. A 40-second test render produced five such flashes."
            : null
        }
      >
        <Select
          value={params.video_transition_mode ?? "none"}
          onChange={(v) =>
            set("video_transition_mode", v === "none" ? null : (v as never))
          }
          options={[
            { value: "none", label: "None — hard cuts" },
            { value: "FadeIn", label: "Fade in" },
            { value: "FadeOut", label: "Fade out" },
            { value: "SlideIn", label: "Slide in" },
            { value: "SlideOut", label: "Slide out" },
            { value: "ZoomIn", label: "Zoom in" },
            { value: "ZoomOut", label: "Zoom out" },
            { value: "Shuffle", label: "Shuffle — random each cut" },
          ]}
        />
      </Field>

      <Field
        label="Clip order"
        hint="Sequential follows your keyword order, so the footage tracks the script."
      >
        <Select
          value={params.video_concat_mode}
          onChange={(v) => set("video_concat_mode", v)}
          options={[
            { value: "random", label: "Random" },
            { value: "sequential", label: "Sequential" },
          ]}
        />
      </Field>

      <Toggle
        checked={params.match_materials_to_script}
        onChange={(v) => set("match_materials_to_script", v)}
        label="Match footage to the order of the script"
      />

      <Field label="Playback speed" hint="Applied to the footage, not the narration.">
        <Slider
          value={params.video_clip_speed}
          onChange={(v) => set("video_clip_speed", v)}
          min={0.5}
          max={2}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
        />
      </Field>

      <Field
        label="Versions"
        hint="Renders this many takes from the same script, each with different footage."
      >
        <Slider
          value={params.video_count}
          onChange={(v) => set("video_count", v)}
          min={1}
          max={5}
        />
      </Field>

      <Field label="Still images" hint="How photographs move, when footage is a still.">
        <Select
          value={params.image_motion}
          onChange={(v) => set("image_motion", v)}
          options={[
            { value: "zoom", label: "Slow zoom" },
            { value: "static", label: "Hold still" },
          ]}
        />
      </Field>

    </Section>
  );
}
