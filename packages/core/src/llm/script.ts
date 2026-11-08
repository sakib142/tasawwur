import { runClaude, LlmError } from "./claude-cli.ts";
import {
  SCRIPT_SYSTEM,
  TERMS_SYSTEM,
  buildScriptPrompt,
  buildTermsPrompt,
  extractStringArray,
  type ScriptRequest,
  type TermsRequest,
} from "./prompts.ts";

export interface Generated<T> {
  value: T;
  reportedCostUsd: number | null;
  durationMs: number;
}

/** Write narration for a subject. */
export async function generateScript(
  request: ScriptRequest & { cliPath?: string; signal?: AbortSignal },
): Promise<Generated<string>> {
  const { cliPath, signal, ...rest } = request;
  if (!rest.subject.trim()) throw new LlmError("Give it a subject to write about.");

  const run = await runClaude(buildScriptPrompt(rest), {
    systemPrompt: SCRIPT_SYSTEM,
    cliPath,
    signal,
  });

  // Models occasionally wrap the whole piece in quotes despite being asked not
  // to, and a synthesiser reads those aloud.
  const text = run.text.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!text) throw new LlmError("The model returned an empty script.");

  return { value: text, reportedCostUsd: run.reportedCostUsd, durationMs: run.durationMs };
}

/** Choose stock footage search terms for a script. */
export async function generateTerms(
  request: TermsRequest & { cliPath?: string; signal?: AbortSignal },
): Promise<Generated<string[]>> {
  const { cliPath, signal, ...rest } = request;
  if (!rest.script.trim()) throw new LlmError("Write or generate a script first.");

  const run = await runClaude(buildTermsPrompt(rest), {
    systemPrompt: TERMS_SYSTEM,
    cliPath,
    signal,
  });

  const terms = extractStringArray(run.text);
  if (!terms) {
    throw new LlmError("The model did not return a usable list of search terms.");
  }

  return { value: terms, reportedCostUsd: run.reportedCostUsd, durationMs: run.durationMs };
}
