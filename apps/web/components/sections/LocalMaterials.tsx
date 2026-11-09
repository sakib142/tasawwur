"use client";

import { useRef, useState } from "react";
import type { Params } from "@/lib/useVideoParams";

/**
 * Footage you supply yourself.
 *
 * Uploading rather than pointing at a path is not a limitation: a browser never
 * learns the real path of a chosen file, and a path typed by hand would be both
 * useless to the renderer and a traversal risk. The renderer validates the
 * bytes and returns a name, which is what the task then refers to.
 */
export function LocalMaterials({
  params,
  set,
}: {
  params: Params;
  set: <K extends keyof Params>(k: K, v: Params[K]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const materials = params.video_materials ?? [];

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);

    const body = new FormData();
    for (const file of Array.from(files)) body.append("files", file);

    try {
      const res = await fetch("/api/materials", { method: "POST", body });
      const payload = await res.json();
      if (!res.ok) {
        setError(
          payload.rejected?.length
            ? payload.rejected
                .map((r: { name: string; reason: string }) => `${r.name}: ${r.reason}`)
                .join("; ")
            : (payload.error ?? "Upload failed."),
        );
        return;
      }
      // Keep what was already there — uploading again should add, not replace.
      set("video_materials", [
        ...materials,
        ...(payload.stored as string[]).map((url) => ({
          provider: "local",
          url,
          duration: 0,
        })),
      ]);
      if (payload.rejected?.length) {
        setError(
          `Skipped ${payload.rejected.length}: ` +
            payload.rejected
              .map((r: { name: string; reason: string }) => `${r.name} (${r.reason})`)
              .join(", "),
        );
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        multiple
        accept="video/*,image/*"
        onChange={(e) => upload(e.target.files)}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="rounded-md border border-dashed border-stone-300 px-3 py-3 text-sm transition-colors hover:border-stone-400 disabled:opacity-50 dark:border-stone-700 dark:hover:border-stone-500"
      >
        {busy ? "Uploading…" : "Choose videos or images"}
      </button>

      {materials.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {materials.map((m, i) => (
            <li key={`${m.url}-${i}`} className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-stone-500">{m.url}</span>
              <button
                type="button"
                onClick={() =>
                  set(
                    "video_materials",
                    materials.filter((_, at) => at !== i),
                  )
                }
                className="shrink-0 text-stone-400 underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-amber-700 dark:text-amber-500">{error}</p>}

      <p className="text-xs leading-relaxed text-stone-500">
        {materials.length === 0
          ? "Stills are given a slow zoom so they do not sit frozen on screen."
          : `${materials.length} file${materials.length === 1 ? "" : "s"} ready. Search terms are ignored for your own footage.`}
      </p>
    </div>
  );
}
