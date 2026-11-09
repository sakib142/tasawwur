import { NextResponse } from "next/server";
import { GOOD_GRADES, KOKORO_VOICES, kokoroProvider } from "@tasawwur/core";

/**
 * The voices that will actually be used.
 *
 * Listed from the local model's own metadata. Previously this served a
 * different provider's catalogue, which meant the picker offered names the
 * renderer could not use and silently substituted its default.
 */
export async function GET() {
  const installed = await kokoroProvider.available();

  return NextResponse.json(
    {
      installed,
      voices: KOKORO_VOICES.map((v) => ({
        ...v,
        // Quality varies a great deal between voices; say so rather than
        // presenting a D-grade voice as equal to an A.
        recommended: GOOD_GRADES.has(v.grade),
      })),
      /** Narration needs the model; without it nothing can be spoken. */
      message: installed
        ? null
        : "Local speech is not installed. Run: npx pnpm@12 install",
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
