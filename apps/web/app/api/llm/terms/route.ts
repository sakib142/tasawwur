import { NextResponse } from "next/server";
import { LlmError, generateTerms, readSettings } from "@tasawwur/core";
import { z } from "zod";

const Body = z.object({
  script: z.string().min(1).max(20_000),
  count: z.number().int().min(2).max(16).default(6),
  /** Keep terms in narrative order so footage follows the words. */
  inScriptOrder: z.boolean().default(false),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Write or generate a script first." }, { status: 400 });
  }

  const settings = await readSettings();
  if (settings.llmProvider !== "claude-cli") {
    return NextResponse.json(
      { error: `Keyword writing via ${settings.llmProvider} is not implemented yet.` },
      { status: 501 },
    );
  }

  try {
    const result = await generateTerms({
      ...parsed.data,
      cliPath: settings.claudeCliPath,
      signal: AbortSignal.timeout(120_000),
    });
    return NextResponse.json({ terms: result.value, durationMs: result.durationMs });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof LlmError ? cause.message : "Could not choose keywords." },
      { status: 502 },
    );
  }
}
