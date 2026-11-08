"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TasawwurClient, ApiError } from "@tasawwur/api-client";
import { TaskState, type TaskStatusData, type VideoParamsInput } from "@tasawwur/schema";
import { PRESETS, VOICES, stageLabel } from "@/lib/presets";
import { useCatalogue } from "@/lib/useCatalogue";
import { TermCheck } from "@/components/TermCheck";

// Same-origin: the proxy route forwards to the engine.
const api = new TasawwurClient({ baseUrl: "/api/engine" });

type Phase = "idle" | "running" | "done" | "error";

export function Studio() {
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  const [subject, setSubject] = useState("");
  const [script, setScript] = useState("");
  const [terms, setTerms] = useState("");
  const [voice, setVoice] = useState(PRESETS[0]!.params.voice_name ?? "");

  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<TaskStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const preset = PRESETS.find((p) => p.id === presetId)!;

  // Live catalogues, with the hardcoded lists as a fallback so a catalogue
  // outage never blocks generating a video.
  const { voices, fonts, loading: catalogueLoading, error: catalogueError } = useCatalogue();
  const voiceOptions =
    voices.length > 0
      ? voices.map((v) => ({
          id: v.id,
          label: `${v.label} — ${v.localeName}${v.multilingual ? " · multilingual" : ""}`,
        }))
      : VOICES;
  const [font, setFont] = useState(PRESETS[0]!.params.font_name ?? "");

  // Keep the voice in sync when switching presets, unless it was hand-picked.
  const touchedVoice = useRef(false);
  useEffect(() => {
    if (!touchedVoice.current) setVoice(preset.params.voice_name ?? "");
  }, [preset]);

  useEffect(() => () => abort.current?.abort(), []);

  const canSubmit = (subject.trim() || script.trim()) && phase !== "running";

  const submit = useCallback(async () => {
    setPhase("running");
    setError(null);
    setStatus(null);
    abort.current = new AbortController();

    const params: VideoParamsInput = {
      ...preset.params,
      voice_name: voice,
      ...(font ? { font_name: font } : {}),
      video_subject: subject.trim(),
      video_script: script.trim(),
      ...(terms.trim() ? { video_terms: terms.trim() } : {}),
      video_source: "pixabay",
    };

    try {
      const id = await api.createVideo(params);
      const final = await api.waitForTask(id, {
        intervalMs: 2000,
        signal: abort.current.signal,
        onProgress: setStatus,
      });
      setStatus(final);
      if (final.state === TaskState.failed) {
        setPhase("error");
        setError(final.error ?? `Failed during the ${final.failed_stage ?? "unknown"} stage.`);
      } else {
        setPhase("done");
      }
    } catch (e) {
      setPhase("error");
      setError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Something went wrong.",
      );
    }
  }, [preset, voice, font, subject, script, terms]);

  const videoUri = status?.videos?.[0];
  const progress = status?.progress ?? 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      {/* ---- controls ---- */}
      <section className="flex flex-col gap-6">
        <Field label="Style" hint={preset.hint}>
          <div className="flex gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPresetId(p.id)}
                aria-pressed={p.id === presetId}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                  p.id === presetId
                    ? "border-stone-900 bg-stone-900 text-stone-50 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
                    : "border-stone-300 hover:border-stone-400 dark:border-stone-700 dark:hover:border-stone-500"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Topic" hint="Leave blank if you are writing the script yourself.">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Why rivers always find a way"
            className={inputClass}
          />
        </Field>

        <Field
          label="Script"
          hint="Optional. Writing it yourself skips the model and gives you exact control."
        >
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={6}
            placeholder="A river has no plan. It meets a rock, and it goes around…"
            className={`${inputClass} resize-y font-[inherit]`}
          />
        </Field>

        <Field
          label="Search terms"
          hint="Optional, comma separated. Terms covered by many different creators give the most varied footage."
        >
          <input
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="waterfall, river water, rain window, forest trees"
            className={inputClass}
          />
        </Field>

        {/* Seconds of narration, very roughly: ~2.6 words per second. */}
        <TermCheck
          terms={terms}
          aspect={String(preset.params.video_aspect ?? "9:16")}
          narrationSeconds={
            script.trim() ? Math.round(script.trim().split(/\s+/).length / 2.6) : undefined
          }
        />

        <Field
          label="Voice"
          hint={
            catalogueError ??
            (catalogueLoading
              ? "Loading voices…"
              : `${voiceOptions.length} voices, all free and without an API key.`)
          }
        >
          <select
            value={voice}
            onChange={(e) => {
              touchedVoice.current = true;
              setVoice(e.target.value);
            }}
            className={inputClass}
          >
            {voiceOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>

        {fonts.length > 0 && (
          <Field label="Caption font" hint="Latin-first faces read best for English.">
            <select
              value={font}
              onChange={(e) => setFont(e.target.value)}
              className={inputClass}
            >
              {fonts.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                  {f.recommended ? " ★" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md bg-stone-900 px-5 py-2.5 text-sm font-medium text-stone-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
          >
            {phase === "running" ? "Generating…" : "Generate video"}
          </button>
          {phase === "running" && (
            <button
              type="button"
              onClick={() => {
                abort.current?.abort();
                setPhase("idle");
              }}
              className="text-sm text-stone-500 underline underline-offset-4 hover:text-stone-800 dark:hover:text-stone-200"
            >
              Stop watching
            </button>
          )}
        </div>
      </section>

      {/* ---- output ---- */}
      <section className="flex flex-col gap-4">
        {phase === "idle" && (
          <Placeholder>
            Pick a style, give it a topic or a script, and press Generate.
            <br />
            A 40-second video takes roughly 3 to 5 minutes.
          </Placeholder>
        )}

        {phase === "running" && (
          <div className="flex flex-col gap-3 rounded-lg border border-stone-200 p-5 dark:border-stone-800">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">{stageLabel(progress)}</span>
              <span className="font-mono text-sm tabular-nums text-stone-500">{progress}%</span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-stone-900 transition-[width] duration-700 ease-out dark:bg-stone-100"
                style={{ width: `${Math.max(progress, 3)}%` }}
              />
            </div>
            <p className="text-xs text-stone-500">
              Rendering is CPU-bound and runs on your machine. You can leave this page open.
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-5 text-sm dark:border-red-900 dark:bg-red-950/40">
            <p className="font-medium text-red-900 dark:text-red-200">
              {status?.failed_stage ? `Failed while ${status.failed_stage}` : "Could not generate"}
            </p>
            <p className="mt-1 text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        {phase === "done" && videoUri && (
          <div className="flex flex-col gap-3">
            <video
              key={videoUri}
              controls
              playsInline
              src={api.streamUrl(videoUri)}
              className="w-full max-w-sm self-start rounded-lg bg-black shadow-sm"
            />
            <div className="flex gap-4 text-sm">
              <a
                href={api.streamUrl(videoUri).replace("/stream/", "/download/")}
                className="underline underline-offset-4"
              >
                Download
              </a>
              <span className="font-mono text-xs text-stone-500">{status?.task_id}</span>
            </div>
            {status?.warnings?.length ? (
              <ul className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {status.warnings.map((w, i) => (
                  <li key={i}>{String(w.code)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-stone-400 focus:border-stone-900 dark:border-stone-700 dark:focus:border-stone-300";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs leading-relaxed text-stone-500">{hint}</span>}
    </label>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 p-8 text-center text-sm leading-relaxed text-stone-500 dark:border-stone-700">
      <p>{children}</p>
    </div>
  );
}
