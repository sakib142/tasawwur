import { readdir } from "node:fs/promises";
import { basename, extname } from "node:path";

/**
 * Subtitle fonts.
 *
 * During Stage 1 the engine does the rendering, and it will only load fonts
 * from its own resource/fonts directory — it resolves the name against that
 * directory and rejects anything outside it. So the catalogue has to be read
 * from there, and ENGINE_FONTS_DIR points at it.
 *
 * When the renderer is ported, fonts move into this repo and this module reads
 * from a bundled directory instead. The returned shape will not change.
 */
const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".ttc", ".woff", ".woff2"]);

export interface Font {
  /** Filename exactly as the engine expects it, e.g. "BeVietnamPro-Bold.ttf". */
  id: string;
  label: string;
  /** Latin-first faces suit English captions; CJK faces carry Latin glyphs but read worse. */
  recommended: boolean;
}

/** Faces known to be good for Latin captions, in preference order. */
const PREFERRED = ["Anton-Regular", "BeVietnamPro-Bold", "BeVietnamPro-Medium", "Charm-Bold"];

function toLabel(file: string): string {
  const stem = basename(file, extname(file));
  return stem.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

export async function listFonts(dir = process.env.ENGINE_FONTS_DIR): Promise<Font[]> {
  if (!dir) {
    throw new Error(
      "ENGINE_FONTS_DIR is not set. Point it at the engine's resource/fonts directory.",
    );
  }

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (cause) {
    throw new Error(
      `Cannot read fonts from ${dir}. Check the path and permissions. ` +
        `(${cause instanceof Error ? cause.message : "unknown error"})`,
    );
  }

  return entries
    .filter((f) => FONT_EXTENSIONS.has(extname(f).toLowerCase()))
    .map((f) => ({
      id: f,
      label: toLabel(f),
      recommended: PREFERRED.includes(basename(f, extname(f))),
    }))
    .sort(
      (a, b) =>
        Number(b.recommended) - Number(a.recommended) || a.label.localeCompare(b.label),
    );
}
