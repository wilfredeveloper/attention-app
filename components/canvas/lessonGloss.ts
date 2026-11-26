// The definitions the canvas shows as words are highlighted: the state behind the HUD (components/canvas/LessonHud.tsx). Words
// can be highlighted in four kinds of place, each a source: the lesson, a linked page (another lesson, a cheat sheet, a website),
// an Explore card and a note. Each looks words up in a glossary:
//
//   - the lesson: its own, written once by one model call as the lesson first opens, then read from its file (/api/gloss);
//   - a linked lesson or cheat sheet: its own, read if it is there, else written the first time words are highlighted in it, so a
//     page only glanced at costs nothing;
//   - a website: none, so every definition there is written live (and kept for that site);
//   - a card: the glossary of the lesson or page its chain of cards started on (it explains that page's terms);
//   - a note: the lesson's. A note is also where words are selected to edit them, so only a few words (NOTE_LIVE_WORDS) the
//     glossary lacks are ever defined live there: selecting a sentence to change it costs nothing.
//
// A highlight is looked up in memory at every change of the selection, so its definition shows at once and follows it as it
// grows (lib/gloss.ts has the rule for what counts as a term). Words the glossary lacks are defined live: once let go and rested
// a moment, the lab's text model (the one picked in the Models tab, through LAB_ROUTE) writes one line for them in their passage,
// streamed into place and stopped as soon as the highlight changes. It asks about whole words (a pause mid-drag at "Neural Ne" is
// "Neural Net"), never while the mouse is still dragging, and what it writes is kept with that glossary: the same words in the
// same paragraph are instant and free from then on, on later visits too.
//
// Letting go of a highlight that has a definition keeps it: its words stay tinted and its readout stays beside them, for this
// visit. Opening another lesson starts over.

import { entryFor, label, matchFor, scopeKey, toEntries, wholeWords, type Entry, type Highlight, type Term } from "@/lib/gloss";
import { isSoundOn, openOutput, setSoundOn, type Sound } from "@/lib/lab/text/sound/engine";
import { createSounds, type Sounds } from "@/lib/lab/text/sound/sounds";
import { LAB_ROUTE } from "@/lib/spaceship";

export type SourceKind = "lesson" | "page" | "card" | "note";
/** Where highlighted words are (`id`: the shape they are in), the window their text is in, and which glossary looks them up. */
type Source = { id: string; kind: SourceKind; win: Window; gloss: string };
/** A glossary: whose file it is (`lesson` is a lesson's slug, "ref-…" for a cheat sheet, "web-…" for a site), and what it has. */
type Glossary = {
  course: string;
  lesson: string;
  title: string;
  web: boolean; // a website: no glossary is ever written, only definitions written live
  status: "idle" | "reading" | "none" | "writing" | "ready" | "failed"; // none: there is none yet (written on a first highlight)
  entries: Entry[];
  terms: number;
  text: () => string; // the page's words, to write its glossary from
};

/**
 * What the highlight shows. source: the shape it is in; range: the highlight; lock: where its term stands in the text (the
 * highlight itself, for one defined as a whole); block: its paragraph. none: no definition (yet); pending: one is being written;
 * failed: none came back; asked: the model wrote it for this highlight.
 */
export type Shown = {
  source: string; term: string; def: string; none: boolean; range: Range; lock: Range; block: Element | null;
  words: string; scope: string; // for one defined live: its whole words, and its paragraph's key (lib/gloss.ts)
  pending?: boolean; failed?: boolean; asked?: boolean;
};
/** A definition kept where it was made: once per term and paragraph. */
export type Kept = { source: string; term: string; def: string; lock: Range; block: Element | null };

type State = {
  status: Glossary["status"]; // the lesson's glossary
  terms: number; // how many terms the lesson's glossary has, with those defined live
  toast: string;
  shown: Shown | null;
  hover: Kept | null; // the kept one under the pointer, on its words or its readout
  kept: Kept[];
  lookupMs: number; // how long the last lookup took
};

