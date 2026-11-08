import { NextResponse } from "next/server";
import { probeTerms, readSettings } from "@tasawwur/core";
import { VideoAspect } from "@tasawwur/schema";
import { z } from "zod";

/** Scores search terms before a render is attempted. Native — no engine call. */
const Body = z.object({
  terms: z.array(z.string()).min(1).max(20),
  aspect: VideoAspect.default("9:16"),
});

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Give between 1 and 20 search terms." },
      { status: 400 },
    );
  }

  const settings = await readSettings();
  if (!settings.pixabayApiKey) {
    return NextResponse.json(
      {
        error: "No Pixabay API key configured.",
        detail: "Add a free key in Settings to check search terms before rendering.",
      },
      { status: 400 },
    );
  }

  try {
    const summary = await probeTerms(parsed.data.terms, {
      apiKey: settings.pixabayApiKey,
      aspect: parsed.data.aspect,
      signal: AbortSignal.timeout(30_000),
    });
    // Thumbnails and page links are safe to expose; the key never is.
    return NextResponse.json(summary);
  } catch (cause) {
    return NextResponse.json(
      {
        error: "Could not check those terms.",
        detail: cause instanceof Error ? cause.message : "unknown error",
      },
      { status: 502 },
    );
  }
}
