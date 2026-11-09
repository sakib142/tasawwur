"use client";

import { useEffect, useRef } from "react";

/** A running account of what the render has done, newest last. */
export function ActivityLog({ entries }: { entries: string[] }) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <ol className="max-h-44 overflow-y-auto rounded-md border border-stone-200 p-3 text-xs dark:border-stone-800">
      {entries.map((entry, i) => (
        <li key={`${entry}-${i}`} className="flex gap-2 py-0.5 text-stone-600 dark:text-stone-300">
          <span aria-hidden className="font-mono text-stone-400">
            {i === entries.length - 1 ? "›" : "·"}
          </span>
          {entry}
        </li>
      ))}
      <div ref={end} />
    </ol>
  );
}