const REST_MS = 220; // a highlight the glossary doesn't cover is defined once it has kept still this long
const MAX_LIVE = 600; // characters: a longer highlight is a passage to explore, not words to define
const NOTE_LIVE_WORDS = 4; // in a note, words are mostly selected to edit them: only this few are ever defined live
const TOAST_MS = 3500;
const BLOCK = "p,li,dd,blockquote,h1,h2,h3,h4,pre,table,figure";
const TINT = "hud-tint";
/** In each page's own document: the tint of what was defined (the HUD's hot colour, faint). The board's is in app/reader.css. */
const FRAME_CSS = `::highlight(${TINT}) { background-color: rgb(224 102 79 / .15); }`;

let state: State = { status: "idle", terms: 0, toast: "", shown: null, hover: null, kept: [], lookupMs: 0 };
let version = 0;
const glossaries = new Map<string, Glossary>(); // by key; kept across lessons: a glossary read once is not read again
const sources = new Map<string, Source>(); // by shape id
const windows = new Set<Window>(); // where tints are painted
let lessonKey = "";
let isDown = false;
let restTimer: number | undefined;
let writing: AbortController | undefined;
const subs = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  version++;
  paintTints();
  subs.forEach((f) => f());
}

// ---- for the HUD ----
export const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export const glossVersion = () => version;
export const gloss = () => state;
/** What a source is (the HUD places a definition by it): undefined for one never highlighted in. */
export const sourceOf = (id: string) => sources.get(id);
export const setHover = (k: Kept | null) => k !== state.hover && set({ hover: k });
export const clearKept = () => set({ kept: [], hover: null });
/** The definition showing for the highlight right now, if it has one: the tutor's window opens with it. */
export const peekGloss = () => (state.shown && !state.shown.none && state.shown.def ? state.shown.def : undefined);
/** Ask again for a live definition that didn't come back. */
export const askAgain = () => state.shown && void writeLive(state.shown);
export const soundOn = () => isSoundOn();
export function toggleSound() {
  setSoundOn(!isSoundOn());
  set({});
}

/** The lab's sounds, on an output of this window's own; callers give a stereo position, -1 (left) to 1. */
let snd: Sounds | undefined;
export function hudSounds() {
  if (typeof window === "undefined") return undefined;
  if (!snd) {
    const out = openOutput();
    out.setAudible(true);
    snd = createSounds(out, (x) => x);
  }
  return snd;
}

// ---- glossaries ----

/** Fetch a glossary (once per key): `write` writes one if there is none yet (the lesson's own); otherwise it is only read. */
async function loadGlossary(key: string, write: boolean) {
  const g = glossaries.get(key);
  if (!g || g.status === "reading" || g.status === "writing" || g.status === "ready") return;
  g.status = write ? "writing" : "reading";
  if (key === lessonKey) set({ status: g.status });
  try {
    const res = await fetch("/api/gloss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course: g.course, lesson: g.lesson, title: g.title, write: write && !g.web, text: write && !g.web ? g.text() : "" }),
    });
    const data = (await res.json()) as { terms?: Term[]; live?: { words: string; scope: string; def: string }[]; cached?: boolean; none?: boolean; error?: string };
    if (!res.ok || !data.terms) throw new Error(data.error ?? `request failed (${res.status})`);
    const live = (data.live ?? []).map((l) => entryFor(l.words, l.def, l.scope));
    // definitions written live while this was on its way stay
    const meanwhile = g.entries.filter((e) => e.scope !== undefined && !live.some((l) => l.key === e.key && l.scope === e.scope));
    Object.assign(g, { status: data.none ? "none" : "ready", entries: [...toEntries(data.terms), ...live, ...meanwhile], terms: data.terms.length + live.length + meanwhile.length });
    if (key === lessonKey) {
      // only a glossary just written says so: one read from its file was there all along
      set({ status: g.status, terms: g.terms, toast: data.cached ? "" : `Definitions ready · ${data.terms.length} terms` });
      if (!data.cached) setTimeout(() => set({ toast: "" }), TOAST_MS);
    }
  } catch (e) {
    g.status = "failed";
    console.error(`The glossary for ${g.title || g.lesson} couldn't be ${write ? "written" : "read"}; highlights there are still defined live.`, e);
    if (key === lessonKey) set({ status: "failed" });
  }
}

