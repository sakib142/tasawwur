"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, TasawwurClient } from "@tasawwur/api-client";
import { ActivityLog } from "@/components/ActivityLog";
import { TermCheck } from "@/components/TermCheck";
import { AudioSection } from "@/components/sections/AudioSection";
import { ScriptSection } from "@/components/sections/ScriptSection";
import { SubtitleSection } from "@/components/sections/SubtitleSection";
import { VideoSection } from "@/components/sections/VideoSection";
import { PRESETS, describePreset } from "@/lib/presets";
import { useCatalogue } from "@/lib/useCatalogue";
import { useTaskStream } from "@/lib/useTaskStream";
import { useVideoParams } from "@/lib/useVideoParams";

// Same-origin: the proxy route forwards to the renderer.
const api = new TasawwurClient({ baseUrl: "/api/engine" });

type Phase = "idle" | "running" | "done" | "error";

export function Studio() {
  const { params, set, presetId, applyPreset, reset, isEdited } = useVideoParams();
  const { voices, fonts, loading, error: catalogueError } = useCatalogue();

  const [musicFiles, setMusicFiles] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState<"script" | "terms" | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const stream = useTaskStream(taskId);
  const preset = PRESETS.find((p) => p.id === presetId)!;

  useEffect(() => {
    api
      .listMusic()
      .then((files) => setMusicFiles(files.filter((f): f is string => typeof f === "string")))
      .catch(() => setMusicFiles([]));
  }, []);

  useEffect(() => {
    if (!stream.finished) return;
    if (stream.error) {
      setPhase("error");
      setError(stream.error);
    } else {
      setPhase("done");
    }
  }, [stream.finished, stream.error]);

  const writeTerms = useCallback(
    async (forScript: string) => {
      setWriting("terms");
      const res = await fetch("/api/llm/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: forScript, count: 6 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not choose keywords.");
      set("video_terms", (body.terms as string[]).join(", "));
    },
    [set],
  );

  const writeScript = useCallback(async () => {
    setWriting("script");
    setWriteError(null);
    try {
      const res = await fetch("/api/llm/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: params.video_subject.trim(),
          targetSeconds: 40,
          ...(params.video_language ? { language: params.video_language } : {}),
          ...(params.video_script_prompt ? { guidance: params.video_script_prompt } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not write the script.");
      set("video_script", body.script);
      await writeTerms(body.script);
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setWriting(null);
    }
  }, [params, set, writeTerms]);

  const onWriteTerms = useCallback(async () => {
    setWriteError(null);
    try {
      await writeTerms(params.video_script.trim());
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setWriting(null);
    }
  }, [params.video_script, writeTerms]);

  const canSubmit =
    Boolean(params.video_subject.trim() || params.video_script.trim()) && phase !== "running";

  const submit = useCallback(async () => {
    setPhase("running");
    setError(null);
    setTaskId(null);
    try {
      setTaskId(await api.createVideo(params));
    } catch (e) {
      setPhase("error");
      setError(
        e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong.",
      );
    }
  }, [params]);

  const videoUri = stream.videos?.[0];

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        {/* Style presets seed the sections below; nothing here is locked. */}
        <div className="flex flex-col gap-2">
          <span className="flex items-baseline justify-between gap-3 text-sm font-medium">
            Style
            <span className="flex flex-wrap justify-end gap-1">
              {describePreset(preset).map((bit) => (
                <span
                  key={bit}
                  className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-normal text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                >
                  {bit}
                </span>
              ))}
            </span>
          </span>
          <div className="flex gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
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
          <span className="flex items-baseline justify-between gap-3 text-xs text-stone-500">
            {preset.hint}
            {isEdited && (
              <button
                type="button"
                onClick={reset}
                className="shrink-0 underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
              >
                Reset to preset
              </button>
            )}
          </span>
        </div>

        <ScriptSection
          params={params}
          set={set}
          writing={writing}
          writeError={writeError}
          onWriteScript={writeScript}
          onWriteTerms={onWriteTerms}
          termCheck={
            <TermCheck
              terms={typeof params.video_terms === "string" ? params.video_terms : ""}
              aspect={params.video_aspect}
              narrationSeconds={
                params.video_script.trim()
                  ? Math.round(params.video_script.trim().split(/\s+/).length / 2.6)
                  : undefined
              }
            />
          }
        />

        <div className="flex flex-col">
          <VideoSection params={params} set={set} musicFiles={musicFiles} />
          <AudioSection
            params={params}
            set={set}
            voices={voices}
            loading={loading}
            error={catalogueError}
          />
          <SubtitleSection
            params={params}
            set={set}
            fonts={fonts}
            // Kokoro and the current renderer report no word boundaries, so
            // word-level timings are estimated. Said plainly rather than
            // letting the captions drift without explanation.
            wordTimingsAvailable={false}
          />
        </div>

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
                setTaskId(null);
                setPhase("idle");
              }}
              className="text-sm text-stone-500 underline underline-offset-4 hover:text-stone-800 dark:hover:text-stone-200"
            >
              Stop watching
            </button>
          )}
        </div>
      </div>

      {/* ---- output ---- */}
      <section className="flex flex-col gap-4">
        {phase === "idle" && (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 p-8 text-center text-sm leading-relaxed text-stone-500 dark:border-stone-700">
            <p>
              Give it a topic or a script, then press Generate.
              <br />A 40-second video takes roughly 3 to 5 minutes.
            </p>
          </div>
        )}

        {phase === "running" && (
          <div className="flex flex-col gap-3 rounded-lg border border-stone-200 p-5 dark:border-stone-800">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">{stream.stageLabel}</span>
              <span className="font-mono text-sm tabular-nums text-stone-500">
                {stream.stageSeconds > 20 && `${stream.stageSeconds}s · `}
                {stream.progress}%
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
              role="progressbar"
              aria-valuenow={stream.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-stone-900 transition-[width] duration-700 ease-out dark:bg-stone-100"
                style={{ width: `${Math.max(stream.progress, 3)}%` }}
              />
            </div>
            <ActivityLog events={stream.events} />
            <p className="text-xs text-stone-500">
              Rendering is CPU-bound and runs on your machine. You can leave this page open.
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-5 text-sm dark:border-red-900 dark:bg-red-950/40">
            <p className="font-medium text-red-900 dark:text-red-200">Could not generate</p>
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
              className={`w-full rounded-lg bg-black shadow-sm ${
                params.video_aspect === "16:9" ? "max-w-xl" : "max-w-sm"
              } self-start`}
            />
            <div className="flex gap-4 text-sm">
              <a
                href={api.streamUrl(videoUri).replace("/stream/", "/download/")}
                className="underline underline-offset-4"
              >
                Download
              </a>
              <span className="font-mono text-xs text-stone-500">{taskId}</span>
            </div>
            <ActivityLog events={stream.events} />
          </div>
        )}
      </section>
    </div>
  );
}
