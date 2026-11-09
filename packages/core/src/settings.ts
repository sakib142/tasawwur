import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { DEFAULT_VOICE, KOKORO_VOICES } from "./speech/voices.ts";

/**
 * Application settings, owned by this project.
 *
 * Deliberately NOT the engine's config.toml. That file is the engine's own
 * state, it is rewritten wholesale whenever its UI saves, and sharing it would
 * mean two processes racing to clobber each other's values — which is exactly
 * how its TTS configuration ended up pointing at a provider with no API key.
 */
export const Settings = z.object({
  /** Where the generation engine lives. Replaced by the worker in Stage 4. */
  engineUrl: z.string().url().default("http://127.0.0.1:8080/api/v1"),
  /** Locale prefixes offered in the voice picker. */
  voiceLocales: z.array(z.string()).default(["en"]),
  /** An id the local speech model accepts; see KOKORO_VOICES. */
  defaultVoice: z.string().default("af_heart"),
  defaultFont: z.string().default("BeVietnamPro-Bold.ttf"),
  /**
   * Who writes the script when you give only a topic.
   *
   * Both options are free to run. "claude-cli" spawns the locally signed-in
   * Claude CLI, which uses a subscription rather than a metered key; "ollama"
   * runs a model on this machine. There is deliberately no pay-per-token
   * option — staying free to run is a constraint, not a preference.
   */
  llmProvider: z.enum(["claude-cli", "ollama"]).default("claude-cli"),
  /** Blank means search the usual locations. */
  claudeCliPath: z.string().default(""),
  ollamaUrl: z.string().default("http://127.0.0.1:11434"),
  ollamaModel: z.string().default("llama3.2"),

  /** Stock footage provider. Pixabay and Pexels are free; Pexels needs a key. */
  videoSource: z.enum(["pixabay", "pexels", "local"]).default("pixabay"),
  pexelsApiKey: z.string().default(""),
  pixabayApiKey: z.string().default(""),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = Settings.parse({});

/** Respects XDG on Linux; uses the usual per-OS location otherwise. */
export function settingsPath(): string {
  if (process.env.TASAWWUR_SETTINGS) return process.env.TASAWWUR_SETTINGS;
  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "tasawwur", "settings.json");
  }
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "tasawwur", "settings.json");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "tasawwur", "settings.json");
}

/**
 * Drops a stored voice the speech model cannot use.
 *
 * Earlier versions saved ids from a provider this no longer synthesises with.
 * Those ids are strings like any other, so they parse happily and then fail
 * silently at render time — the very thing that made the old voice picker
 * misleading. Anything unrecognised falls back to the default instead.
 */
function usableVoice(voice: string): string {
  return KOKORO_VOICES.some((v) => v.id === voice) ? voice : DEFAULT_VOICE;
}

/** Missing or corrupt files fall back to defaults rather than failing the app. */
export async function readSettings(): Promise<Settings> {
  try {
    const raw = await readFile(settingsPath(), "utf8");
    const parsed = Settings.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_SETTINGS;
    return { ...parsed.data, defaultVoice: usableVoice(parsed.data.defaultVoice) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Merges a partial update over what is stored and writes the result. */
export async function writeSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = Settings.parse({ ...(await readSettings()), ...patch });
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });
  // 0600: this file holds API keys.
  await writeFile(path, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return next;
}

/** Never send secrets to the browser; report only whether each is set. */
export function redact(s: Settings) {
  const { pexelsApiKey, pixabayApiKey, ...rest } = s;
  return {
    ...rest,
    pexelsApiKeySet: pexelsApiKey.length > 0,
    pixabayApiKeySet: pixabayApiKey.length > 0,
  };
}