function glossaryFor(key: string, init: Omit<Glossary, "status" | "entries" | "terms">) {
  let g = glossaries.get(key);
  if (!g) glossaries.set(key, (g = { ...init, status: "idle", entries: [], terms: 0 }));
  else g.text = init.text; // the page may have loaded again: read its words from the frame there now
  return g;
}

// ---- sources ----

/** The lesson's frame, as it is wired: its glossary is written now if it has none. Another lesson than before starts over. */
export function attachLesson(doc: Document, win: Window, o: { id: string; course: string; lesson: string; title: string }) {
  const key = `${o.course}/${o.lesson}`;
  if (key !== lessonKey) {
    stopWriting();
    lessonKey = key;
    state = { ...state, shown: null, hover: null, kept: [], toast: "", status: "idle", terms: 0 };
  }
  const g = glossaryFor(key, { course: o.course, lesson: o.lesson, title: o.title, web: false, text: () => pageText(doc) });
  attachFrame(doc, win, { id: o.id, kind: "lesson", win, gloss: key });
  set({ status: g.status, terms: g.terms });
  void loadGlossary(key, true);
}

/** A linked page's frame, as it is wired. A course's lesson or cheat sheet has its own glossary (read now, written on its first
    highlight); a website has none: its words are defined live, and kept for that site. */
export function attachPage(doc: Document, win: Window, o: { id: string; course: string; src: string; href: string; title: string }) {
  const m = /^\/courses\/([\w-]+)\/(lessons|reference)\/([\w.-]+)\.html$/.exec(o.src);
  const course = m ? m[1] : o.course;
  const lesson = m ? `${m[2] === "reference" ? "ref-" : ""}${m[3]}` : `web-${scopeKey(o.href || o.src)}`;
  const key = `${course}/${lesson}`;
  glossaryFor(key, { course, lesson, title: o.title, web: !m, text: () => pageText(doc) });
  attachFrame(doc, win, { id: o.id, kind: "page", win, gloss: key });
  void loadGlossary(key, false);
}

/** The board's own document, once: words highlighted in a card's text or a note's. `rootOf`: the lesson or page (its shape id) a
    card's chain of cards started on, whose glossary the card uses (a note uses the lesson's). */
export function attachBoard(win: Window, rootOf: (cardId: string) => string) {
  if (windows.has(win)) return;
  windows.add(win);
  const cardOf = (node: Node | null) => {
    const el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
    const text = el?.closest(".cv-card .cv-body, .cv-note .cv-note-doc");
    return text?.closest<HTMLElement>(".tl-shape")?.dataset.shapeId ?? null;
  };
  const kindOf = (node: Node | null): SourceKind => {
    const el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
    return el?.closest(".cv-note-doc") ? "note" : "card";
  };
  win.document.addEventListener("selectionchange", () => {
    const sel = win.getSelection();
    const id = sel?.rangeCount ? cardOf(sel.anchorNode) : null;
    if (!id || cardOf(sel!.focusNode) !== id) {
      // the board's selection went elsewhere (the tutor) or away: that only matters to a highlight made in a card or a note
      const was = state.shown && sources.get(state.shown.source)?.kind;
      if (was === "card" || was === "note") gone();
      return;
    }
    let src = sources.get(id);
    if (!src) sources.set(id, (src = { id, kind: kindOf(sel!.anchorNode), win, gloss: "" }));
    src.gloss = src.kind === "note" ? lessonKey : (sources.get(rootOf(id))?.gloss ?? lessonKey);
    onSelection(src);
  });
  listen(win.document, () => state.kept.filter((k) => sources.get(k.source)?.win === win));
}

