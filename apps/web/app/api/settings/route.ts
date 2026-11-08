import { NextResponse } from "next/server";
import { Settings, readSettings, redact, writeSettings } from "@tasawwur/core";

/** Settings owned by this app — never the engine's config.toml. */
export async function GET() {
  return NextResponse.json(redact(await readSettings()));
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  // Accept a partial update, but validate every field that is present.
  const parsed = Settings.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Some settings were not valid.",
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          problem: i.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(redact(await writeSettings(parsed.data)));
  } catch (cause) {
    return NextResponse.json(
      {
        error: "Could not save settings.",
        detail: cause instanceof Error ? cause.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
