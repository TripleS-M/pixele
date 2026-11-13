/**
 * Answer normalisation. Deliberately strict: after normalising, a guess must
 * exactly equal the primary answer or one of the accepted alternatives.
 * No fuzzy / partial matching, so unrelated guesses are never accepted.
 */
export function normalizeAnswer(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents: "pokémon" -> "pokemon"
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '') // "rubik's" -> "rubiks"
    .replace(/[^a-z0-9]+/g, ' ') // all other punctuation becomes a space
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(?:a|an|the) (?=.)/, ''); // "the eiffel tower" -> "eiffel tower"
}

export function isCorrectGuess(guess: string, answer: string, accepted: string[]): boolean {
  const g = normalizeAnswer(guess);
  if (!g) return false;
  return [answer, ...accepted].some((a) => normalizeAnswer(a) === g);
}

/** Cleans a list of accepted answers from the admin form / sidecar file. */
export function cleanAccepted(input: unknown): string[] {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\n,]/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const text = String(item ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const key = normalizeAnswer(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.slice(0, 50);
}
