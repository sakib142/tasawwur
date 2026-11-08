import { NextResponse } from "next/server";
import { listFonts } from "@tasawwur/core";

/** Reads the engine's font directory — see the note in packages/core/src/fonts.ts. */
export async function GET() {
  try {
    return NextResponse.json({ fonts: await listFonts() });
  } catch (cause) {
    return NextResponse.json(
      {
        error: "Could not list fonts.",
        detail: cause instanceof Error ? cause.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
