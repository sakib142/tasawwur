import { NextResponse } from "next/server";
import { buildStoryboard, estimateNarrationSeconds, readSettings } from "@tasawwur/core";
import { VideoAspect, VideoPace } from "@tasawwur/schema";
import { z } from "zod";

/**
 * Build a storyboard from the current search terms.
 *
 * Searches only — no clip is downloaded here. Thumbnails arrive with the search
 * response, so a whole arrangement can be shown and rearranged for free.
 */
const Body = z.object({
  terms: z.array(z.string()).min(1).max(20),
  script: z.string().default(""),
  clipDuration: z.number().int().min(1).max(30).default(5),
  pace: VideoPace.default("even"),
  aspect: VideoAspect.default("9:16"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Add at least one search term before previewing clips." },
      { status: 400 },
    );
  }

  const settings = await readSettings();
  if (!settings.pixabayApiKey) {
    return NextResponse.json(
      {
        error: "No Pixabay API key configured.",
        detail: "Add a free key in Settings to preview clips before rendering.",
      },
      { status: 400 },
    );
  }

  try {
    const board = await buildStoryboard({
      apiKey: settings.pixabayApiKey,
      terms: parsed.data.terms,
      narrationSeconds: estimateNarrationSeconds(parsed.data.script),
      script: parsed.data.script,
      pace: parsed.data.pace,
      clipDuration: parsed.data.clipDuration,
      aspect: parsed.data.aspect,
      signal: AbortSignal.timeout(45_000),
    });
    return NextResponse.json(board);
  } catch (cause) {
    return NextResponse.json(
      {
        error: "Could not build a storyboard.",
        detail: cause instanceof Error ? cause.message : "unknown error",
      },
      { status: 502 },
    );
  }
}
