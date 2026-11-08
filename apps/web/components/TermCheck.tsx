"use client";

import { useState } from "react";

type Verdict = "good" | "thin" | "dominated" | "empty";

interface TermReport {
  term: string;
  clips: number;
  distinctCreators: number;
  aiGeneratedExcluded: number;
  verdict: Verdict;
  advice: string;
}

interface Summary {
  reports: TermReport[];
  uniqueClips: number;
  uniqueSeconds: number;
  verdict: "ready" | "risky";
  advice: string;
}

/** Colour carries severity; the glyph carries it again for colour-blind users. */
const VERDICT: Record<Verdict, { mark: string; className: string }> = {
  good: { mark: "✓", className: "text-emerald-700 dark:text-emerald-400" },
  thin: { mark: "~", className: "text-amber-700 dark:text-amber-400" },
  dominated: { mark: "!", className: "text-amber-700 dark:text-amber-400" },
  empty: { mark: "✕", className: "text-red-700 dark:text-red-400" },
};

/**
 * Checks search terms before a render is started.
 *
 * A render takes minutes; this takes seconds. The thing it catches — one
 * contributor supplying most of a term's clips — is invisible in a result
 * count but obvious in the finished video.
 */
export function TermCheck({
  terms,
  aspect,
  narrationSeconds,
}: {
  terms: string;
  aspect: string;
  /** Rough target length, so coverage can be judged against it. */
  narrationSeconds?: number;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = terms.split(",").map((t) => t.trim()).filter(Boolean);

  async function check() {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: list, aspect }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? "Could not check those terms.");
        return;
      }
      setSummary(body);
    } catch {
      setError("Could not reach the term checker.");
    } finally {
      setBusy(false);
    }
  }

  if (list.length === 0) return null;

  const short =
    summary && narrationSeconds ? summary.uniqueSeconds < narrationSeconds : false;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={check}
        disabled={busy}
        className="self-start rounded-md border border-stone-300 px-3 py-1.5 text-xs font-medium transition-colors hover:border-stone-400 disabled:opacity-50 dark:border-stone-700 dark:hover:border-stone-500"
      >
        {busy ? "Checking…" : `Check ${list.length} term${list.length === 1 ? "" : "s"}`}
      </button>

      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}

      {summary && (
        <div className="flex flex-col gap-2 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
          <ul className="flex flex-col gap-1.5">
            {summary.reports.map((r) => (
              <li key={r.term} className="flex gap-2 text-xs leading-relaxed">
                <span className={`font-mono ${VERDICT[r.verdict].className}`} aria-hidden>
                  {VERDICT[r.verdict].mark}
                </span>
                <span className="flex-1">
                  <span className="font-medium">{r.term}</span>
                  <span className="text-stone-500">
                    {" — "}
                    {r.clips > 0
                      ? `${r.clips} clips, ${r.distinctCreators} creator${r.distinctCreators === 1 ? "" : "s"}`
                      : "nothing usable"}
                    {r.aiGeneratedExcluded > 0 && ` · ${r.aiGeneratedExcluded} AI-generated skipped`}
                  </span>
                  <span className="block text-stone-500">{r.advice}</span>
                </span>
              </li>
            ))}
          </ul>

          <p
            className={`border-t border-stone-200 pt-2 text-xs dark:border-stone-800 ${
              summary.verdict === "ready"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-amber-700 dark:text-amber-400"
            }`}
          >
            {summary.advice}
            <span className="text-stone-500">
              {" "}
              {summary.uniqueClips} distinct clips, {summary.uniqueSeconds}s of footage.
            </span>
          </p>

          {short && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              That is less footage than your narration needs, so clips will repeat. Add
              another term.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
