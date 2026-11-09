import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import type { Cue } from "../captions.ts";

/**
 * Captions are drawn to transparent PNGs and composited by ffmpeg.
 *
 * Not a workaround — a requirement. This ffmpeg build has neither libass nor
 * drawtext, so it cannot draw text at all; `overlay` is the only route. Drawing
 * them ourselves also means the exact same output regardless of which ffmpeg
 * build is installed, which text filters notoriously do not give you.
 */

export interface CaptionStyle {
  /** Absolute path to a font file. */
  fontPath: string;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  /** A colour, or false for none. */
  background: string | false;
  roundedBackground: boolean;
  /** Fraction of the frame height where the caption sits, 0 = top. */
  position: number;
}

export interface Frame {
  /** PNG bytes, transparent except for the caption. */
  png: Buffer;
  start: number;
  end: number;
}

const registered = new Set<string>();

/** Fonts register once per process; re-registering the same file is wasted work. */
function fontFamily(fontPath: string): string {
  const family = `caption-${Buffer.from(fontPath).toString("base64url").slice(-16)}`;
  if (!registered.has(fontPath)) {
    if (!GlobalFonts.registerFromPath(fontPath, family)) {
      throw new Error(`Could not load the caption font at ${fontPath}.`);
    }
    registered.add(fontPath);
  }
  return family;
}

/** Greedy wrap on measured width — the only way to be accurate for a given face. */
function wrap(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundedRect(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw one caption at full frame size.
 *
 * Full-frame rather than a cropped strip so compositing is a plain overlay at
 * 0,0 — no per-cue position arithmetic in the filter graph, where mistakes are
 * invisible until the video is watched.
 */
export function renderCaption(
  text: string,
  width: number,
  height: number,
  style: CaptionStyle,
): Buffer {
  const family = fontFamily(style.fontPath);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.font = `${style.fontSize}px "${family}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Keep captions clear of the edges; phones round the corners of the screen.
  const margin = Math.round(width * 0.08);
  const lines = wrap(ctx, text, width - margin * 2);
  const lineHeight = Math.round(style.fontSize * 1.25);
  const blockHeight = lines.length * lineHeight;

  // `position` is where the block sits; clamp so it never runs off-frame.
  const centre = Math.round(height * style.position);
  const top = Math.min(
    Math.max(centre - blockHeight / 2, margin),
    height - blockHeight - margin,
  );

  if (style.background) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const padX = Math.round(style.fontSize * 0.5);
    const padY = Math.round(style.fontSize * 0.3);
    ctx.fillStyle = style.background;
    const boxX = (width - widest) / 2 - padX;
    const boxY = top - padY;
    const boxW = widest + padX * 2;
    const boxH = blockHeight + padY * 2;
    if (style.roundedBackground) {
      roundedRect(ctx, boxX, boxY, boxW, boxH, style.fontSize * 0.35);
    } else {
      ctx.fillRect(boxX, boxY, boxW, boxH);
    }
  }

  lines.forEach((line, i) => {
    const y = top + i * lineHeight + lineHeight / 2;
    if (style.strokeWidth > 0) {
      // Canvas strokes centred on the glyph edge, so half the width lands
      // inside the letter. Doubling keeps the visible outline as asked for.
      ctx.lineWidth = style.strokeWidth * 2;
      ctx.strokeStyle = style.strokeColor;
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeText(line, width / 2, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, width / 2, y);
  });

  return canvas.toBuffer("image/png");
}

/** Named positions, as a fraction of frame height. */
export const POSITIONS: Record<string, number> = {
  top: 0.12,
  center: 0.5,
  two_thirds_bottom: 0.72,
  bottom: 0.86,
};

export function renderCaptions(
  cues: Cue[],
  width: number,
  height: number,
  style: CaptionStyle,
): Frame[] {
  return cues.map((cue) => ({
    png: renderCaption(cue.text, width, height, style),
    start: cue.start,
    end: cue.end,
  }));
}
