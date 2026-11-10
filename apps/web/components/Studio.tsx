"use client";

import { useCallback, useEffect, useState } from "react";
import { ActivityLog } from "@/components/ActivityLog";
import { TermCheck } from "@/components/TermCheck";
import { Storyboard, type Board } from "@/components/Storyboard";
import { AudioSection } from "@/components/sections/AudioSection";
import { ScriptSection } from "@/components/sections/ScriptSection";
import { SubtitleSection } from "@/components/sections/SubtitleSection";
import { VideoSection } from "@/components/sections/VideoSection";
import { PRESETS, describePreset } from "@/lib/presets";
import { useCatalogue } from "@/lib/useCatalogue";
import { useTaskStream } from "@/lib/useTaskStream";
import { useVideoParams } from "@/lib/useVideoParams";

type Phase = "idle" | "running" | "done" | "error";

/** Where the id of the render being followed is kept. */
const FOLLOWING_KEY = "tasawwur:following";

export function Studio() {
  const { params, set, seed, presetId, applyPreset, reset, isEdited } = useVideoParams();
  const { voices, fonts, tracks, musicMessage, loading, error: catalogueError, speechMessage } = useCatalogue();

  const [settings, setSettings] = useState<{
    videoSource?: string;
    pixabayApiKeySet?: boolean;
    pexelsApiKeySet?: boolean;
  } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  /*
   * Which render this page is following, remembered across a reload.
   *
   * The work happens server-side and carries on regardless, but the id lived
   * only in component state — so a refresh, or a hot reload in development,
   * left the panel stuck at "Starting 0%" while the video quietly finished on
   * disk with no way back to it. The progress stream already replays current
   * state to a client that joins late; all that was missing was remembering
   * what to re-join.
   *
   * Session storage rather than local: a render belongs to the tab that
   * started it, and resurrecting a week-old id in a new window would be
   * stranger than forgetting it.
   */
  const [taskId, setTaskId] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(FOLLOWING_KEY);
    if (saved) setTaskId(saved);
  }, []);

  useEffect(() => {
    if (taskId) sessionStorage.setItem(FOLLOWING_KEY, taskId);
    else sessionStorage.removeItem(FOLLOWING_KEY);
  }, [taskId]);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState<"script" | "terms" | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const [board, setBoard] = useState<Board | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState<{
    index: number;
    total: number;
    label: string;
  } | null>(null);
  /**
   * What the storyboard was built against. If the terms or clip length change
   * afterwards, the arrangement no longer matches the settings and silently
   * rendering it would be worse than not offering this at all.
   */
  const [boardFor, setBoardFor] = useState<string | null>(null);

  const stream = useTaskStream(taskId);

  // A remembered render that no longer exists would leave the page waiting on
  // a stream with nothing to say. Forget it and show the form instead.
  useEffect(() => {
    if (stream.missing) setTaskId(null);
  }, [stream.missing]);
  const preset = PRESETS.find((p) => p.id === presetId)!;

  // The schema default is a source this install may have no key for, so the
  // configured one wins. Without this the form silently asks for footage from
  // a provider that cannot answer.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        setSettings(s);
        if (s.videoSource) seed({ video_source: s.videoSource });
      })
      .catch(() => {});
  }, [seed]);


  useEffect(() => {
    // A render picked up again after a refresh arrives mid-flight, with no
    // click to have set the phase. Without this the progress panel never
    // appeared for the very case the page is remembering renders for.
    if (!stream.job) return;
    if (!stream.finished) {
      setPhase("running");
      return;
    }
    if (stream.error) {
      setPhase("error");
      setError(stream.error);
    } else {
      setPhase("done");
    }
  }, [stream.job, stream.finished, stream.error]);

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

  const termsText =
    typeof params.video_terms === "string" ? params.video_terms : "";
  const boardKey = `${termsText}|${params.video_clip_duration}|${params.video_aspect}`;
  const boardStale = board !== null && boardFor !== boardKey;

  const previewClips = useCallback(async () => {
    setPreviewing(true);
    setBoardError(null);
    try {
      const res = await fetch("/api/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terms: termsText.split(",").map((t) => t.trim()).filter(Boolean),
          script: params.video_script,
          clipDuration: params.video_clip_duration,
          pace: params.video_pace,
          aspect: params.video_aspect,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setBoardError(body.detail ?? body.error ?? "Could not preview clips.");
        return;
      }
      setBoard(body);
      setBoardFor(boardKey);
    } catch {
      setBoardError("Could not reach the server.");
    } finally {
      setPreviewing(false);
    }
  }, [termsText, params.video_script, params.video_clip_duration, params.video_aspect, boardKey]);

  /** Download the arranged clips, then render exactly those. */
  const renderBoard = useCallback(async () => {
    if (!board) return;
    setBoardError(null);
    setCommitting({ index: 0, total: board.shots.length, label: "" });

    try {
      const res = await fetch("/api/storyboard/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clips: board.shots.map((s) => ({ url: s.clip.url, label: s.term })),
        }),
      });
      if (!res.body) throw new Error("No response from the server.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let materials: string[] | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "progress") setCommitting(event);
          else if (event.type === "error") throw new Error(event.message);
          else if (event.type === "done") materials = event.materials;
        }
      }

      if (!materials?.length) throw new Error("No clips were prepared.");

      setCommitting(null);
      setPhase("running");
      setError(null);
      setTaskId(null);
      // Local source in sequential order is what makes the arrangement
      // authoritative — the renderer picks nothing of its own.
      const started = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          params: { ...params, video_source: "local", video_concat_mode: "sequential", video_count: 1 },
          // The storyboard already chose and fetched these, in this order.
          materials,
        }),
      });
      const startedBody = await started.json();
      if (!started.ok) throw new Error(startedBody.error ?? "Could not start rendering.");
      setTaskId(startedBody.id);
      setBoard(null);
    } catch (e) {
      setCommitting(null);
      setBoardError(e instanceof Error ? e.message : "Could not prepare the clips.");
    }
  }, [board, params]);

  const canSubmit =
    Boolean(params.video_subject.trim() || params.video_script.trim()) && phase !== "running";

  const submit = useCallback(async () => {
    setPhase("running");
    setError(null);
    setTaskId(null);
    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not start rendering.");
      setTaskId(body.id);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, [params]);

  const videoReady = stream.job?.state === "done";

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
          <VideoSection
            params={params}
            set={set}
            sources={[
              {
                value: "pixabay",
                label: "Pixabay — free stock video",
                ready: settings?.pixabayApiKeySet ?? false,
              },
              {
                value: "pexels",
                label: "Pexels — free stock video",
                ready: settings?.pexelsApiKeySet ?? false,
              },
              { value: "local", label: "My own files", ready: true },
            ]}
          />
          <AudioSection
            params={params}
            set={set}
            voices={voices}
            loading={loading}
            error={catalogueError}
            speechMessage={speechMessage}
            tracks={tracks}
            musicMessage={musicMessage}
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

        {board && (
          <div className="flex flex-col gap-2">
            {boardStale && (
              <p className="text-xs text-amber-700 dark:text-amber-500">
                The settings changed after this was built, so it no longer matches. Preview
                again before rendering.
              </p>
            )}
            <Storyboard
              board={board}
              onChange={setBoard}
              onClose={() => setBoard(null)}
              onRender={renderBoard}
              committing={committing}
            />
          </div>
        )}

        {boardError && (
          <p className="text-xs text-red-700 dark:text-red-400">{boardError}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={previewClips}
            disabled={!termsText.trim() || previewing || phase === "running"}
            className="rounded-md border border-stone-300 px-4 py-2.5 text-sm transition-colors hover:border-stone-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:hover:border-stone-500"
          >
            {previewing ? "Finding clips…" : board ? "Preview again" : "Preview clips"}
          </button>
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
              <span className="text-sm font-medium">{stream.job?.stage ?? "Starting"}</span>
              <span className="font-mono text-sm tabular-nums text-stone-500">
{stream.job?.progress ?? 0}%
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
              role="progressbar"
              aria-valuenow={stream.job?.progress ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-stone-900 transition-[width] duration-700 ease-out dark:bg-stone-100"
                style={{ width: `${Math.max(stream.job?.progress ?? 0, 3)}%` }}
              />
            </div>
            <ActivityLog entries={stream.log} />
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

        {phase === "done" && videoReady && taskId && (
          <div className="flex flex-col gap-3">
            <video
              key={taskId}
              controls
              playsInline
              src={`/api/videos/${taskId}/file`}
              className={`w-full rounded-lg bg-black shadow-sm ${
                params.video_aspect === "16:9" ? "max-w-xl" : "max-w-sm"
              } self-start`}
            />
            <div className="flex gap-4 text-sm">
              <a
                href={`/api/videos/${taskId}/file?download`}
                className="underline underline-offset-4"
              >
                Download
              </a>
              {/*
                A finished render is remembered across a refresh so the result
                is not lost, which left no way to put it down: the video came
                back on every reload and the panel could not be cleared. This
                only stops the page following it — the file stays on disk.
              */}
              <button
                type="button"
                onClick={() => {
                  // Both, or the panel renders neither: the finished view
                  // needs the id and the empty view needs the phase.
                  setTaskId(null);
                  setPhase("idle");
                }}
                className="underline underline-offset-4 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
              >
                Start another
              </button>
              <span className="font-mono text-xs text-stone-500">{taskId}</span>
            </div>
            <ActivityLog entries={stream.log} />
          </div>
        )}
      </section>
    </div>
  );
}
