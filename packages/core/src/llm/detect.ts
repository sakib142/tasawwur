import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";

const run = promisify(execFile);

/**
 * Finding and vetting the local Claude CLI.
 *
 * Script writing runs through the CLI rather than an HTTP API because the CLI
 * is already signed in to a subscription. There is no key to issue and nothing
 * is metered — which is the whole point, and worth showing plainly in the
 * interface so it is obvious no pay-per-token path is involved.
 */

/** Flags the CLI must support for an isolated, non-interactive run. */
const REQUIRED_FLAGS = ["--output-format", "--system-prompt", "--tools", "--safe-mode"] as const;

/** Where the CLI usually lives, in the order worth trying. */
const LIKELY_PATHS = [
  "claude", // on PATH
  `${process.env.HOME}/homebrew/bin/claude`,
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  `${process.env.HOME}/.local/bin/claude`,
];

export interface CliStatus {
  found: boolean;
  /** Absolute path, or the bare name when resolved from PATH. */
  path: string | null;
  version: string | null;
  /** Whether every flag needed for an isolated run is present. */
  flagsSupported: boolean;
  missingFlags: string[];
  /** Ready to use right now. */
  usable: boolean;
  /** What to tell the user, in plain words. */
  message: string;
}

async function probe(candidate: string): Promise<{ path: string; version: string } | null> {
  try {
    if (candidate.includes("/")) {
      await access(candidate, constants.X_OK);
    }
    const { stdout } = await run(candidate, ["--version"], { timeout: 10_000 });
    const version = stdout.trim().split(/\s+/)[0] ?? stdout.trim();
    return { path: candidate, version };
  } catch {
    return null;
  }
}

async function checkFlags(path: string): Promise<string[]> {
  try {
    const { stdout } = await run(path, ["--help"], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    return REQUIRED_FLAGS.filter((flag) => !stdout.includes(flag));
  } catch {
    return [...REQUIRED_FLAGS];
  }
}

/**
 * Locate the CLI and report whether it can actually be used.
 *
 * A configured path is tried first; otherwise the usual locations are probed.
 * Reports *why* it is unusable rather than only that it is.
 */
export async function detectClaudeCli(configuredPath?: string): Promise<CliStatus> {
  const candidates = configuredPath?.trim()
    ? [configuredPath.trim()]
    : LIKELY_PATHS;

  let found: { path: string; version: string } | null = null;
  for (const candidate of candidates) {
    found = await probe(candidate);
    if (found) break;
  }

  if (!found) {
    return {
      found: false,
      path: null,
      version: null,
      flagsSupported: false,
      missingFlags: [...REQUIRED_FLAGS],
      usable: false,
      message: configuredPath?.trim()
        ? `No runnable Claude CLI at ${configuredPath.trim()}.`
        : "Claude CLI not found. Install it, or set the path below.",
    };
  }

  const missingFlags = await checkFlags(found.path);
  const flagsSupported = missingFlags.length === 0;

  return {
    found: true,
    path: found.path,
    version: found.version,
    flagsSupported,
    missingFlags,
    usable: flagsSupported,
    message: flagsSupported
      ? `Claude CLI ${found.version} — signed in, nothing metered.`
      : `Claude CLI ${found.version} is missing ${missingFlags.join(", ")}. Upgrade it.`,
  };
}

/**
 * Environment variables that must not reach the CLI.
 *
 * Each of these redirects it to an API key or a third-party vendor, which turns
 * a subscription call into a billed one. Removing them is the difference
 * between free and charged, so it is not optional.
 */
export function isBillingRedirect(name: string): boolean {
  if (name === "CLAUDE_CODE_OAUTH_TOKEN") return false; // the subscription itself
  if (name === "ANTHROPIC_CONFIG_DIR" || name === "CLAUDE_CONFIG_DIR") return false; // where creds live
  return (
    name.startsWith("ANTHROPIC_") ||
    name.startsWith("CLAUDE_CODE_USE_") ||
    name === "AWS_BEARER_TOKEN_BEDROCK"
  );
}

/**
 * A copy of the environment with every billing redirect removed.
 *
 * Typed as a plain record rather than NodeJS.ProcessEnv: some setups declare
 * required keys on that type, and this deliberately builds a subset.
 */
export function safeEnv(base: Record<string, string | undefined> = process.env): {
  env: Record<string, string | undefined>;
  removed: string[];
} {
  const env: Record<string, string | undefined> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(base)) {
    if (isBillingRedirect(key)) removed.push(key);
    else env[key] = value;
  }
  return { env, removed };
}
