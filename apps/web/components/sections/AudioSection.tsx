"use client";

import { Field, Section, Select, Slider } from "@/components/ui/Form";
import type { Params } from "@/lib/useVideoParams";
import type { TrackOption, VoiceOption } from "@/lib/useCatalogue";

/** Audio Settings — the narration voice and how it sits in the mix. */
export function AudioSection({
  params,
  set,
  voices,
  tracks,
  musicMessage,
  loading,
  error,
  speechMessage,
}: {
  params: Params;
  set: <K extends keyof Params>(k: K, v: Params[K]) => void;
  voices: VoiceOption[];
  tracks: TrackOption[];
  /** Where to put music files, when none are bundled. */
  musicMessage: string | null;
  loading: boolean;
  error: string | null;
  /** Set when the speech model is missing, which blocks rendering entirely. */
  speechMessage: string | null;
}) {
  const current = voices.find((v) => v.id === params.voice_name);
  const scored = params.bgm_volume > 0 && params.bgm_type !== "none";
  const summary = [
    current ? `${current.name} · ${current.language}` : "Default voice",
    scored ? "music" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  /** "random" and "none" are modes; anything else names a file. */
  const musicValue = scored ? (params.bgm_file || "random") : "none";

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

      <Field
        label="Music"
        hint={
          musicMessage ??
          "Mixed under the narration and ducked while anyone is speaking. Silence behind a voice is the loudest sign that something was generated rather than made."
        }
      >
        <Select
          value={musicValue}
          onChange={(v) => {
            if (v === "none") {
              set("bgm_type", "none");
              set("bgm_file", "");
              return;
            }
            set("bgm_type", v === "random" ? "random" : "file");
            set("bgm_file", v === "random" ? "" : v);
            // A track chosen with the volume at zero would silently do nothing.
            if (params.bgm_volume <= 0) set("bgm_volume", 0.18);
          }}
          options={[
            { value: "none", label: "None — narration only" },
            ...(tracks.length ? [{ value: "random", label: "Surprise me" }] : []),
            ...tracks.map((t) => ({ value: t.id, label: t.label })),
          ]}
        />
      </Field>

      {scored && (
        <Field label="Music volume" hint="Measured before ducking; it drops further under speech.">
          <Slider
            value={params.bgm_volume}
            onChange={(v) => set("bgm_volume", v)}
            min={0}
            max={0.6}
            step={0.02}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Field>
      )}

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
