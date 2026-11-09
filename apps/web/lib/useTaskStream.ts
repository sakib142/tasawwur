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

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setLog([]);
      return;
    }

    setJob(null);
    setLog([]);

    const source = new EventSource(`/api/videos/${encodeURIComponent(jobId)}/events`);

    const handle = (e: MessageEvent) => {
      try {
        const next = JSON.parse(e.data) as Job;
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
    source.onerror = () => source.close();

    return () => source.close();
  }, [jobId]);

  const finished = job?.state === "done" || job?.state === "failed" || job?.state === "cancelled";

  return {
    job,
    log,
    finished: Boolean(finished),
    error: job?.state === "failed" || job?.state === "cancelled" ? (job.error ?? "Failed.") : null,
  };
}
