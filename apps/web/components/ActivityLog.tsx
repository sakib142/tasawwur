"use client";

import { useEffect, useRef } from "react";
import type { TaskEvent } from "@/lib/useTaskStream";

/** What each event type looks like in the log. */
const STYLE: Record<string, { mark: string; className: string }> = {
  stage: { mark: "›", className: "text-stone-900 dark:text-stone-100 font-medium" },
  log: { mark: "·", className: "text-stone-500" },
  done: { mark: "✓", className: "text-emerald-700 dark:text-emerald-400" },
  error: { mark: "✕", className: "text-red-700 dark:text-red-400" },
};

function describe(e: TaskEvent): string | null {
  switch (e.type) {
    case "stage":
      return e.label ?? null;
    case "log":
      return e.message ?? null;
    case "done":
      return `Finished in ${Math.round((e.elapsedMs ?? 0) / 1000)}s`;
    case "error":
      return e.stage ? `Failed while ${e.stage}: ${e.message}` : (e.message ?? "Failed");
    default:
      return null; // progress ticks drive the bar, not the log
  }
}

export function ActivityLog({ events }: { events: TaskEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const rows = events.filter((e) => describe(e) !== null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [rows.length]);

  if (rows.length === 0) return null;

  return (
    <ol className="max-h-44 overflow-y-auto rounded-md border border-stone-200 p-3 text-xs dark:border-stone-800">
      {rows.map((e, i) => {
        const style = STYLE[e.type] ?? STYLE.log!;
        return (
          <li key={`${e.at}-${i}`} className="flex gap-2 py-0.5">
            <span className={`font-mono ${style.className}`} aria-hidden>
              {style.mark}
            </span>
            <span className={style.className}>{describe(e)}</span>
          </li>
        );
      })}
      <div ref={endRef} />
    </ol>
  );
}
