import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { materialsDir, probe } from "@tasawwur/core";

/**
 * Footage supplied by the user.
 *
 * Stored under a generated name rather than the uploaded one: two files called
 * clip.mp4 must not collide, and a client-supplied filename is not something to
 * build a path from.
 */
const MAX_BYTES = 512 * 1024 * 1024;
const FOOTAGE = /\.(mp4|mov|m4v|webm|mkv|avi|jpe?g|png|bmp)$/i;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files were attached." }, { status: 400 });
  }

  const dir = materialsDir();
  await mkdir(dir, { recursive: true });

  const stored: string[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      rejected.push({ name: file.name, reason: "larger than 512MB" });
      continue;
    }
    if (!FOOTAGE.test(file.name)) {
      rejected.push({
        name: file.name,
        reason: "not a video or image this can use",
      });
      continue;
    }

    const path = join(dir, `${randomUUID()}${extname(file.name).toLowerCase()}`);
    try {
      await writeFile(path, Buffer.from(await file.arrayBuffer()));
      // Decode it rather than trust the extension: a renamed file would
      // otherwise fail minutes later, mid-render.
      await probe(path);
      stored.push(path);
    } catch {
      rejected.push({ name: file.name, reason: "could not be decoded as video or an image" });
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
