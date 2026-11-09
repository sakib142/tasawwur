import { z } from "zod";

/**
 * Turn an arranged storyboard into renderable materials.
 *
 * Each clip is fetched from the provider and written to the material store.
 * The resulting paths, in order, are what the render uses — so the arrangement
 * made in the storyboard is exactly what gets produced.
 *
 * Progress streams back per clip: renditions run to 75MB and a whole board can
 * move several hundred, which is long enough that silence reads as a hang.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { materialsDir, probe } from "@tasawwur/core";

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

          const dir = materialsDir();
          await mkdir(dir, { recursive: true });
          const ext = extname(new URL(clip.url).pathname) || ".mp4";
          const path = join(dir, `${randomUUID()}${ext}`);
          await writeFile(path, Buffer.from(await res.arrayBuffer()));
          // Decode before accepting it: a truncated download would otherwise
          // fail minutes later, mid-render.
          await probe(path);
          stored.push(path);
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
