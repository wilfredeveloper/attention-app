// A lesson's glossary, and which of its terms a highlight is. The glossary is written once per lesson (/api/gloss) and looked up
// here, in memory, as the learner highlights (components/canvas/lessonGloss.ts): no model call, well under a millisecond.
//
// The rule the learner set: a definition is for exactly what is highlighted. So a highlight is a term only when its words are that
// term (small words at its ends aside), or part of that term where the text has the whole term around it. Never a longer term
// from somewhere else, and never one term out of a longer highlight.
//
// No imports, so the tests load this file as it is (lib/gloss.test.mjs).

/** A term as the glossary's writer gives it. also: its other spellings in the text (a plural, an acronym, a symbol). */
export type Term = { term: string; def: string; also?: string[] };

/**
 * One spelling a term is found by. key: the spelling as `norm` gives it. scope: where it holds; an entry written for one passage
 * (entryFor) holds only there, one without holds anywhere in the lesson. caps: a spelling in capitals (AND, OR, XOR), which a
 * highlight must have in capitals too: "and" in a sentence is not the gate.
 */
export type Entry = { key: string; words: number; term: string; def: string; scope?: unknown; caps?: string };

/** What is highlighted: its words; the passage they are in, and where in it they stand (clamped to it when they start or end
    outside); and that passage as a scope (see Entry). */
export type Highlight = { text: string; around: string; start: number; end: number; scope?: unknown };

const LETTER = /[\p{L}\p{N}]/u;
const stem = (w: string) =>
  w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && /(s|x|z|ch|sh)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

/** Words as they are compared: lower case, accents and punctuation gone, plural endings off. */
export const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean).map(stem).join(" ");

/** Words that don't count at the ends of a highlight: "the sigmoid" is the sigmoid. */
const SMALL = new Set("a an the of to is are and or in on its this that as by for with".split(" ").map(stem));

/** The glossary as entries: one per spelling of each term, the first to claim a spelling keeping it. */
export function toEntries(terms: Term[]): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const t of terms)
    for (const form of [t.term, ...(t.also ?? [])]) {
      const key = norm(form);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, words: key.split(" ").length, term: t.term, def: t.def, ...(/^[A-Z][A-Z0-9]+$/.test(form.trim()) ? { caps: form.trim() } : {}) });
    }
  return out;
}

/** An entry for words defined in one passage (a definition written live for a highlight): it holds only in `scope`. */
export function entryFor(words: string, def: string, scope: unknown): Entry {
  const key = norm(words);
  return { key, words: key.split(" ").length, term: label(words), def, scope };
}

/** The highlight widened to whole words: an end inside a word moves out to its edge, so a pause mid-drag at "Neural Ne" asks
    about "Neural Net" (a hyphen holds a word together). A highlight its paragraph doesn't hold as it is (it runs on into another)
    stays as it is. */
export function wholeWords(h: Highlight): { start: number; end: number; text: string } {
  const flat = (t: string) => t.replace(/\s+/g, " ").trim();
  if (flat(h.around.slice(h.start, h.end)) !== flat(h.text)) return { start: h.start, end: h.end, text: h.text };
  const inWord = (c: string | undefined) => !!c && (LETTER.test(c) || c === "-");
  let { start, end } = h;
  while (start > 0 && inWord(h.around[start - 1]) && inWord(h.around[start])) start--;
  while (end < h.around.length && inWord(h.around[end]) && inWord(h.around[end - 1])) end++;
  return { start, end, text: h.around.slice(start, end) };
}

/** A paragraph's key for the definitions written for it, kept across visits: its words, hashed. One holds only where the text is
    still the same. */
export function scopeKey(text: string) {
  let h = 5381;
  for (const c of text.replace(/\s+/g, " ").trim()) h = (Math.imul(h, 33) ^ c.codePointAt(0)!) >>> 0;
  return h.toString(36);
}

/** Words on one line, cut to a heading's length. */
export function label(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

/** The entry for exactly these words: the term they are; else the shortest term they are part of (part: true), which the caller
    takes only where the text has that whole term around the highlight. */
function lookup(entries: Entry[], words: string, scope: unknown, raw: string): { entry: Entry; part: boolean } | null {
  if (!words) return null;
  const inside = ` ${words} `;
  let best: Entry | null = null;
  for (const e of entries) {
    if (e.scope !== undefined && e.scope !== scope) continue;
    if (e.caps && !new RegExp(`(?<![A-Za-z])${e.caps}(?![a-z])`).test(raw)) continue;
    if (e.key === words) return { entry: e, part: false };
    if (words.length >= 3 && ` ${e.key} `.includes(inside) && (!best || e.words < best.words)) best = e;
  }
  return best && { entry: best, part: true };
}

/** The highlight as it is; then without the small words at its ends; and, where an end falls inside a word (mid-drag it often
    does), without that half word, as the whole term may be around it. */
function lookupLoose(entries: Entry[], text: string, scope: unknown, mid: { start: boolean; end: boolean }) {
  const w = norm(text).split(" ").filter(Boolean);
  const tries = [[0, w.length], ...(mid.end ? [[0, w.length - 1]] : []), ...(mid.start ? [[1, w.length]] : []), ...(mid.start && mid.end ? [[1, w.length - 1]] : [])];
  for (let [a, b] of tries) {
    const whole = b > a ? lookup(entries, w.slice(a, b).join(" "), scope, text) : null;
    if (whole) return whole;
    while (a < b && SMALL.has(w[a])) a++;
    while (b > a && SMALL.has(w[b - 1])) b--;
    const hit = b > a ? lookup(entries, w.slice(a, b).join(" "), scope, text) : null;
    if (hit) return hit;
  }
  return null;
}

/** Where the term with this key stands in `around`, touching [start, end): each of its words with whatever ending the text gives
    it (the key is stemmed). */
function spanOf(around: string, key: string, start: number, end: number): [number, number] | null {
  const word = (w: string) => (w.length > 3 ? `${w.replace(/y$/, "")}[\\p{L}\\p{N}]*` : w);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${key.split(" ").map(word).join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])`, "giu");
  for (const m of around.matchAll(re)) if (m.index < end && m.index + m[0].length > start) return [m.index, m.index + m[0].length];
  return null;
}

/** The glossary's entry for a highlight, and where its term stands in the passage (the highlight itself, when the term is not
    found written there). None when the glossary has no entry for exactly these words. */
export function matchFor(entries: Entry[], h: Highlight): { entry: Entry; start: number; end: number } | null {
  const inWord = (i: number) => LETTER.test(h.around[i - 1] ?? "") && LETTER.test(h.around[i] ?? "");
  const hit = lookupLoose(entries, h.text, h.scope, { start: inWord(h.start), end: inWord(h.end) });
  if (!hit) return null;
  const span = spanOf(h.around, hit.entry.key, h.start, h.end);
  // "network" is part of "single-layer network", but that only defines it where the text says the whole term
  if (hit.part && !span) return null;
  return { entry: hit.entry, start: span?.[0] ?? h.start, end: span?.[1] ?? h.end };
}