function attachFrame(doc: Document, win: Window, src: Source) {
  sources.set(src.id, src);
  windows.add(win);
  const st = doc.createElement("style");
  st.textContent = FRAME_CSS;
  (doc.head ?? doc.documentElement).append(st);
  doc.addEventListener("selectionchange", () => {
    const sel = win.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      if (state.shown?.source === src.id) gone();
      return;
    }
    onSelection(src);
  });
  listen(doc, () => state.kept.filter((k) => k.source === src.id));
  paintTints();
}

/** A document's presses and the pointer over it: when a highlight is let go, and which kept words are under the pointer. */
function listen(doc: Document, keptHere: () => Kept[]) {
  doc.addEventListener("mousedown", () => (isDown = true));
  doc.addEventListener("mouseup", () => {
    isDown = false;
    setTimeout(keep, 0);
    // let go of words with no definition: ask about them now (while the mouse was down, the highlight was still being made)
    const s = state.shown;
    if (s?.none && !s.pending && !s.failed && mayAsk(s)) {
      clearTimeout(restTimer);
      restTimer = window.setTimeout(() => void writeLive(s), REST_MS);
    }
  });
  // the lab's sound starts on a press in its own window; a press in a page's frame has to start it too
  doc.addEventListener("pointerdown", () => isSoundOn() && setSoundOn(true), true);
  doc.addEventListener("pointermove", (e) => {
    if (e.buttons) return;
    const here = keptHere();
    const k = here.find((k) => Array.from(k.lock.getClientRects()).some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom));
    if (k) setHover(k);
    else if (state.hover && here.includes(state.hover)) setHover(null);
  });
}

/** A page's words as it reads: its main text, else all of it. */
const pageText = (doc: Document) => ((doc.querySelector(".page, main, article") as HTMLElement | null) ?? doc.body)?.innerText ?? "";

function gone() {
  stopWriting();
  if (state.shown) set({ shown: null });
}

/** The highlight as lib/gloss.ts takes it: its words, its paragraph's text and where in it the highlight stands. */
function highlightOf(range: Range, block: Element | null): Highlight {
  const text = range.toString();
  if (!block) return { text, around: text, start: 0, end: text.length, scope: "" };
  const around = block.textContent ?? "";
  const offset = (node: Node, i: number) => {
    const before = block.ownerDocument.createRange();
    before.selectNodeContents(block);
    before.setEnd(node, i); // a point before the paragraph collapses this to nothing: 0
    return Math.min(around.length, before.toString().length);
  };
  return { text, around, start: offset(range.startContainer, range.startOffset), end: offset(range.endContainer, range.endOffset), scope: scopeOf(block, around) };
}

/** A paragraph's key for the definitions written for it (lib/gloss.ts scopeKey), worked out once per paragraph. */
const scopes = new WeakMap<Element, string>();
function scopeOf(block: Element, text: string) {
  let k = scopes.get(block);
  if (k === undefined) scopes.set(block, (k = scopeKey(text)));
  return k;
}

/** The range of characters [start, end) of a paragraph's text. */
function rangeIn(block: Element, start: number, end: number): Range {
  const doc = block.ownerDocument;
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; at: number }[] = [];
  let length = 0;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    nodes.push({ node: n, at: length });
    length += n.data.length;
  }
  const point = (i: number, isEnd: boolean) => {
    const k = nodes.findLastIndex((n) => (isEnd ? n.at < i : n.at <= i));
    return [nodes[k].node, i - nodes[k].at] as const;
  };
  const r = doc.createRange();
  r.setStart(...point(start, false));
  r.setEnd(...point(end, true));
  return r;
}

