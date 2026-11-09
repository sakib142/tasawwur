"use client";

import { ColorField, Field, Section, Select, Slider, Toggle } from "@/components/ui/Form";
import type { Params } from "@/lib/useVideoParams";
import type { FontOption } from "@/lib/useCatalogue";

/**
 * Subtitle Settings.
 *
 * The one control here that can quietly disappoint is the display mode: word
 * timings have to come from the speech provider, and an estimated timeline is
 * visibly out of step when each word is shown on its own.
 */
export function SubtitleSection({
  params,
  set,
  fonts,
  wordTimingsAvailable,
}: {
  params: Params;
  set: <K extends keyof Params>(k: K, v: Params[K]) => void;
  fonts: FontOption[];
  /** False when the speech provider reports no word boundaries. */
  wordTimingsAvailable: boolean;
}) {
  if (!params.subtitle_enabled) {
    return (
      <Section title="Subtitles" summary="Off">
        <Toggle
          checked={params.subtitle_enabled}
          onChange={(v) => set("subtitle_enabled", v)}
          label="Show subtitles"
        />
      </Section>
    );
  }

  const summary = `${params.subtitle_display_mode === "word_by_word" ? "Word by word" : "Sentences"} · ${params.font_size}px`;

  return (
    <Section title="Subtitles" summary={summary}>
      <Toggle
        checked={params.subtitle_enabled}
        onChange={(v) => set("subtitle_enabled", v)}
        label="Show subtitles"
      />

      <Field
        label="Style"
        warning={
          params.subtitle_display_mode === "word_by_word" && !wordTimingsAvailable
            ? "The current voice does not report when each word is spoken, so these timings are estimated from word length. Expect them to drift noticeably. Sentences are accurate either way."
            : null
        }
      >
        <Select
          value={params.subtitle_display_mode}
          onChange={(v) => set("subtitle_display_mode", v)}
          options={[
            { value: "sentence", label: "Full sentences" },
            { value: "word_by_word", label: "One word at a time" },
          ]}
        />
      </Field>

      {params.subtitle_display_mode === "word_by_word" && (
        <Field label="Entrance">
          <Select
            value={params.subtitle_animation}
            onChange={(v) => set("subtitle_animation", v)}
            options={[
              { value: "none", label: "None" },
              { value: "pop_spring", label: "Pop in" },
            ]}
          />
        </Field>
      )}

      <Field label="Position">
        <Select
          value={params.subtitle_position}
          onChange={(v) => set("subtitle_position", v)}
          options={[
            { value: "bottom", label: "Bottom" },
            { value: "two_thirds_bottom", label: "Lower third" },
            { value: "center", label: "Centre" },
            { value: "top", label: "Top" },
            { value: "custom", label: "Custom height" },
          ]}
        />
      </Field>

      {params.subtitle_position === "custom" && (
        <Field label="Height from top">
          <Slider
            value={params.custom_position}
            onChange={(v) => set("custom_position", v)}
            min={0}
            max={100}
            format={(v) => `${v}%`}
          />
        </Field>
      )}

      <Field label="Font" hint="Latin-first faces read best for English.">
        <Select
          value={params.font_name}
          onChange={(v) => set("font_name", v)}
          options={
            fonts.length
              ? fonts.map((f) => ({
                  value: f.id,
                  label: f.recommended ? `${f.label} ★` : f.label,
                }))
              : [{ value: params.font_name, label: params.font_name }]
          }
        />
      </Field>

      <Field label="Size">
        <Slider
          value={params.font_size}
          onChange={(v) => set("font_size", v)}
          min={24}
          max={120}
          format={(v) => `${v}px`}
        />
      </Field>

      <ColorField
        label="Text colour"
        value={params.text_fore_color}
        onChange={(v) => set("text_fore_color", v)}
      />

      <ColorField
        label="Outline colour"
        value={params.stroke_color}
        onChange={(v) => set("stroke_color", v)}
      />

      <Field
        label="Outline width"
        hint="An outline is what keeps white text readable over bright footage."
      >
        <Slider
          value={params.stroke_width}
          onChange={(v) => set("stroke_width", v)}
          min={0}
          max={6}
          step={0.5}
          format={(v) => `${v}px`}
        />
      </Field>

      <Toggle
        checked={params.text_background_color !== false}
        onChange={(v) => set("text_background_color", v ? "#000000" : false)}
        label="Add a background behind the text"
      />

      {params.text_background_color !== false && (
        <>
          <ColorField
            label="Background colour"
            value={
              typeof params.text_background_color === "string"
                ? params.text_background_color
                : "#000000"
            }
            onChange={(v) => set("text_background_color", v)}
          />
          <Toggle
            checked={params.rounded_subtitle_background}
            onChange={(v) => set("rounded_subtitle_background", v)}
            label="Round the corners"
          />
        </>
      )}
    </Section>
  );
}
