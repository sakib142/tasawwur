"use client";

import { Field, Section, Select, Slider } from "@/components/ui/Form";
import type { Params } from "@/lib/useVideoParams";
import type { VoiceOption } from "@/lib/useCatalogue";

/** Audio Settings — the narration voice and how it sits in the mix. */
export function AudioSection({
  params,
  set,
  voices,
  loading,
  error,
  speechMessage,
}: {
  params: Params;
  set: <K extends keyof Params>(k: K, v: Params[K]) => void;
  voices: VoiceOption[];
  loading: boolean;
  error: string | null;
  /** Set when the speech model is missing, which blocks rendering entirely. */
  speechMessage: string | null;
}) {
  const current = voices.find((v) => v.id === params.voice_name);
  const summary = current ? `${current.name} · ${current.language}` : "Default voice";

  return (
    <Section title="Audio" summary={summary} defaultOpen>
      <Field
        label="Voice"
        hint={
          error ??
          speechMessage ??
          (loading
            ? "Loading voices…"
            : "Spoken on this machine. Nothing is sent anywhere, and nothing is billed.")
        }
        warning={
          current && !current.recommended
            ? `This voice is rated ${current.grade} by the model's authors. The higher-rated ones sound noticeably better.`
            : null
        }
      >
        <Select
          value={params.voice_name}
          onChange={(v) => set("voice_name", v)}
          options={
            voices.length
              ? voices.map((v) => ({
                  value: v.id,
                  label: `${v.name} — ${v.language}, ${v.gender.toLowerCase()}${v.recommended ? "" : ` (rated ${v.grade})`}`,
                }))
              : [{ value: params.voice_name, label: params.voice_name || "Default" }]
          }
        />
      </Field>

      <Field
        label="Speaking rate"
        hint="Slower suits a reflective piece; faster suits something punchy."
      >
        <Slider
          value={params.voice_rate}
          onChange={(v) => set("voice_rate", v)}
          min={0.5}
          max={2}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
        />
      </Field>

      <Field label="Narration volume">
        <Slider
          value={params.voice_volume}
          onChange={(v) => set("voice_volume", v)}
          min={0}
          max={2}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Field>
    </Section>
  );
}