function onSelection(src: Source) {
  const sel = src.win.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return gone();
  const range = sel.getRangeAt(0);
  const now = state.shown?.range;
  if (now && state.shown?.source === src.id && range.compareBoundaryPoints(Range.START_TO_START, now) === 0 && range.compareBoundaryPoints(Range.END_TO_END, now) === 0) return; // the same highlight
  const mine = range.cloneRange();
  const end = mine.endContainer.nodeType === 3 ? mine.endContainer.parentElement : (mine.endContainer as Element);
  // its paragraph, or for words outside one (a lesson's meta line, a table) the nearest cell, span or box around them
  const block = end?.closest(BLOCK) ?? end?.closest("td,th,dt,span,div") ?? null;
  const h = highlightOf(mine, block);
  if (h.text.trim().length < 2) return gone();
  stopWriting();
  const g = glossaries.get(src.gloss);
  // a linked lesson's glossary is written the first time words are highlighted in it (meanwhile they are defined live)
  if (g?.status === "none" && !g.web) void loadGlossary(src.gloss, true);
  const entries = g?.entries ?? [];
  const t0 = performance.now();
  // the highlight's whole words: what a definition written live is for, and kept under (a half word mid-drag is the whole word)
  const whole = wholeWords(h);
  const hit = matchFor(entries, h) ?? (whole.text !== h.text ? matchFor(entries, { ...h, ...whole }) : null);
  const lookupMs = performance.now() - t0;
  // the lock: the term where it stands, when it is found written in the paragraph; else the highlight
  const lock = hit && block && (hit.start !== h.start || hit.end !== h.end) ? rangeIn(block, hit.start, hit.end) : mine;
  if (hit && hit.entry.term !== state.shown?.term) hudSounds()?.boxHop(panOf(lock));
  const words = whole.text.replace(/\s+/g, " ").trim();
  const wholeLock = block && (whole.start !== h.start || whole.end !== h.end) ? rangeIn(block, whole.start, whole.end) : mine;
  const scope = typeof h.scope === "string" ? h.scope : "";
  const shown: Shown = hit
    ? { source: src.id, term: hit.entry.term, def: hit.entry.def, none: false, range: mine, lock, block, words, scope }
    : { source: src.id, term: label(words), def: "", none: true, range: mine, lock: wholeLock, block, words, scope };
  set({ lookupMs, hover: null, shown });
  // asked only once let go (see the mouseup in listen), or after a rest for a highlight made with the keys
  if (!hit && !isDown && mayAsk(shown)) restTimer = window.setTimeout(() => void writeLive(shown), REST_MS);
}

/** Whether words the glossary lacks may be defined live: not a long passage, and in a note only a few words (see the top). */
function mayAsk(s: Shown) {
  if (s.words.length > MAX_LIVE) return false;
  return sources.get(s.source)?.kind !== "note" || s.words.split(/\s+/).filter(Boolean).length <= NOTE_LIVE_WORDS;
}

/** Where a range is across its page, as a stereo position. */
const panOf = (r: Range) => {
  const width = r.startContainer.ownerDocument?.documentElement.clientWidth || 1;
  return Math.min(1, Math.max(-1, (r.getBoundingClientRect().left / width) * 2 - 1));
};

function stopWriting() {
  clearTimeout(restTimer);
  writing?.abort();
  writing = undefined;
}

const LIVE_SYSTEM =
  "You write the margin gloss a reader sees the moment they highlight words in what they are reading. Reply with one plain sentence of at most " +
  "22 words that says what the highlighted words mean in this passage. Start with the meaning itself: no preamble, never repeat the highlighted " +
  "words, no markdown, no LaTeX (write math as plain Unicode text).";

/** One line for a highlight the glossary doesn't cover, written now by the lab's text model (LAB_ROUTE: an OpenAI-style body in,
    an SSE stream of deltas out) and streamed into where the definition shows. */
