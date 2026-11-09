import { getJob, subscribe, type JobEvent } from "@tasawwur/core";

/**
 * Live progress for one render.
 *
 * Pushed from the job itself rather than polled: the work happens in this
 * process, so there is nothing to poll.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const encoder = new TextEncoder();

  const current = await getJob(id);
  if (!current) {
    return Response.json({ error: "No such render." }, { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: JobEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.job)}\n\n`),
          );
        } catch {
          // Client went away mid-write.
        }
      };

      // Send the state as it stands, so a client joining late is not blank.
      send({ type: current.state === "done" ? "done" : "progress", job: current });

      const finished = current.state === "done" || current.state === "failed";
      if (finished) {
        controller.close();
        return;
      }

      const unsubscribe = subscribe(id, (event) => {
        send(event);
        if (event.type === "done" || event.type === "error") {
          unsubscribe();
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      });

      // Proxies drop idle connections, and an encode is silent for minutes.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
