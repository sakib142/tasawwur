import { z } from "zod";

/**
 * Turn an arranged storyboard into renderable materials.
 *
 * Each clip is fetched from the provider and handed to the renderer's material
 * store, which returns a stable name. Those names, in order, become
 * `video_materials` — and because the render then runs as a local source in
 * sequential mode, the arrangement is used exactly as given.
 *
 * Progress streams back per clip: renditions run to 75MB and a whole board can
 * move several hundred, which is long enough that silence reads as a hang.
 */
const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:8080/api/v1";

const Body = z.object({
  clips: z
    .array(z.object({ url: z.string().url(), label: z.string().default("") }))
    .min(1)
    .max(40),
});

function frame(event: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Nothing to commit." }, { status: 400 });
  }

  const { clips } = parsed.data;

  const stream = new ReadableStream({
    async start(controller) {
      const stored: string[] = [];

      try {
        for (const [index, clip] of clips.entries()) {
          controller.enqueue(
            frame({ type: "progress", index, total: clips.length, label: clip.label }),
          );

          const res = await fetch(clip.url, { signal: req.signal });
          if (!res.ok) {
            throw new Error(`Could not download “${clip.label}” (HTTP ${res.status}).`);
          }

          // The store wants a filename it can take an extension from.
          const name = new URL(clip.url).pathname.split("/").pop() ?? `clip-${index}.mp4`;
          const body = new FormData();
          body.append("file", await res.blob(), name);

          const upload = await fetch(`${ENGINE_URL}/video_materials`, {
            method: "POST",
            body,
            signal: req.signal,
          });
          const payload = await upload.json().catch(() => null);
          const file = payload?.data?.file;
          if (!upload.ok || typeof file !== "string") {
            throw new Error(
              payload?.message ?? `The renderer rejected “${clip.label}”.`,
            );
          }
          stored.push(file);
        }

        controller.enqueue(frame({ type: "done", materials: stored }));
      } catch (cause) {
        controller.enqueue(
          frame({
            type: "error",
            message: cause instanceof Error ? cause.message : "Commit failed.",
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
