"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface TaskEvent {
  type: "stage" | "progress" | "log" | "done" | "error";
  at: number;
  stage?: string;
  label?: string;
  progress?: number;
  level?: "info" | "warn";
  message?: string;
  videos?: string[];
  elapsedMs?: number;
}

export interface StreamState {
  events: TaskEvent[];
  progress: number;
  stageLabel: string;
  /** Seconds spent in the current stage — the long ones are worth showing. */
  stageSeconds: number;
  videos: string[] | null;
  error: string | null;
  finished: boolean;
}

const INITIAL: StreamState = {
  events: [],
  progress: 0,
  stageLabel: "Starting",
  stageSeconds: 0,
  videos: null,
  error: null,
  finished: false,
};

/**
 * Subscribe to a task's event stream.
 *
 * One EventSource replaces a poll loop. Passing `null` closes any open stream,
 * which is how the caller cancels.
 */
export function useTaskStream(taskId: string | null): StreamState {
  const [state, setState] = useState<StreamState>(INITIAL);
  const stageStarted = useRef<number>(Date.now());

  const push = useCallback((event: TaskEvent) => {
    setState((prev) => {
      const next: StreamState = { ...prev, events: [...prev.events, event] };

      switch (event.type) {
        case "stage":
          stageStarted.current = event.at;
          next.stageLabel = event.label ?? prev.stageLabel;
          next.progress = event.progress ?? prev.progress;
          break;
        case "progress":
          next.progress = event.progress ?? prev.progress;
          break;
        case "done":
          next.videos = event.videos ?? [];
          next.progress = 100;
          next.stageLabel = "Done";
          next.finished = true;
          break;
        case "error":
          next.error = event.message ?? "Something went wrong.";
          next.finished = true;
          break;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!taskId) {
      setState(INITIAL);
      return;
    }

    setState(INITIAL);
    stageStarted.current = Date.now();

    const source = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/events`);
    const handle = (e: MessageEvent) => {
      try {
        push(JSON.parse(e.data) as TaskEvent);
      } catch {
        // Ignore a malformed frame rather than tearing down the stream.
      }
    };

    for (const type of ["stage", "progress", "log", "done", "error"]) {
      source.addEventListener(type, handle as EventListener);
    }
    source.onerror = () => {
      // The server closes the stream once a task is terminal; EventSource
      // reports that as an error and would otherwise reconnect forever.
      source.close();
    };

    return () => source.close();
  }, [taskId, push]);

  // Tick the in-stage timer without re-rendering the whole event list.
  const [, force] = useState(0);
  useEffect(() => {
    if (!taskId || state.finished) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [taskId, state.finished]);

  return {
    ...state,
    stageSeconds: state.finished ? 0 : Math.floor((Date.now() - stageStarted.current) / 1000),
  };
}
