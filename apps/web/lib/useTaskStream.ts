"use client";

import { useEffect, useState } from "react";

export interface Job {
  id: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  stage: string;
  detail?: string;
  error?: string;
  video?: string;
  durationSeconds?: number;
}

export interface StreamState {
  job: Job | null;
  log: string[];
  finished: boolean;
  error: string | null;
  /**
   * The render being followed is not there.
   *
   * A remembered id outlives the thing it names — the server restarts, or the
   * render is deleted — and without this the page would wait on a stream that
   * is never going to say anything.
   */
  missing: boolean;
}

/**
 * Follow a render.
 *
 * Progress is pushed by the job itself rather than polled — the work runs in
 * the same process that serves this stream, so there is nothing to poll.
 */
export function useTaskStream(jobId: string | null): StreamState {
  const [job, setJob] = useState<Job | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setLog([]);
      setMissing(false);
      return;
    }

    setJob(null);
    setLog([]);
    setMissing(false);

    // Whether anything ever arrived, so a closed stream can be told apart
    // from a stream that was never going to deliver.
    let heard = false;

    const source = new EventSource(`/api/videos/${encodeURIComponent(jobId)}/events`);

    const handle = (e: MessageEvent) => {
      try {
        const next = JSON.parse(e.data) as Job;
        heard = true;
        setJob(next);
        // One line per stage, not per update — the stage name repeats on every
        // progress tick and a log of duplicates is unreadable.
        setLog((prev) => {
          const entry = next.detail ? `${next.stage} — ${next.detail}` : next.stage;
          return prev[prev.length - 1] === entry ? prev : [...prev, entry];
        });
      } catch {
        // Ignore a malformed frame rather than tearing the stream down.
      }
    };

    for (const type of ["progress", "done", "error"]) {
      source.addEventListener(type, handle as EventListener);
    }
    // The server closes the stream when the job ends; EventSource reports that
    // as an error and would otherwise reconnect forever.
    source.onerror = () => {
      source.close();
      if (!heard) setMissing(true);
    };

    return () => source.close();
  }, [jobId]);

  const finished = job?.state === "done" || job?.state === "failed" || job?.state === "cancelled";

  return {
    job,
    log,
    finished: Boolean(finished),
    missing,
    error: job?.state === "failed" || job?.state === "cancelled" ? (job.error ?? "Failed.") : null,
  };
}
