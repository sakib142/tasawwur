import { NextResponse } from "next/server";

/**
 * Upload footage to use instead of stock search.
 *
 * Forwards to the renderer's material store, which validates the bytes are
 * really decodable video and returns a stable filename. That filename is what
 * goes into `video_materials`; the browser never sees a real path, and cannot
 * supply one — a filesystem path typed by a client would be both useless and a
 * traversal risk.
 */
const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:8080/api/v1";

/** Generous, but enough to reject an accidental disk image. */
const MAX_BYTES = 512 * 1024 * 1024;

/**
 * Types that are definitely not footage.
 *
 * Deliberately a deny-list rather than an allow-list: browsers and command line
 * clients frequently send `application/octet-stream` for perfectly good video,
 * so requiring `video/*` rejects valid files. The renderer decodes the bytes
 * and is the real authority — this only catches the obvious mistakes early.
 */
const CLEARLY_WRONG = /^(text\/|application\/(pdf|zip|x-tar|json|javascript))/;
const FOOTAGE_EXTENSION = /\.(mp4|mov|m4v|webm|mkv|avi|jpe?g|png|webp|gif|bmp|heic)$/i;

export async function POST(req: Request) {
  let incoming: FormData;
  try {
    incoming = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const files = incoming.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files were attached." }, { status: 400 });
  }

  const stored: string[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      rejected.push({ name: file.name, reason: "larger than 512MB" });
      continue;
    }
    const looksWrong =
      CLEARLY_WRONG.test(file.type) ||
      (!file.type.startsWith("video/") &&
        !file.type.startsWith("image/") &&
        !FOOTAGE_EXTENSION.test(file.name));
    if (looksWrong) {
      rejected.push({
        name: file.name,
        reason: `does not look like video or an image (${file.type || "unknown type"})`,
      });
      continue;
    }

    const body = new FormData();
    body.append("file", file, file.name);

    try {
      const res = await fetch(`${ENGINE_URL}/video_materials`, { method: "POST", body });
      const payload = await res.json().catch(() => null);
      const name = payload?.data?.file;
      if (!res.ok || typeof name !== "string") {
        rejected.push({
          name: file.name,
          reason: payload?.message ?? `rejected by the renderer (HTTP ${res.status})`,
        });
        continue;
      }
      stored.push(name);
    } catch (cause) {
      rejected.push({
        name: file.name,
        reason: cause instanceof Error ? cause.message : "upload failed",
      });
    }
  }

  if (stored.length === 0) {
    return NextResponse.json(
      { error: "None of those files could be used.", rejected },
      { status: 400 },
    );
  }

  return NextResponse.json({ stored, rejected });
}
