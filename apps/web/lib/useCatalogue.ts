"use client";

import { useEffect, useState } from "react";

export interface VoiceOption {
  id: string;
  label: string;
  localeName: string;
  gender: "Male" | "Female";
  multilingual: boolean;
}

export interface FontOption {
  id: string;
  label: string;
  recommended: boolean;
}

interface Catalogue {
  voices: VoiceOption[];
  fonts: FontOption[];
  loading: boolean;
  /** Non-fatal: the form still works on built-in defaults. */
  error: string | null;
}

/**
 * Loads the voice and font catalogues from our own API routes.
 *
 * Failures are deliberately soft. A missing catalogue should degrade the
 * picker, never block someone from generating a video.
 */
export function useCatalogue(locales = "en"): Catalogue {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [fonts, setFonts] = useState<FontOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      const [v, f] = await Promise.allSettled([
        fetch(`/api/voices?locales=${encodeURIComponent(locales)}`, { signal: ac.signal }),
        fetch("/api/fonts", { signal: ac.signal }),
      ]);

      const problems: string[] = [];

      if (v.status === "fulfilled" && v.value.ok) {
        setVoices((await v.value.json()).voices ?? []);
      } else {
        problems.push("voices");
      }

      if (f.status === "fulfilled" && f.value.ok) {
        setFonts((await f.value.json()).fonts ?? []);
      } else {
        problems.push("fonts");
      }

      if (!ac.signal.aborted) {
        setError(problems.length ? `Could not load ${problems.join(" or ")}.` : null);
        setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [locales]);

  return { voices, fonts, loading, error };
}
