/**
 * Prompts for script and keyword writing.
 *
 * Both are shaped by what the rest of the pipeline needs rather than by what
 * reads well on a page. The script is spoken aloud by a synthesiser, so
 * anything a synthesiser would read literally — asterisks, headings, stage
 * directions — has to be absent rather than stripped afterwards. The keywords
 * are sent to a stock footage search, so they have to name things a camera can
 * photograph.
 */

export const SCRIPT_SYSTEM = `
You write narration that will be read aloud by a speech synthesiser and laid over stock footage.

Write only the words to be spoken. Nothing else is read aloud, so anything that is not
narration is a defect:
- no markdown, asterisks, headings, bullets or quotation marks around the whole piece
- no "Narrator:", no stage directions, no scene numbers
- no title, no sign-off, no "in this video" or "today we will"
- no mention of the video, the script, or these instructions

Open on the subject itself, in the first sentence. Use short declarative sentences and
everyday words. Prefer the concrete to the abstract: a thing someone can picture beats a
category. Vary sentence length so it does not read as a list.

Write in the same language as the subject unless told otherwise.
`.trim();

export interface ScriptRequest {
  subject: string;
  /** Roughly how long it should take to read aloud. */
  targetSeconds?: number;
  language?: string;
  /** Extra direction from the user, e.g. "for children aged 5 to 8". */
  guidance?: string;
}

export function buildScriptPrompt({
  subject,
  targetSeconds = 40,
  language,
  guidance,
}: ScriptRequest): string {
  // Around 2.6 words a second at a natural narration pace.
  const words = Math.round(targetSeconds * 2.6);
  return [
    `Subject: ${subject}`,
    ``,
    `Write roughly ${words} words — about ${targetSeconds} seconds read aloud.`,
    language ? `Write it in ${language}.` : null,
    guidance ? `Additional direction: ${guidance}` : null,
    ``,
    `Return only the narration.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export const TERMS_SYSTEM = `
You choose search terms for a stock footage library.

Return a JSON array of strings and nothing else. No prose, no code fence, no explanation.

Each term must name something a camera can photograph: a place, an object, a person doing
something, weather, light. Abstractions cannot be filmed, so "determination" is useless
where "runner at dawn" is not.

Keep each term to one to three words, in English, however the script is written — stock
libraries are indexed in English.

Prefer terms that many different photographers would have shot. A term so specific that
only one person has filmed it returns a dozen near-identical clips, and the finished video
looks repetitive.
`.trim();

export interface TermsRequest {
  script: string;
  count?: number;
  /** Keep the terms in narrative order rather than by importance. */
  inScriptOrder?: boolean;
}

export function buildTermsPrompt({
  script,
  count = 6,
  inScriptOrder = false,
}: TermsRequest): string {
  return [
    `Choose ${count} search terms for footage to accompany this narration.`,
    inScriptOrder
      ? `Return them in the order the narration reaches them, so the footage follows the words.`
      : `Return them in any order.`,
    ``,
    `Narration:`,
    script,
    ``,
    `Return only a JSON array of ${count} strings.`,
  ].join("\n");
}

/**
 * Pull a JSON array out of a model response.
 *
 * Models wrap arrays in code fences or a sentence of preamble often enough that
 * parsing the whole response strictly fails on output that is otherwise fine.
 */
export function extractStringArray(raw: string): string[] | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");

  const attempt = (candidate: string): string[] | null => {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) return null;
      const strings = parsed.filter((item): item is string => typeof item === "string");
      const cleaned = strings.map((s) => s.trim()).filter(Boolean);
      return cleaned.length ? cleaned : null;
    } catch {
      return null;
    }
  };

  const direct = attempt(text);
  if (direct) return direct;

  // Fall back to the first bracketed span in the response.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  return start !== -1 && end > start ? attempt(text.slice(start, end + 1)) : null;
}
