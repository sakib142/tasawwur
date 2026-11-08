import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectClaudeCli, safeEnv } from "./detect.ts";

/**
 * Runs prompts through the locally signed-in Claude CLI.
 *
 * The CLI is used rather than an HTTP API because it is already authenticated
 * against a subscription: there is no key to issue and nothing is metered.
 */

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export interface RunOptions {
  systemPrompt: string;
  /** Blank means search the usual locations. */
  cliPath?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RunResult {
  text: string;
  /** What the CLI reports for this call. Covered by the subscription. */
  reportedCostUsd: number | null;
  durationMs: number;
}

/** Shape of `--output-format json`. */
interface CliResponse {
  is_error?: boolean;
  result?: string;
  subtype?: string;
  total_cost_usd?: number;
  duration_ms?: number;
}

export async function runClaude(prompt: string, opts: RunOptions): Promise<RunResult> {
  const { systemPrompt, cliPath, timeoutMs = 120_000, signal } = opts;

  const cli = await detectClaudeCli(cliPath);
  if (!cli.usable || !cli.path) throw new LlmError(cli.message);

  // Strips the variables that would redirect the CLI to an API key or a
  // third-party vendor — the difference between a subscription call and a
  // billed one.
  const { env } = safeEnv();

  // Run somewhere empty: the CLI reads CLAUDE.md, settings and MCP config from
  // its working directory, and none of that belongs in someone's video script.
  const workDir = await mkdtemp(join(tmpdir(), "tasawwur-llm-"));

  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      const child = execFile(
        cli.path!,
        [
          "--print",
          "--output-format", "json",
          "--system-prompt", systemPrompt,
          "--tools", "",      // no file access, no web, no shell
          "--safe-mode",      // ignore user-level customisation
        ],
        {
          timeout: timeoutMs,
          cwd: workDir,
          // safeEnv deliberately returns a subset of the environment, which
          // does not satisfy ProcessEnv's required keys.
          env: env as NodeJS.ProcessEnv,
          maxBuffer: 8 * 1024 * 1024,
        },
        (error, stdout) => {
          // A refusal or an exhausted quota still returns JSON on stdout with a
          // non-zero exit, and the JSON says more than the exit code — so parse
          // it first and only treat this as fatal if there is nothing to read.
          if (error && !stdout) {
            reject(
              new LlmError(
                error.message.includes("timed out") || (error as { killed?: boolean }).killed
                  ? `The model did not respond within ${Math.round(timeoutMs / 1000)}s.`
                  : `Could not run the Claude CLI: ${error.message}`,
              ),
            );
            return;
          }
          resolve({ stdout });
        },
      );

      signal?.addEventListener("abort", () => child.kill(), { once: true });
      child.stdin?.end(prompt);
    });

    let payload: CliResponse;
    try {
      payload = JSON.parse(stdout);
    } catch {
      throw new LlmError("The Claude CLI returned something that was not JSON.");
    }

    if (payload.is_error || !payload.result?.trim()) {
      const reason = payload.result?.trim() || payload.subtype || "no reason given";
      throw new LlmError(
        /login|auth/i.test(reason)
          ? "The Claude CLI is not signed in. Run `claude` once in a terminal to log in."
          : `The model declined: ${reason}`,
      );
    }

    return {
      text: payload.result.trim(),
      reportedCostUsd: payload.total_cost_usd ?? null,
      durationMs: payload.duration_ms ?? 0,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
