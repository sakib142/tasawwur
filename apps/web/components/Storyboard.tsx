"use client";

import { useState } from "react";

interface Clip {
  id: number;
  url: string;
  pageUrl: string;
  thumbnail?: string;
  creator: string;
  durationSeconds: number;
  bytes?: number;
}

interface Shot {
  id: string;
  term: string;
  clip: Clip;
  alternatives: Clip[];
  /** The line this shot will sit under, when a script was written. */
  line?: string;
  /** How well the clip's tags match that line, 0 to 1. */
  match?: number;
}

export interface Board {
  shots: Shot[];
  clipDuration: number;
  totalSeconds: number;
  narrationSeconds: number;
  emptyTerms: string[];
  /** Whether the script can be illustrated at all. See describeCoverage. */
  coverage?: {
    unmatched: number;
    creators: number;
    verdict: "ready" | "thin" | "mismatched";
    advice: string;
  };
}

/**
 * The clips that will be used, in the order they will appear.
 *
 * Rendering runs from this exact list, so what is arranged here is what is
 * produced — the renderer does no searching or shuffling of its own.
 *
 * Reordering is buttons rather than drag-and-drop on purpose: a drag-only list
 * cannot be used without a mouse, and this is the one screen where being unable
 * to rearrange defeats the point.
 */
export function Storyboard({
  board,
  onChange,
  onClose,
  onRender,
  committing,
}: {
  board: Board;
  onChange: (next: Board) => void;
  onClose: () => void;
  onRender: () => void;
  /** Per-clip progress while downloading, or null when idle. */
  committing: { index: number; total: number; label: string } | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const update = (shots: Shot[]) =>
    onChange({ ...board, shots, totalSeconds: shots.length * board.clipDuration });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= board.shots.length) return;
    const shots = [...board.shots];
    const [moved] = shots.splice(from, 1);
    if (moved) shots.splice(to, 0, moved);
    update(shots);
  };

  const remove = (id: string) => update(board.shots.filter((s) => s.id !== id));

  /** Swap a shot for one of its alternatives, keeping the old one swappable. */
  const swap = (shotId: string, clip: Clip) => {
    update(
      board.shots.map((s) =>
        s.id === shotId
          ? {
              ...s,
              clip,
              alternatives: [s.clip, ...s.alternatives.filter((a) => a.id !== clip.id)],
            }
          : s,
      ),
    );
    setExpanded(null);
  };

  const short = board.totalSeconds < board.narrationSeconds;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-stone-200 p-5 dark:border-stone-800">
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Clips in order</h2>
          <p className="text-xs text-stone-500">
            {board.shots.length} clip{board.shots.length === 1 ? "" : "s"} ·{" "}
            {board.totalSeconds}s of footage for {board.narrationSeconds}s of narration
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-stone-500 underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
        >
          Discard
        </button>
      </header>

      {/*
        The verdict on the script, before anything is rendered.
        A mismatch is stated loudly because it is the failure that otherwise
        reaches the finished video looking like a deliberate choice: an advert
        set in Riyadh came back as snow and the wrong cities, and watching it
        was the only way to find out.
      */}
      {board.coverage && board.coverage.verdict === "mismatched" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {board.coverage.advice}
        </p>
      )}

      {board.coverage && board.coverage.verdict === "ready" && (
        <p className="text-xs text-stone-500">{board.coverage.advice}</p>
      )}

      {short && (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          Less footage than narration, so clips will repeat. Add a search term, or shorten
          the script.
        </p>
      )}

      {board.emptyTerms.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          Nothing usable for {board.emptyTerms.map((t) => `“${t}”`).join(", ")}.
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {board.shots.map((shot, i) => (
          <li key={shot.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="w-4 shrink-0 text-right font-mono text-xs text-stone-400">
                {i + 1}
              </span>

              {shot.clip.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shot.clip.thumbnail}
                  alt=""
                  className="h-14 w-10 shrink-0 rounded object-cover"
                />
              ) : (
                <span className="h-14 w-10 shrink-0 rounded bg-stone-200 dark:bg-stone-800" />
              )}

              <span className="flex min-w-0 flex-1 flex-col">
                {/* The line matters more than the keyword: it is what the
                    viewer will hear while this shot is on screen. */}
                <span className="truncate text-sm">
                  {shot.line ?? shot.term}
                </span>
                <span className="truncate text-xs text-stone-500">
                  {shot.clip.creator} · ~{board.clipDuration.toFixed(1)}s
                  {shot.clip.bytes
                    ? ` · ${Math.round(shot.clip.bytes / 1e6)}MB`
                    : ""}
                  {shot.line ? ` · ${shot.term}` : ""}
                </span>
              </span>

              {/* Flagged rather than hidden. A shot that matches nothing in
                  its line is the one worth swapping, and only the person
                  looking at it can judge whether it actually works. */}
              {shot.line && shot.match === 0 && (
                <span
                  className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-400"
                  title="Nothing in this clip's tags matches this line. It may still be fine."
                >
                  unmatched
                </span>
              )}

              <span className="flex shrink-0 items-center gap-1">
                <IconButton label={`Move clip ${i + 1} up`} onClick={() => move(i, i - 1)} disabled={i === 0}>
                  ↑
                </IconButton>
                <IconButton
                  label={`Move clip ${i + 1} down`}
                  onClick={() => move(i, i + 1)}
                  disabled={i === board.shots.length - 1}
                >
                  ↓
                </IconButton>
                <IconButton
                  label={`Show alternatives for clip ${i + 1}`}
                  onClick={() => setExpanded(expanded === shot.id ? null : shot.id)}
                  disabled={shot.alternatives.length === 0}
                >
                  ⇄
                </IconButton>
                <IconButton label={`Remove clip ${i + 1}`} onClick={() => remove(shot.id)}>
                  ✕
                </IconButton>
              </span>
            </div>

            {expanded === shot.id && (
              <ul className="ml-7 flex flex-wrap gap-2">
                {shot.alternatives.map((alt) => (
                  <li key={alt.id}>
                    <button
                      type="button"
                      onClick={() => swap(shot.id, alt)}
                      title={`${alt.creator} · ${alt.durationSeconds}s`}
                      className="block overflow-hidden rounded border border-transparent transition-colors hover:border-stone-900 dark:hover:border-stone-100"
                    >
                      {alt.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={alt.thumbnail} alt={alt.creator} className="h-14 w-10 object-cover" />
                      ) : (
                        <span className="block h-14 w-10 bg-stone-200 dark:bg-stone-800" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>

      {board.shots.length === 0 && (
        <p className="text-xs text-stone-500">
          No clips left. Discard this and change the search terms.
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
        <button
          type="button"
          onClick={onRender}
          disabled={board.shots.length === 0 || committing !== null}
          className="rounded-md bg-stone-900 px-5 py-2.5 text-sm font-medium text-stone-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
        >
          {committing ? "Preparing clips…" : "Render these clips"}
        </button>
        {committing && (
          <span className="text-xs text-stone-500">
            {committing.index + 1} of {committing.total} — {committing.label}
          </span>
        )}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded border border-stone-300 text-xs transition-colors hover:border-stone-500 disabled:cursor-not-allowed disabled:opacity-30 dark:border-stone-700 dark:hover:border-stone-400"
    >
      {children}
    </button>
  );
}
