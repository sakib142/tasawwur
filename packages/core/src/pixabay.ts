import { z } from "zod";
import { ASPECT_RESOLUTION, type VideoAspect } from "@tasawwur/schema";

/**
 * Pixabay stock video search.
 *
 * Beyond fetching results this exists to answer one question before you spend
 * five minutes rendering: *is this search term any good?* Stock libraries let a
 * single contributor upload dozens of near-identical clips, so a term reporting
 * "11 results" can be eleven angles of one shot. Counting results alone cannot
 * see that; counting distinct creators can.
 */
const ENDPOINT = "https://pixabay.com/api/videos/";

/** Pixabay allows 100 requests per minute per key. */
export const RATE_LIMIT_PER_MINUTE = 100;

const Rendition = z.object({
  url: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  size: z.number().int().optional(),
  thumbnail: z.string().optional(),
});

const Hit = z.object({
  id: z.number().int(),
  pageURL: z.string(),
  duration: z.number(),
  tags: z.string(),
  user: z.string(),
  user_id: z.number().int(),
  views: z.number().int().optional(),
  downloads: z.number().int().optional(),
  isAiGenerated: z.boolean().optional(),
  isGRated: z.boolean().optional(),
  isLowQuality: z.boolean().optional(),
  videos: z.record(z.string(), Rendition),
});

const SearchResponse = z.object({
  total: z.number().int(),
  totalHits: z.number().int(),
  hits: z.array(Hit),
});

export interface Clip {
  id: number;
  pageUrl: string;
  /** Download URL for the smallest rendition that still meets the target size. */
  url: string;
  width: number;
  height: number;
  /** Bytes, when Pixabay reports it. Used to avoid needless 200MB downloads. */
  bytes?: number;
  thumbnail?: string;
  durationSeconds: number;
  creator: string;
  creatorId: number;
  tags: string[];
  aiGenerated: boolean;
  /** Pixabay's own safe-for-all-audiences flag. */
  familyFriendly: boolean;
  lowQuality: boolean;
}

export interface SearchOptions {
  apiKey: string;
  aspect?: VideoAspect;
  /** Minimum usable length. Clips shorter than one cut are not worth a slot. */
  minDurationSeconds?: number;
  /** Exclude clips Pixabay flags as AI-generated. Default true. */
  excludeAiGenerated?: boolean;
  /** Keep only family-friendly clips. Default true. */
  familyFriendlyOnly?: boolean;
  perPage?: number;
  signal?: AbortSignal;
}

export class PixabayError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PixabayError";
    this.status = status;
  }
}

function orientationMatches(w: number, h: number, aspect: VideoAspect): boolean {
  if (aspect === "1:1") return true; // square output crops from either orientation
  return aspect === "9:16" ? h > w : w > h;
}

/**
 * Choose the smallest rendition that still meets the target resolution.
 *
 * Pixabay serves the same clip at up to 4K, and the largest can exceed 200MB —
 * enough to blow a download cap for no visible gain, since everything is scaled
 * to the output size anyway. Picking the smallest sufficient rendition keeps
 * downloads an order of magnitude cheaper.
 */
function pickRendition(
  renditions: Record<string, z.infer<typeof Rendition>>,
  aspect: VideoAspect,
) {
  const [targetW, targetH] = ASPECT_RESOLUTION[aspect];
  const usable = Object.values(renditions)
    .filter((r) => r.width > 0 && r.height > 0)
    .filter((r) => orientationMatches(r.width, r.height, aspect))
    .filter((r) => r.width >= targetW && r.height >= targetH)
    .sort((a, b) => a.width * a.height - b.width * b.height);
  return usable[0];
}

/** Search one term. Returns only clips usable at the requested aspect. */
export async function searchPixabay(term: string, opts: SearchOptions): Promise<Clip[]> {
  const {
    apiKey,
    aspect = "9:16",
    minDurationSeconds = 3,
    excludeAiGenerated = true,
    familyFriendlyOnly = true,
    perPage = 50,
    signal,
  } = opts;

  if (!apiKey) {
    throw new PixabayError("No Pixabay API key configured. Add one in Settings.", 401);
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", term);
  url.searchParams.set("video_type", "all");
  url.searchParams.set("per_page", String(Math.min(Math.max(perPage, 3), 200)));

  const res = await fetch(url, { signal });

  if (res.status === 429) {
    throw new PixabayError(
      `Pixabay rate limit reached (${RATE_LIMIT_PER_MINUTE}/minute). Wait a moment and retry.`,
      429,
    );
  }
  if (!res.ok) {
    // The key travels in the query string, so never echo the URL back.
    throw new PixabayError(`Pixabay search failed (HTTP ${res.status}).`, res.status);
  }

  const parsed = SearchResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new PixabayError("Pixabay returned an unexpected response shape.", 502);
  }

  const clips: Clip[] = [];
  for (const hit of parsed.data.hits) {
    if (hit.duration < minDurationSeconds) continue;
    if (excludeAiGenerated && hit.isAiGenerated) continue;
    if (familyFriendlyOnly && hit.isGRated === false) continue;

    const rendition = pickRendition(hit.videos, aspect);
    if (!rendition) continue; // nothing at this orientation and size

    clips.push({
      id: hit.id,
      pageUrl: hit.pageURL,
      url: rendition.url,
      width: rendition.width,
      height: rendition.height,
      bytes: rendition.size,
      thumbnail: rendition.thumbnail,
      durationSeconds: hit.duration,
      creator: hit.user,
      creatorId: hit.user_id,
      tags: hit.tags.split(",").map((t) => t.trim()).filter(Boolean),
      aiGenerated: hit.isAiGenerated ?? false,
      familyFriendly: hit.isGRated ?? true,
      lowQuality: hit.isLowQuality ?? false,
    });
  }
  return clips;
}
