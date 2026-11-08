import { streamTask, toSseFrame } from "@tasawwur/core";
import { TasawwurClient } from "@tasawwur/api-client";

/**
 * Server-sent events for one task.
 *
 * The browser opens this once instead of polling. Polling still happens, but
 * server-side where it is cheap, and what reaches the client are meaningful
 * events — "entered the footage stage" rather than "progress is still 40".
 *
 * No route segment config needed: with Cache Components, handlers are dynamic
 * by default, and "force-dynamic" is rejected outright.
 */
const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:8080/api/v1";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const client = new TasawwurClient({ baseUrl: ENGINE_URL });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Heartbeat so proxies do not close an idle connection during the long
      // silent stretches of an encode.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      try {
        for await (const event of streamTask(() => client.getTask(id), {
          pollMs: 1000,
          signal: req.signal,
        })) {
          controller.enqueue(encoder.encode(toSseFrame(event)));
        }
      } catch (cause) {
        controller.enqueue(
          encoder.encode(
            toSseFrame({
              type: "error",
              message: cause instanceof Error ? cause.message : "Stream failed.",
              at: Date.now(),
            }),
          ),
        );
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed by the client disconnecting
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and similar buffer proxied responses by default, which would
      // hold every event until the render finished.
      "X-Accel-Buffering": "no",
    },
  });
}
