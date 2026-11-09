import { NextResponse } from "next/server";
import { fontsDir, listFonts } from "@tasawwur/core";

/** Fonts ship with the project, so this needs nothing external. */
export async function GET() {
  try {
    return NextResponse.json({ fonts: await listFonts(fontsDir()) });
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
