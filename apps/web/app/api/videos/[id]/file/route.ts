import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { Readable } from "node:stream";
import { jobDir } from "@tasawwur/core";

/**
 * Serve a render's output.
 *
 * Range requests are honoured because without them a browser cannot seek: it
 * downloads the whole file before the scrubber does anything.
 */
function resolveWithin(dir: string, name: string): string | null {
  // Only ever these three, named explicitly. A path from the client is never
  // joined onto a directory here.
  const allowed: Record<string, string> = {
    video: "final.mp4",
    audio: "audio.wav",
    subtitles: "subtitle.srt",
  };
  const file = allowed[name];
  if (!file) return null;
  const path = normalize(join(dir, file));
  return path.startsWith(normalize(dir)) ? path : null;
}

const TYPES: Record<string, string> = {
  video: "video/mp4",
  audio: "audio/wav",
  subtitles: "text/plain; charset=utf-8",
};

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const which = new URL(req.url).searchParams.get("as") ?? "video";

  const path = resolveWithin(jobDir(id), which);
  if (!path) return Response.json({ error: "No such file." }, { status: 400 });

  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return Response.json({ error: "That render has no output yet." }, { status: 404 });
  }

  const type = TYPES[which] ?? "application/octet-stream";
  const download = new URL(req.url).searchParams.has("download");
  const disposition = download
    ? `attachment; filename="tasawwur-${id.slice(0, 8)}.mp4"`
    : "inline";

  const range = req.headers.get("range");
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : size - 1;

    if (start >= size || end >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }

    return new Response(
      Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream,
      {
        status: 206,
        headers: {
          "Content-Type": type,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Disposition": disposition,
        },
      },
    );
  }

  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Content-Disposition": disposition,
    },
  });
}
