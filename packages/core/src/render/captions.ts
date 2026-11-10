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
  position: CaptionPosition;
  /** Only for "custom": where the block's top edge sits, 0-100. */
  customPosition?: number;
}

export type CaptionPosition =
  | "top"
  | "center"
  | "two_thirds_bottom"
  | "bottom"
  | "custom";

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

  const top = blockTop(style, height, blockHeight, margin);

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

    // A soft shadow under the first mark drawn. Over bright footage — snow,
    // sky, a waterfall — white text with only a thin outline still dissolves
    // into the picture; this separates it without reading as an effect.
    // Scaled to the type size so it holds at any caption size.
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = Math.max(2, Math.round(style.fontSize * 0.18));
    ctx.shadowOffsetY = Math.max(1, Math.round(style.fontSize * 0.05));

    if (style.strokeWidth > 0) {
      // Canvas strokes centred on the glyph edge, so half the width lands
      // inside the letter. Doubling keeps the visible outline as asked for.
      ctx.lineWidth = style.strokeWidth * 2;
      ctx.strokeStyle = style.strokeColor;
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeText(line, width / 2, y);
    }

    // The shadow belongs to the outer edge only. Leaving it on for the fill
    // darkens the letter from the inside and the type looks muddy.
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = style.color;
    ctx.fillText(line, width / 2, y);
  });

  return canvas.toBuffer("image/png");
}

/**
 * Where the caption block's top edge goes.
 *
 * Positions anchor an edge rather than centring the block at a fraction of the
 * height. That matters because captions vary in line count: anchoring keeps a
 * one-line and a three-line caption the same distance from the screen edge,
 * where centring makes the taller one drift toward the middle.
 */
function blockTop(
  style: CaptionStyle,
  height: number,
  blockHeight: number,
  margin: number,
): number {
  const available = height - blockHeight;
  let top: number;

  switch (style.position) {
    case "top":
      top = height * 0.05;
      break;
    case "center":
      top = available / 2;
      break;
    case "two_thirds_bottom":
      // Two thirds up from the bottom is one third down from the top.
      top = available / 3;
      break;
    case "custom":
      top = available * ((style.customPosition ?? 70) / 100);
      break;
    case "bottom":
    default:
      // The bottom edge sits at 95% of the height, leaving room for the
      // home indicator on a phone.
      top = height * 0.95 - blockHeight;
  }

  // Never let it run off the frame, whatever was asked for.
  return Math.round(Math.min(Math.max(top, margin), Math.max(available - margin, margin)));
}

/** The positions the form offers. */
export const POSITIONS = [
  "top",
  "center",
  "two_thirds_bottom",
  "bottom",
  "custom",
] as const;

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
