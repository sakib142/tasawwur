import { z } from "zod";

/**
 * Edge TTS voice catalogue — a native TypeScript implementation.
 *
 * This is the first service that no longer goes through the Python engine:
 * the catalogue is a plain HTTPS endpoint, so there is nothing to proxy. The
 * token below is a public constant shipped in Microsoft's Edge read-aloud
 * client; it is not a credential and grants nothing beyond this list.
 */
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const VOICE_LIST_URL =
  `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list` +
  `?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;

/** Shape Microsoft returns. Only the fields we rely on are declared. */
const UpstreamVoice = z.object({
  ShortName: z.string(),
  Gender: z.enum(["Male", "Female"]),
  Locale: z.string(),
  LocaleName: z.string(),
  FriendlyName: z.string(),
  Status: z.string().optional(),
  VoiceTag: z
    .object({
      ContentCategories: z.array(z.string()).optional(),
      VoicePersonalities: z.array(z.string()).optional(),
    })
    .optional(),
});

export const Voice = z.object({
  /**
   * The engine selects its TTS backend from this string alone, and expects
   * "<ShortName>-<Gender>" — e.g. "en-US-AvaNeural-Female".
   */
  id: z.string(),
  shortName: z.string(),
  gender: z.enum(["Male", "Female"]),
  locale: z.string(),
  localeName: z.string(),
  /** Display name: "Ava" rather than Microsoft's long FriendlyName. */
  label: z.string(),
  /** Multilingual models sound richer but are slower to stream. */
  multilingual: z.boolean(),
  personalities: z.array(z.string()),
});
export type Voice = z.infer<typeof Voice>;

function toVoice(v: z.infer<typeof UpstreamVoice>): Voice {
  // "en-US-AvaMultilingualNeural" -> "Ava"
  const stem = v.ShortName.split("-").pop() ?? v.ShortName;
  const label = stem.replace(/Multilingual/, "").replace(/Neural\d*$/, "");
  return {
    id: `${v.ShortName}-${v.Gender}`,
    shortName: v.ShortName,
    gender: v.Gender,
    locale: v.Locale,
    localeName: v.LocaleName,
    label,
    multilingual: /Multilingual/i.test(v.ShortName),
    personalities: v.VoiceTag?.VoicePersonalities ?? [],
  };
}

/**
 * Fetch the catalogue, optionally narrowed to locale prefixes ("en", "ar").
 * Sorted by locale then name so the UI order is stable.
 */
export async function listVoices(opts: { locales?: string[]; signal?: AbortSignal } = {}) {
  const res = await fetch(VOICE_LIST_URL, { signal: opts.signal });
  if (!res.ok) {
    throw new Error(`Voice catalogue unavailable (HTTP ${res.status})`);
  }

  const parsed = z.array(UpstreamVoice).safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("Voice catalogue returned an unexpected shape");
  }

  const prefixes = opts.locales?.map((l) => l.toLowerCase());
  return parsed.data
    .filter((v) =>
      prefixes ? prefixes.some((p) => v.Locale.toLowerCase().startsWith(p)) : true,
    )
    .map(toVoice)
    .sort((a, b) => a.locale.localeCompare(b.locale) || a.label.localeCompare(b.label));
}
