// Finding a highlighted phrase again in a page's text, so a passage you explored or asked about
// can be marked after a reload: the page's text nodes are read as one string with whitespace
// runs collapsed (the way a highlight's text was taken, see lib/rangeText.ts), and every
// place the phrase appears is returned as text-node positions to build a DOM Range from.
// Pure, so `pnpm test` can run it (lib/anchor.test.mjs); the canvas picks among the places.

/** A place a phrase appears: [text node index, offset] of its first character and just past its last. */
export type Place = { start: [number, number]; end: [number, number] };

const SPACE = /\s/;

/** The phrase to look for: whitespace collapsed; a phrase with $TeX$ in it (maths, which reads
    differently in the page) is looked for by its longest plain part, if that is long enough. */
export function searchable(term: string): string {
  const t = term.replace(/\s+/g, " ").trim();
  if (!t.includes("$")) return t;
  const parts = t.split(/\$[^$]*\$/).map((p) => p.trim()).sort((a, b) => b.length - a.length);
  return parts[0] && parts[0].length >= 3 ? parts[0] : "";
}

/** The texts as one string, whitespace runs collapsed to one space (or, `spaces` false, dropped), and
    where each of its characters is. */
type Flat = { text: string; at: [number, number][] };
function flatten(texts: string[], spaces: boolean): Flat {
  let text = "";
  const at: [number, number][] = [];
  let space = true; // collapse leading whitespace too
  texts.forEach((t, ti) => {
    for (let i = 0; i < t.length; i++) {
      if (SPACE.test(t[i])) {
        if (space || !spaces) continue;
        space = true;
        text += " ";
      } else {
        space = false;
        text += t[i];
      }
      at.push([ti, i]);
    }
  });
  return { text, at };
}

function scan({ text, at }: Flat, needle: string): Place[] {
  const out: Place[] = [];
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    const last = at[i + needle.length - 1];
    out.push({ start: at[i], end: [last[0], last[1] + 1] });
  }
  return out;
}

/** As written, else ignoring case (a question asked in the reader can keep the page's capitalisation
    styling, "Light pen" for "light pen"), when lowercasing keeps every character's place. */
function scanAnyCase(flat: Flat, needle: string): Place[] {
  const out = scan(flat, needle);
  if (out.length) return out;
  const lower = flat.text.toLowerCase();
  return lower.length === flat.text.length ? scan({ text: lower, at: flat.at }, needle.toLowerCase()) : [];
}

/** Every place the phrase appears in the texts, however whitespace and elements break it up. */
export function findAll(texts: string[], term: string): Place[] {
  const want = searchable(term);
  if (!want) return [];
  const out = scanAnyCase(flatten(texts, true), want);
  if (out.length) return out;
  // none: ignore whitespace. A highlight across blocks was once taken with nothing where they meet
  // ("UIEach") and is now taken with a space ("UI Each"), while the page may have either.
  return scanAnyCase(flatten(texts, false), want.replace(/\s/g, ""));
}
