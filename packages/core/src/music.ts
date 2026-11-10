import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Background music beds.
 *
 * The renderer has always been able to mix music — `assemble` loops it, ducks
 * it and fades it out — and the parameters have always existed. Nothing ever
 * handed it a file, so every video so far has been narration over silence,
 * which is the single loudest signal that something was generated rather than
 * made.
 *
 * Tracks are listed from a directory rather than hard-coded so anyone can drop
 * their own in without touching the code.
 */

const MUSIC_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"]);

export interface Track {
  /** The file name, which is what `bgm_file` carries. */
  id: string;
  label: string;
}

/** Where bundled music lives. Resolved from this module, not the cwd. */
export function musicDir(): string {
  if (process.env.TASAWWUR_MUSIC) return process.env.TASAWWUR_MUSIC;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "music");
}

/** "soft-piano_loop.mp3" reads better as "Soft piano loop". */
function toLabel(file: string): string {
  const stem = basename(file, extname(file)).replace(/[_-]+/g, " ").trim();
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/**
 * The available tracks.
 *
 * An empty or missing directory is not an error: music is optional, and a
 * video without it still renders. Only the picker changes.
 */
export async function listMusic(dir = musicDir()): Promise<Track[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  return entries
    .filter((f) => MUSIC_EXTENSIONS.has(extname(f).toLowerCase()))
    .map((f) => ({ id: f, label: toLabel(f) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Which file to score a video with, if any.
 *
 * `bgm_type` is the mode and `bgm_file` the explicit choice, mirroring the
 * wire contract. "random" picks for you, which is what someone who has not
 * thought about music wants; "none" is honoured exactly.
 *
 * `pick` is injectable so a test does not have to reason about randomness.
 */
export async function resolveTrack(
  bgmType: string,
  bgmFile: string,
  dir = musicDir(),
  pick: (n: number) => number = (n) => Math.floor(Math.random() * n),
): Promise<string | null> {
  if (bgmType === "none" || bgmType === "") return null;

  // An explicit file wins, but only by name — a path from a request must not
  // be able to reach outside the music directory.
  const named = bgmFile.trim();
  if (named) {
    const safe = basename(named);
    const tracks = await listMusic(dir);
    const found = tracks.find((t) => t.id === safe);
    return found ? join(dir, found.id) : null;
  }

  if (bgmType !== "random") return null;

  const tracks = await listMusic(dir);
  if (tracks.length === 0) return null;
  return join(dir, tracks[pick(tracks.length)]!.id);
}
