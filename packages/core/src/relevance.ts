/**
 * Matching footage to the line it will sit under.
 *
 * Search terms are chosen for the video as a whole, so every clip a term
 * returns is equally "correct" and the first one wins by default. That is why
 * a shot of a calm river could land under "it meets a cliff, and it falls" —
 * nothing in the selection knew which sentence the shot was for.
 *
 * Pixabay returns tags with every result, and the script is already to hand,
 * so the two can simply be compared. Deliberately lexical: an embedding model
 * would match better, but it would also mean a download, a runtime, and a
 * dependency on something that can be taken away. This costs nothing and
 * catches the obvious cases, which are most of them.
 */

/**
 * Words too common to carry meaning.
 *
 * Short enough to read, which matters more than being exhaustive — a stopword
 * that slips through only ever adds a little noise, because scoring is
 * relative and every candidate is scored the same way.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
  "did", "do", "does", "for", "from", "had", "has", "have", "he", "her",
  "here", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its",
  "me", "my", "no", "not", "of", "on", "or", "our", "out", "she", "so",
  "than", "that", "the", "their", "them", "then", "there", "these", "they",
  "this", "to", "up", "us", "was", "we", "were", "what", "when", "where",
  "which", "while", "who", "will", "with", "would", "you", "your",
]);

/**
 * Crude suffix stripping, so "falls" matches "waterfall" and "rivers" matches
 * "river".
 *
 * Not a real stemmer. A real one is a dependency and a dictionary, and the
 * only job here is to stop a plural from missing its own singular.
 */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ss|sh|ch|x)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  return word;
}

/** The meaningful words of a piece of text, stemmed and deduplicated. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    const word = stem(raw);
    // One- and two-letter remnants match far too much to be useful.
    if (word.length > 2) out.add(word);
  }
  return out;
}

/**
 * How well a clip's tags cover a line of script, from 0 to 1.
 *
 * Measured against the sentence rather than the tags: a clip tagged with
 * thirty words should not score highly just for casting a wide net, and the
 * question being asked is "does this footage show what the line is about",
 * not "is this line about everything the clip shows".
 */
export function relevance(tags: readonly string[], sentence: string): number {
  const wanted = contentWords(sentence);
  if (wanted.size === 0) return 0;

  const have = contentWords(tags.join(" "));
  if (have.size === 0) return 0;

  let hits = 0;
  for (const word of wanted) {
    // A containment check as well as equality, so "waterfall" answers "fall"
    // and "rainstorm" answers "rain". Both directions, because either may be
    // the longer word.
    for (const tag of have) {
      if (tag === word || tag.includes(word) || word.includes(tag)) {
        hits++;
        break;
      }
    }
  }
  return hits / wanted.size;
}

/**
 * Does a clip answer the whole term, or only part of it?
 *
 * Used to keep footage out of a video rather than to warn about it. A search
 * for "cold brew" returns clips tagged "cold" and nothing to do with coffee;
 * a search for "Dubai Marina" returns Brighton. Both answer one word, and
 * neither is what was asked for.
 */
export function coversTerm(tags: readonly string[], term: string): boolean {
  // Not 1 exactly: the score is a ratio and a three-word term divides by three.
  return relevance(tags, term) >= 0.999;
}

/**
 * Which words of a term the results actually answer, and which were ignored.
 *
 * The provider matches on any word rather than all of them, and says nothing
 * about which. "cold brew" came back four clips of snow — every one tagged
 * "cold", not one tagged anything to do with coffee.
 *
 * Judging that lexically is not possible, and it is worth being clear why.
 * "Dubai Marina" returns genuine Dubai skylines tagged "dubai" but never
 * "marina": the same shape of answer — one word honoured, one ignored — and
 * a perfectly good result. The difference is that "dubai" identifies the
 * subject on its own and "cold" does not, which is a fact about the words,
 * not about the tags.
 *
 * So this reports rather than rules. Naming the ignored word lets a person
 * see "matched cold, ignored brew" and decide in a second what no amount of
 * string comparison can decide for them.
 */
export function termCoverage(
  term: string,
  clipTags: ReadonlyArray<readonly string[]>,
): { word: string; share: number }[] {
  const words = [...contentWords(term)];
  if (clipTags.length === 0) return words.map((word) => ({ word, share: 0 }));

  return words.map((word) => ({
    word,
    share: clipTags.filter((tags) => relevance(tags, word) > 0).length / clipTags.length,
  }));
}

/**
 * Split a script into sentences.
 *
 * The renderer cuts shots on sentence ends, so this is the same unit the
 * picture is organised around. Falls back to the whole script when there is
 * no terminal punctuation, which is common in a one-line topic.
 */
export function sentences(script: string): string[] {
  const found = script
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  return found.length > 0 ? found : [];
}
