import { NextResponse } from "next/server";
import { LlmError, generateScript, readSettings } from "@tasawwur/core";
import { z } from "zod";

const Body = z.object({
  subject: z.string().min(1).max(500),
  targetSeconds: z.number().int().min(10).max(180).default(40),
  language: z.string().max(60).optional(),
  guidance: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Give a subject to write about." }, { status: 400 });
  }

  const settings = await readSettings();
  if (settings.llmProvider !== "claude-cli") {
    return NextResponse.json(
      { error: `Script writing via ${settings.llmProvider} is not implemented yet.` },
      { status: 501 },
    );
  }

  try {
    const result = await generateScript({
      ...parsed.data,
      cliPath: settings.claudeCliPath,
      signal: AbortSignal.timeout(150_000),
    });
    return NextResponse.json({
      script: result.value,
      words: result.value.trim().split(/\s+/).length,
      durationMs: result.durationMs,
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof LlmError ? cause.message : "Could not write the script." },
      { status: 502 },
    );
  }
}
