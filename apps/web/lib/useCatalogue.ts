"use client";

import { useEffect, useState } from "react";

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
  gender: "Male" | "Female";
  /** The model authors' rating. Quality varies a lot between voices. */
  grade: string;
  recommended: boolean;
}

export interface TrackOption {
  id: string;
  label: string;
}

export interface FontOption {
  id: string;
  label: string;
  recommended: boolean;
}

interface Catalogue {
  voices: VoiceOption[];
  fonts: FontOption[];
  tracks: TrackOption[];
  /** Where to put music files, shown when none are bundled. */
  musicMessage: string | null;
  loading: boolean;
  /** Non-fatal: the form still works on built-in defaults. */
  error: string | null;
  /** False when the speech model is not installed, so nothing can be spoken. */
  speechInstalled: boolean;
  speechMessage: string | null;
}

/**
 * Loads the voice and font catalogues from our own API routes.
 *
 * Failures are deliberately soft. A missing catalogue should degrade the
 * picker, never block someone from generating a video.
 */
export function useCatalogue(): Catalogue {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [fonts, setFonts] = useState<FontOption[]>([]);
  const [tracks, setTracks] = useState<TrackOption[]>([]);
  const [musicMessage, setMusicMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [speechInstalled, setSpeechInstalled] = useState(true);
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      const [v, f, m] = await Promise.allSettled([
        fetch("/api/voices", { signal: ac.signal }),
        fetch("/api/fonts", { signal: ac.signal }),
        fetch("/api/music", { signal: ac.signal }),
      ]);

      const problems: string[] = [];

      if (v.status === "fulfilled" && v.value.ok) {
        const body = await v.value.json();
        setVoices(body.voices ?? []);
        setSpeechInstalled(body.installed !== false);
        setSpeechMessage(body.message ?? null);
      } else {
        problems.push("voices");
      }

      if (f.status === "fulfilled" && f.value.ok) {
        setFonts((await f.value.json()).fonts ?? []);
      } else {
        problems.push("fonts");
      }

      // Music is optional, so a failure here never counts as a problem — it
      // just leaves the picker offering silence.
      if (m.status === "fulfilled" && m.value.ok) {
        const body = await m.value.json();
        setTracks(body.tracks ?? []);
        setMusicMessage(body.message ?? null);
      }

      if (!ac.signal.aborted) {
        setError(problems.length ? `Could not load ${problems.join(" or ")}.` : null);
        setLoading(false);
      }
    })();

    return () => ac.abort();
  }, []);

  return { voices, fonts, tracks, musicMessage, loading, error, speechInstalled, speechMessage };
}
