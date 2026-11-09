"use client";

import Link from "next/link";
import { Field, Section, Select, Slider, inputClass } from "@/components/ui/Form";
import type { Params } from "@/lib/useVideoParams";

const LANGUAGES = [
  { value: "", label: "Auto detect" },
  ...["English", "Arabic", "Spanish", "French", "German", "Hindi", "Urdu", "Chinese"].map(
    (l) => ({ value: l, label: l }),
  ),
];

/** The ✦ actions that fill the fields below them. */
function WriteButton({
  onClick,
  disabled,
  busy,
  label,
  busyLabel,
}: {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  label: string;
  busyLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm transition-colors hover:border-stone-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:hover:border-stone-500"
    >
      <span aria-hidden className={busy ? "animate-pulse" : undefined}>
        ✦
      </span>
      {busy ? busyLabel : label}
    </button>
  );
}

export function ScriptSection({
  params,
  set,
  writing,
  writeError,
  onWriteScript,
  onWriteTerms,
  termCheck,
}: {
  params: Params;
  set: <K extends keyof Params>(k: K, v: Params[K]) => void;
  writing: "script" | "terms" | null;
  writeError: string | null;
  onWriteScript: () => void;
  onWriteTerms: () => void;
  /** Rendered under the keywords — the coverage checker. */
  termCheck: React.ReactNode;
}) {
  const terms = typeof params.video_terms === "string" ? params.video_terms : "";

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Topic"
        labelAside={
          <Link
            href="/settings"
            className="text-xs font-normal text-stone-500 underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
          >
            Configure AI model
          </Link>
        }
        hint="Leave blank if you are writing the script yourself."
      >
        <input
          value={params.video_subject}
          onChange={(e) => set("video_subject", e.target.value)}
          placeholder="Why rivers always find a way"
          className={inputClass}
        />
      </Field>

      <Field label="Script language">
        <Select
          value={params.video_language}
          onChange={(v) => set("video_language", v)}
          options={LANGUAGES}
        />
      </Field>

      <Section title="Advanced script settings" summary={`${params.paragraph_number} paragraph${params.paragraph_number === 1 ? "" : "s"}`}>
        <Field label="Paragraphs" hint="How many the model should write.">
          <Slider
            value={params.paragraph_number}
            onChange={(v) => set("paragraph_number", v)}
            min={1}
            max={10}
          />
        </Field>

        <Field
          label="Extra direction"
          hint="Added to the request, e.g. “for children aged 5 to 8” or “sceptical, not salesy”."
        >
          <textarea
            value={params.video_script_prompt}
            onChange={(e) => set("video_script_prompt", e.target.value)}
            rows={2}
            placeholder="for children aged 5 to 8"
            className={`${inputClass} resize-y font-[inherit]`}
          />
        </Field>

        <Field
          label="Replace the system prompt"
          hint="Leave blank to use the built-in one, which is tuned for narration a synthesiser has to read aloud. Replacing it is a sharp tool."
        >
          <textarea
            value={params.custom_system_prompt}
            onChange={(e) => set("custom_system_prompt", e.target.value)}
            rows={3}
            placeholder="You write narration for…"
            className={`${inputClass} resize-y font-[inherit] text-xs`}
          />
        </Field>
      </Section>

      <WriteButton
        onClick={onWriteScript}
        disabled={!params.video_subject.trim() || writing !== null}
        busy={writing === "script"}
        label="Write script and keywords"
        busyLabel={writing === "terms" ? "Choosing keywords…" : "Writing…"}
      />

      <Field
        label="Script"
        hint="Optional. Writing it yourself skips the model and gives you exact control."
      >
        <textarea
          value={params.video_script}
          onChange={(e) => set("video_script", e.target.value)}
          rows={6}
          placeholder="A river has no plan. It meets a rock, and it goes around…"
          className={`${inputClass} resize-y font-[inherit]`}
        />
      </Field>

      <WriteButton
        onClick={onWriteTerms}
        disabled={!params.video_script.trim() || writing !== null}
        busy={writing === "terms"}
        label="Choose keywords from the script"
        busyLabel="Choosing keywords…"
      />

      {writeError && (
        <p className="-mt-2 text-xs text-red-700 dark:text-red-400">{writeError}</p>
      )}

      <Field
        label="Search terms"
        hint="Comma separated. Terms covered by many different creators give the most varied footage."
      >
        <input
          value={terms}
          onChange={(e) => set("video_terms", e.target.value)}
          placeholder="waterfall, river water, rain window, forest trees"
          className={inputClass}
        />
      </Field>

      {termCheck}
    </div>
  );
}