async function writeLive(s: Shown) {
  if (state.shown?.range !== s.range) return;
  stopWriting();
  const src = sources.get(s.source);
  const g = src && glossaries.get(src.gloss);
  const ctrl = (writing = new AbortController());
  /** Onto the highlight, if it is still this one. */
  const show = (patch: Partial<Shown>) => state.shown?.range === s.range && set({ shown: { ...state.shown, ...patch } });
  show({ pending: true, failed: false });
  const wait: Sound | undefined = hudSounds()?.menuLoading(panOf(s.range));
  const words = s.words;
  const where = src?.kind === "card" ? "An explanation card" : src?.kind === "note" ? "The learner's note on a lesson" : g?.web ? "A web page" : "Lesson";
  let def = "";
  try {
    const res = await fetch(`${LAB_ROUTE}?course=${encodeURIComponent(g?.course ?? "")}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "lab", // the route calls the model picked in the Models tab, whatever is named here
        stream: true,
        reasoning_effort: "low",
        temperature: 0.2,
        max_completion_tokens: 120,
        messages: [
          { role: "system", content: LIVE_SYSTEM },
          { role: "user", content: `${where}: "${g?.title ?? ""}"\n\nPassage: ${(s.block?.textContent ?? words).replace(/\s+/g, " ").trim().slice(0, 1500)}\n\nHighlighted: "${words}"` },
        ],
      }),
    });
    if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.startsWith("data:") ? line.slice(5).trim() : "";
        if (!data || data === "[DONE]") continue;
        const delta = JSON.parse(data).choices?.[0]?.delta?.content as string | undefined;
        if (!delta) continue;
        if (!def) {
          wait?.stop();
          hudSounds()?.menuReady(panOf(s.range));
        }
        def += delta;
        show({ none: false, pending: false, asked: true, def: def.trimStart() });
      }
    }
    def = def.trim();
    if (!def) throw new Error("nothing came back");
    const entry = entryFor(words, def, s.scope);
    if (entry.key && g) {
      g.entries = [...g.entries.filter((e) => !(e.key === entry.key && e.scope === entry.scope)), entry];
      g.terms++;
      if (src.gloss === lessonKey) set({ terms: g.terms });
      // kept with its glossary, so these words cost nothing here again, on any later visit (when there is a paragraph to key it to)
      if (s.scope)
        void fetch("/api/gloss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ course: g.course, lesson: g.lesson, add: { words, scope: s.scope, def } }),
        }).catch(() => {});
    }
    if (!isDown && state.shown?.range === s.range) keep();
  } catch (e) {
    if (ctrl.signal.aborted) return;
    console.error("No live definition came back for the highlight.", e);
    hudSounds()?.menuFailed(panOf(s.range));
    show({ none: true, pending: false, failed: true });
  } finally {
    wait?.stop();
    if (writing === ctrl) writing = undefined;
  }
}

/** Letting go of a highlight that has a definition keeps it, in its place (once per term and paragraph). */
function keep() {
  const s = state.shown;
  if (!s || s.none || state.kept.some((k) => k.term === s.term && k.block === s.block)) return;
  set({ kept: [...state.kept, { source: s.source, term: s.term, def: s.def, lock: s.lock, block: s.block }] });
}

/** In each window with highlights: what was defined keeps a faint tint, the one showing now and the kept ones there. */
function paintTints() {
  for (const win of windows) {
    if (win.closed) {
      windows.delete(win);
      continue;
    }
    const reg = (win as unknown as { CSS: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const Hl = (win as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!reg || !Hl) continue;
    const here = (id: string) => sources.get(id)?.win === win;
    const tinted = [...state.kept.filter((k) => here(k.source)).map((k) => k.lock), ...(state.shown && !state.shown.none && here(state.shown.source) ? [state.shown.lock] : [])].filter(
      (r) => r.startContainer.isConnected,
    );
    if (tinted.length) reg.set(TINT, new Hl(...tinted));
    else reg.delete(TINT);
  }
}
