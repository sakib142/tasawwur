import { NextResponse } from "next/server";
import { listMusic, musicDir } from "@tasawwur/core";

/**
 * Background music beds, listed from the bundled directory.
 *
 * An empty list is a normal answer, not a failure — music is optional, and
 * anyone can drop their own files in. The picker says so rather than looking
 * broken.
 */
export async function GET() {
  const tracks = await listMusic();
  return NextResponse.json(
    {
      tracks,
      directory: musicDir(),
      message: tracks.length
        ? null
        : "No music yet. Run `pnpm music` to fetch the bundled CC0 beds, or drop your own audio files into the music directory.",
    },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
