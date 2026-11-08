import { NextResponse } from "next/server";
import { listVoices } from "@tasawwur/core";

/**
 * Native implementation — this route never touches the Python engine. The Edge
 * TTS catalogue is a plain HTTPS endpoint, so it is fetched directly.
 */
export async function GET(req: Request) {
  const locales = new URL(req.url).searchParams.get("locales");

  try {
    const voices = await listVoices({
      locales: locales ? locales.split(",").map((l) => l.trim()).filter(Boolean) : ["en"],
      signal: AbortSignal.timeout(15_000),
    });
    return NextResponse.json(
      { voices },
      // The catalogue changes rarely; cache at the edge for an hour.
      { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } },
    );
  } catch (cause) {
    return NextResponse.json(
      {
        error: "Could not load the voice catalogue.",
        detail: cause instanceof Error ? cause.message : "unknown error",
      },
      { status: 502 },
    );
  }
}
