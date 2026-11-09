"use client";

import { useCallback, useState } from "react";
import { VideoParams, type VideoParamsInput } from "@tasawwur/schema";
import { PRESETS } from "./presets";

/**
 * The full parameter set for one video.
 *
 * Held as a single object rather than forty useState calls: the sections each
 * own a slice of it, and a preset is just a bulk update. Defaults come from the
 * shared schema, so the form starts exactly where the renderer would have
 * started on its own.
 */
export type Params = VideoParams;

const BASE: Params = VideoParams.parse({});

export function useVideoParams(initialPresetId = PRESETS[0]!.id) {
  const [presetId, setPresetId] = useState(initialPresetId);
  const [params, setParams] = useState<Params>(() =>
    VideoParams.parse({ ...PRESETS.find((p) => p.id === initialPresetId)!.params }),
  );
  /** Fields the user has touched, so a preset change does not undo their work. */
  const [edited, setEdited] = useState<Set<keyof Params>>(new Set());

  const set = useCallback(<K extends keyof Params>(key: K, value: Params[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    setEdited((prev) => new Set(prev).add(key));
  }, []);

  /** Bulk update that does not count as a manual edit — used by presets. */
  const seed = useCallback((patch: VideoParamsInput) => {
    setParams((prev) => VideoParams.parse({ ...prev, ...patch }));
  }, []);

  /**
   * Apply a preset.
   *
   * Anything the user has already changed by hand is left alone — switching
   * style to compare options should not silently discard a chosen font size.
   */
  const applyPreset = useCallback(
    (id: string) => {
      const preset = PRESETS.find((p) => p.id === id);
      if (!preset) return;
      setPresetId(id);
      setParams((prev) => {
        const next: Record<string, unknown> = { ...prev };
        for (const [key, value] of Object.entries(preset.params)) {
          if (!edited.has(key as keyof Params)) next[key] = value;
        }
        return VideoParams.parse(next);
      });
    },
    [edited],
  );

  const reset = useCallback(() => {
    setParams(VideoParams.parse({ ...PRESETS.find((p) => p.id === presetId)!.params }));
    setEdited(new Set());
  }, [presetId]);

  return {
    params,
    set,
    seed,
    presetId,
    applyPreset,
    reset,
    /** True once anything diverges from the chosen preset. */
    isEdited: edited.size > 0,
    defaults: BASE,
  };
}
