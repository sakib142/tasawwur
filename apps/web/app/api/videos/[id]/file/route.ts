import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, normalize } from "node:path";
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

/**
 * A file as a web stream that survives the reader walking away.
 *
 * `Readable.toWeb` looks like the obvious way to do this and is a trap: when
 * the response is cancelled the web stream closes, but the Node stream reads
 * on, and its next data event enqueues into a closed controller. That throws
 * ERR_INVALID_STATE from inside the adapter, where there is no catch, so it
 * reaches the top and takes the process with it — reloading the page while a
 * video was loading killed the whole server.
 *
 * Built by hand instead: every enqueue is guarded, and the file handle is
 * destroyed the moment anyone stops listening.
 */
function fileStream(
  path: string,
  range: { start?: number; end?: number },
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const file = createReadStream(path, range);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      file.on("data", (chunk: string | Buffer) => {
        try {
          controller.enqueue(new Uint8Array(Buffer.from(chunk)));
          // Stop reading ahead of a consumer that is not keeping up, rather
          // than pulling the whole file into memory behind it.
          if ((controller.desiredSize ?? 1) <= 0) file.pause();
        } catch {
          file.destroy();
        }
      });
      file.on("end", () => {
        try {
          controller.close();
        } catch {
          // Already closed by a cancel.
        }
      });
      file.on("error", (cause) => {
        try {
          controller.error(cause);
        } catch {
          // Nobody left to tell.
        }
      });

      if (signal.aborted) file.destroy();
      else signal.addEventListener("abort", () => file.destroy(), { once: true });
    },
    pull() {
      file.resume();
    },
    cancel() {
      file.destroy();
    },
  });
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
      fileStream(path, { start, end }, req.signal),
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

  return new Response(fileStream(path, {}, req.signal), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Content-Disposition": disposition,
    },
  });
}
