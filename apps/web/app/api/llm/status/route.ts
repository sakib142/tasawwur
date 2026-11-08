import { NextResponse } from "next/server";
import { detectClaudeCli, readSettings } from "@tasawwur/core";

/**
 * Reports which script writer is configured and whether it actually works.
 *
 * Exists so the interface can state plainly what is being used — in particular
 * that it is a signed-in CLI on a subscription, not a metered API key.
 */
export async function GET() {
  const settings = await readSettings();

  if (settings.llmProvider === "ollama") {
    let reachable = false;
    try {
      const res = await fetch(`${settings.ollamaUrl.replace(/\/$/, "")}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      reachable = res.ok;
    } catch {
      reachable = false;
    }
    return NextResponse.json({
      provider: "ollama",
      usable: reachable,
      path: settings.ollamaUrl,
      version: null,
      metered: false,
      message: reachable
        ? `Ollama is running at ${settings.ollamaUrl}.`
        : `Nothing responding at ${settings.ollamaUrl}. Start Ollama, or switch provider.`,
    });
  }

  const cli = await detectClaudeCli(settings.claudeCliPath);
  return NextResponse.json({
    provider: "claude-cli",
    usable: cli.usable,
    path: cli.path,
    version: cli.version,
    // Stated explicitly so it is visible in the interface, not just implied.
    metered: false,
    message: cli.message,
    missingFlags: cli.missingFlags,
  });
}
