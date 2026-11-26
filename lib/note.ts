// Notes on the lesson canvas (components/canvas/shapes.tsx, "lesson-note"): a sticky note the learner
// writes in, with passages pulled in from the board as clips. A note is one document (TipTap's JSON):
// the learner's writing, the clips where they were dropped, a heading, and the text the model and the
// lab wrote, each run marked with who wrote it. From it the note makes a starting point (a TOPIC for the
// heading and a BRIDGE after the learner's last word, /api/note/opening) and launches the Steer live lab.
// These are its pure parts, kept free of tldraw and the DOM so `pnpm test` can run them
// (lib/note.test.mjs): every change made to a note from outside its editor is one of these functions.
// No imports: node --test loads this file as it is, so it can't resolve extensionless relative imports.

/** How much the lab leans on a clipped passage: the lab's own strength words, plus "ignore" (left out of the
    prompt entirely). "moderate" is the default. Kept in step with lib/lab/story/prompt.ts's ClipWeight, which
    this can't import without breaking the test runner. */
export type ClipWeight = "ignore" | "slight" | "moderate" | "strong";
export const DEFAULT_WEIGHT: ClipWeight = "moderate";

/** What a clip's dial in the lab writes back: a weight on the scale, or a `use` the learner picked from the model's suggested
    ways to use the passage. Exactly one is set; setting one clears the other. Kept in step with lib/lab/story/prompt.ts. */
export type ClipSteer = { weight?: ClipWeight; use?: string };

/** A passage pulled into a note. It is found again the way a card's highlight is (by its text, nearest
    its place in what it came from), so it keeps the same things a card does. */
export type Clip = {
  id: string; // stable within its note: its mark's key
  quote: string; // the passage, as highlighted
  where: string; // a short label for where it came from: the lesson's section, the linked page's title, or the card's term
  around: string; // the paragraph around it
  heading: string; // the nearest heading above it (in a card, the card's term)
  card: string; // the bare id of the card it was highlighted in, "" = not in a card
  page: string; // not in a card: the bare id of the linked page it is on, "" = the lesson
  relX: number; // its end, from the top-left of the card or of the page's content (as a card's relX / relY)
  relY: number;
  thread?: string; // taken from a tutor answer: its thread's id (then card, page, relX and relY are unused)
  weight?: ClipWeight; // how much the lab leans on it; absent = the default (moderate)
  use?: string; // a model-suggested way to use this passage, picked from the lab's dial; takes the place of the weight when set
};

// ---- the document ----
// Blocks: "heading" (the first block, when it is one, is the lab's topic), "paragraph", and whatever
// else the editor makes (lists, quotes), whose paragraphs are read in order. Inline: text, and "clip"
// (an atom holding a Clip). A text run written by the model or the lab carries the "author" mark,
// { by: "model" | "lab", run }: run tells one lab session's text from another's. No mark: the learner's.

export type DocMark = { type: string; attrs?: Record<string, unknown> };
export type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string; marks?: DocMark[] };
export type By = "model" | "lab";

export const CLIP = "clip";
export const AUTHOR = "author";

/** A note shape's props. */
export type NoteProps = {
  w: number;
  h: number;
  sized: boolean; // the learner set its height: keep it instead of fitting its content
  doc: DocNode; // everything in it, as TipTap's JSON
  createdAt: number;
};

/** What a clip tells the model, and later the lab, about a passage. */
export type Source = { quote: string; where: string; around: string; weight?: ClipWeight; use?: string };

/** A clip's weight, the default (moderate) until the learner sets one. */
export function clipWeightOf(clip: Pick<Clip, "weight">): ClipWeight {
  return clip.weight ?? DEFAULT_WEIGHT;
}

/** The note with one clip's steer set: its weight, or the `use` the learner picked, with the other cleared (a clip carries one or
    the other, never both). Unchanged (same reference) when no clip has that id, or it already carries that same steer. */
export function setClipSteer(doc: DocNode, id: string, steer: ClipSteer): DocNode {
  let changed = false;
  const map = (n: DocNode): DocNode => {
    if (isClip(n) && (n.attrs as Clip).id === id) {
      const c = n.attrs as Clip;
      const use = steer.use && steer.use.trim() ? steer.use.trim() : undefined;
      const weight = use ? undefined : steer.weight;
      if ((c.weight ?? undefined) === (weight ?? undefined) && (c.use ?? undefined) === (use ?? undefined)) return n;
      changed = true;
      const attrs = { ...n.attrs };
      delete (attrs as Partial<Clip>).weight;
      delete (attrs as Partial<Clip>).use;
      if (weight) (attrs as Clip).weight = weight;
      if (use) (attrs as Clip).use = use;
      return { ...n, attrs };
    }
    if (!n.content) return n;
    const content = n.content.map(map);
    return content.some((c, i) => c !== n.content![i]) ? { ...n, content } : n;
  };
  const out = map(doc);
  return changed ? out : doc;
}

export const NOTE_W = 420; // about 45 characters a line at the lesson's text size
export const NOTE_H = 180; // a note's height before its content has been measured

const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/** Whether two clips are the same passage: the same words from the same lesson, page or card. */
export function sameClip(a: Pick<Clip, "quote" | "card" | "page" | "thread">, b: Pick<Clip, "quote" | "card" | "page" | "thread">): boolean {
  return a.card === b.card && a.page === b.page && (a.thread ?? "") === (b.thread ?? "") && norm(a.quote) === norm(b.quote);
}

/** A passage selected in a tutor answer (components/TutorPanel.tsx), on its way into a note. */
export type TutorBit = {
  quote: string; // the words selected, maths as $TeX$
  answer: string; // the whole answer they are in
  asked: string; // the lesson passage the tutor was asked about
  heading: string; // the lesson's section that passage is in
  thread: string; // the tutor thread, which ↗ on the clip opens again
};

/** The clipboard type a copy in a tutor answer carries, so pasting it into a note makes a clip. */
export const TUTOR_MIME = "application/x-attention-tutor";

/** A tutor passage as a clip: labelled by what was asked, with the answer as what is around it. */
export function clipFromTutor(b: TutorBit, id: string): Clip {
  const asked = b.asked.replace(/\s+/g, " ").trim();
  return {
    id,
    quote: b.quote.replace(/\s+/g, " ").trim(),
    where: `Tutor on “${asked.length > 48 ? `${asked.slice(0, 47).trimEnd()}…` : asked}”`,
    around: b.answer.slice(0, 1200),
    heading: b.heading,
    card: "",
    page: "",
    relX: 0,
    relY: 0,
    thread: b.thread,
  };
}

/** A passage selected in a board-chat reply (components/canvas/BoardChat.tsx), on its way into a note. */
export type ChatBit = {
  quote: string; // the words selected, maths as $TeX$
  answer: string; // the whole reply they are in
  asked: string; // the message that drew the reply
  heading: string; // the lesson section they were reading, when there was one
};

/** The sentinel a chat clip carries in place of a thread: it has no board source (so it is kept out of the
    lesson's marks), and its ↗ reopens the chat sheet rather than a tutor thread or a card. */
export const CHAT_THREAD = "chat";

/** A chat passage as a clip: labelled by the message it answered, with the whole reply as what is around it. */
export function clipFromChat(b: ChatBit, id: string): Clip {
  const asked = b.asked.replace(/\s+/g, " ").trim();
  return {
    id,
    quote: b.quote.replace(/\s+/g, " ").trim(),
    where: asked ? `Chat · “${asked.length > 48 ? `${asked.slice(0, 47).trimEnd()}…` : asked}”` : "Chat",
    around: b.answer.slice(0, 1200),
    heading: b.heading,
    card: "",
    page: "",
    relX: 0,
    relY: 0,
    thread: CHAT_THREAD,
  };
}

/** Text that carries on from `before`: a space between, none before punctuation (or after nothing). */
export function splitStart(draft: string, bridge: string): [mine: string, made: string] {
  const d = draft.trimEnd();
  const b = bridge.trim();
  if (!d || !b) return [d, b];
  return [d, /^[,.;:!?)\]}’”]/.test(b) ? b : ` ${b}`];
}

/** What a lab has written past `prefix` (the note's heading and starting text, which it starts with):
    its text without the prefix's words. By words, as the lab counts them, so line breaks don't matter. */
export function labRest(text: string, prefix: string): string {
  const n = prefix.match(/\S+/g)?.length ?? 0;
  return text.replace(new RegExp(`^(?:\\s*\\S+){${n}}`), "").trim();
}

export const emptyDoc = (): DocNode => ({ type: "doc", content: [{ type: "paragraph" }] });

const authorOf = (n: DocNode) => n.marks?.find((m) => m.type === AUTHOR)?.attrs as { by?: By; run?: string | null } | undefined;
const text = (t: string, by?: By, run?: string): DocNode =>
  by ? { type: "text", text: t, marks: [{ type: AUTHOR, attrs: { by, run: run ?? null } }] } : { type: "text", text: t };
const para = (content: DocNode[] = []): DocNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const heading = (t: string, by?: By): DocNode => ({ type: "heading", attrs: { level: 1 }, ...(t ? { content: [text(t, by)] } : {}) });
const clipNode = (c: Clip): DocNode => ({ type: CLIP, attrs: { ...c } });
const blocks = (doc: DocNode) => doc.content ?? [];
/** A paragraph that holds clips and nothing else to type beside. */
const clipsOnly = (b: DocNode | undefined) => b?.type === "paragraph" && !!b.content?.length && b.content.every((n) => isClip(n) || (isText(n) && !n.text!.trim()));
/** The document with these blocks, always ending in somewhere to write: never no block at all, and an
    empty paragraph after a last line of clips alone (a clip fills its line, so the caret has no room beside it). */
const withBlocks = (doc: DocNode, content: DocNode[]): DocNode => {
  const bs = content.length ? content : [para()];
  return { ...doc, content: clipsOnly(bs.at(-1)) ? [...bs, para()] : bs };
};
const isText = (n: DocNode) => n.type === "text";
const isClip = (n: DocNode) => n.type === CLIP;
/** A block whose content is inline: text, clips, breaks. */
const inline = (b: DocNode) => b.type === "paragraph" || b.type === "heading";

/** Every node, depth first. */
function* walk(n: DocNode): Generator<DocNode> {
  yield n;
  for (const c of n.content ?? []) yield* walk(c);
}

/** The clips in the note, in reading order. */
export function docClips(doc: DocNode): Clip[] {
  return [...walk(doc)].filter(isClip).map((n) => n.attrs as Clip);
}

/** The note's topic: the text of its first block when that is a heading. */
export function docTopic(doc: DocNode): string {
  const first = blocks(doc)[0];
  return first?.type === "heading" ? inlineText(first, true) : "";
}

/** An inline block's text. A clip inside the learner's sentence is read as part of it, as a quotation;
    a clip on a line of its own is a source, not text (`quoteAlone` reads it anyway). */
function inlineText(b: DocNode, quoteAlone = false): string {
  const parts = b.content ?? [];
  const alone = !parts.some((n) => isText(n) && n.text!.trim());
  if (alone && !quoteAlone) return "";
  return parts
    .map((n) => (isText(n) ? n.text! : isClip(n) ? ` “${(n.attrs as Clip).quote}” ` : n.type === "hardBreak" ? "\n" : ""))
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** The inline blocks under a node, in order. */
const inlineBlocks = (n: DocNode): DocNode[] => [...walk(n)].filter(inline);

/** The text after the topic, a blank line between paragraphs: what the lab starts from and carries on. */
export function docBody(doc: DocNode): string {
  const bs = blocks(doc);
  const rest = bs[0]?.type === "heading" ? bs.slice(1) : bs;
  return rest.flatMap(inlineBlocks).map((b) => inlineText(b)).filter(Boolean).join("\n\n");
}

/** All of the note as plain text, clips included (tldraw's text of the shape: search, copy). */
export function docPlain(doc: DocNode): string {
  return inlineBlocks(doc).map((b) => inlineText(b, true)).filter(Boolean).join("\n\n");
}

/** Whether any text in the note was written by one of `bys`. */
export function hasAuthored(doc: DocNode, bys: By[]): boolean {
  return [...walk(doc)].some((n) => isText(n) && bys.includes(authorOf(n)?.by as By));
}

/** The note without the text `drop` picks out; a block left empty by that goes too (one the learner
    left empty stays). Always at least one paragraph. */
function dropText(doc: DocNode, drop: (n: DocNode) => boolean): DocNode {
  const prune = (n: DocNode): DocNode | null => {
    if (!n.content) return n;
    const kept = n.content.filter((c) => !(isText(c) && drop(c))).map(prune).filter((c): c is DocNode => !!c);
    if (kept.length === n.content.length && kept.every((c, i) => c === n.content![i])) return n;
    if (!kept.length && n.type !== "doc") return null;
    return { ...n, content: kept };
  };
  return withBlocks(doc, blocks(prune(doc) ?? emptyDoc()));
}

/** The note without what `bys` wrote: "New starting point" starts over from the learner's own text. */
export function dropAuthored(doc: DocNode, bys: By[]): DocNode {
  return dropText(doc, (n) => bys.includes(authorOf(n)?.by as By));
}

/** The note without what one lab session (`run`) wrote: that session writes it again as it goes. */
export function dropRun(doc: DocNode, run: string): DocNode {
  return dropText(doc, (n) => authorOf(n)?.run === run);
}

/** Text added at the end of the note by `by`: its first paragraph carries on from the last paragraph
    that has text in it (a space between, none before punctuation), its others are paragraphs of their own. */
export function appendText(doc: DocNode, add: string, by: By, run?: string): DocNode {
  const pieces = add.split(/\n+/).map((t) => t.trim()).filter(Boolean);
  if (!pieces.length) return doc;
  const bs = [...blocks(doc)];
  const last = bs.at(-1);
  const lastText = last?.type === "paragraph" ? inlineText(last) : "";
  let first = pieces.shift()!;
  if (last?.type === "paragraph" && lastText) {
    const endsInSpace = /\s$/.test(last.content!.map((n) => (isText(n) ? n.text : "x")).join(""));
    if (!endsInSpace) first = splitStart(lastText, first)[1];
    bs[bs.length - 1] = { ...last, content: [...last.content!, text(first, by, run)] };
  } else if (last?.type === "paragraph" && !last.content?.length) bs[bs.length - 1] = para([text(first, by, run)]);
  else bs.push(para([text(first, by, run)]));
  for (const t of pieces) bs.push(para([text(t, by, run)]));
  return withBlocks(doc, bs);
}

/** A starting point in the note: the model's topic as its heading when it has none (or an empty one),
    and its bridge after the learner's last word. */
export function withStart(doc: DocNode, topic: string, bridge: string): DocNode {
  let bs = [...blocks(doc)];
  if (!docTopic(doc) && topic.trim()) {
    if (bs[0]?.type === "heading") bs = bs.slice(1);
    bs.unshift(heading(topic.trim(), "model"));
  }
  return appendText(withBlocks(doc, bs), bridge, "model");
}

/** A new note's document: a heading (the learner's, "" = none) and its clips, a paragraph each. */
export function startDoc(topic: string, clips: Clip[]): DocNode {
  return withBlocks({ type: "doc" }, [...(topic.trim() ? [heading(topic.trim())] : []), ...clips.map((c) => para([clipNode(c)]))]);
}

/** Where in a note a clip goes: into the inline block at `block` (counting the note's top-level blocks),
    `offset` positions into it as the editor counts them (a character, or an atom, is one). */
export type At = { block: number; offset: number };

/** The note with a clip in it, unless it already has that passage (then unchanged). Dropped in a
    paragraph (at), it goes where it was dropped; on a heading, just under it; else at the end, a
    paragraph of its own (taking the place of an empty last paragraph). */
export function insertClip(doc: DocNode, clip: Clip, at?: At): DocNode {
  if (docClips(doc).some((c) => sameClip(c, clip))) return doc;
  const bs = [...blocks(doc)];
  const target = at ? bs[at.block] : undefined;
  if (at && target?.type === "paragraph") {
    const out: DocNode[] = [];
    let left = at.offset;
    let put = false;
    for (const n of target.content ?? []) {
      const size = isText(n) ? n.text!.length : 1;
      if (!put && left < size && isText(n) && left > 0) {
        out.push({ ...n, text: n.text!.slice(0, left) }, clipNode(clip), { ...n, text: n.text!.slice(left) });
        put = true;
      } else {
        if (!put && left <= 0) {
          out.push(clipNode(clip));
          put = true;
        }
        out.push(n);
      }
      left -= size;
    }
    if (!put) out.push(clipNode(clip));
    bs[at.block] = para(out);
    return withBlocks(doc, bs);
  }
  if (at && target?.type === "heading") {
    bs.splice(at.block + 1, 0, para([clipNode(clip)]));
    return withBlocks(doc, bs);
  }
  const last = bs.at(-1);
  if (last?.type === "paragraph" && !last.content?.length) bs[bs.length - 1] = para([clipNode(clip)]);
  else bs.push(para([clipNode(clip)]));
  return withBlocks(doc, bs);
}

/** The note without a clip; a paragraph that held only it goes too. */
export function removeClip(doc: DocNode, id: string): DocNode {
  const prune = (n: DocNode): DocNode | null => {
    if (!n.content) return n;
    const kept = n.content.filter((c) => !(isClip(c) && (c.attrs as Clip).id === id)).map(prune).filter((c): c is DocNode => !!c);
    if (kept.length === n.content.length && kept.every((c, i) => c === n.content![i])) return n;
    if (!kept.length && n.type !== "doc") return null;
    return { ...n, content: kept };
  };
  return withBlocks(doc, blocks(prune(doc) ?? emptyDoc()));
}

// ---- the lab, paused on its note ----
// Closing a note's lab pauses it: what it showed is kept on the note (meta.lab, as the lab reports
// it), and opening it again picks up there, as long as the note's own text is as the lab started from.

/** A note's lab as the note keeps it: `run`, which of the note's lab text is this lab's (dropRun);
    `start`, what it carried on from; `state`, what it showed (lib/lab/lab.ts LabState, kept as it is). */
export type SavedLab<S extends { text: string } = { text: string }> = { run: string; start: string; state: S };

/** Whether loose JSON (a shape's meta) is a saved lab. */
export function isSavedLab(v: unknown): v is SavedLab {
  const l = v as SavedLab | null;
  return !!l && typeof l === "object" && typeof l.run === "string" && typeof l.start === "string" && typeof l.state?.text === "string";
}

/** What a lab opening on a note carries on from, and which run of text is its. The saved lab's run
    and start when the note, without that run's text, still starts the same: the lab picks up where
    it stopped, its own text no longer fixed. Otherwise (never opened, or the learner changed what it
    started from) a new run from all of the note as it is. prefixOf: the start a document gives. */
export function labStart(doc: DocNode, saved: SavedLab | undefined, prefixOf: (doc: DocNode) => string, newRun: string): { run: string; start: string } {
  if (saved && prefixOf(dropRun(doc, saved.run)) === saved.start) return { run: saved.run, start: saved.start };
  return { run: newRun, start: prefixOf(doc) };
}

/** What a lab opening as `run` from `start` resumes: all the saved lab showed when it is the same
    lab, else only its dials (without its text the lab starts over, and drops the pinned ones). */
export function labResume<S extends { text: string }>(saved: SavedLab<S> | undefined, run: string, start: string): Partial<S> | undefined {
  if (!saved) return undefined;
  if (saved.run === run && saved.start === start) return saved.state;
  const rest: Partial<S> = { ...saved.state };
  delete rest.text;
  return rest;
}

// ---- notes saved before the document ----

/** A note's props before it was one document. */
export type OldNoteProps = {
  w: number; h: number; sized: boolean; draft: string; clips: Clip[]; topic: string; text: string;
  made: { topic: string; draft: string; bridge: string } | null; ran?: string; createdAt: number;
};

const lines = (t: string) => t.split(/\n+/).map((l) => l.trim()).filter(Boolean);

/** An old note as a document, nothing lost: its heading (the model's while still as made), its clips
    in order, the learner's draft (when a starting point was made from a draft since changed, both),
    the starting text (its bridge the model's while still as made), then what the lab wrote. */
export function noteFromOld(p: OldNoteProps): NoteProps {
  const made = p.made;
  const topic = (p.topic ?? "").trim();
  let doc = withBlocks({ type: "doc" }, [
    ...(topic ? [heading(topic, made && topic === made.topic.trim() ? "model" : undefined)] : []),
    ...(p.clips ?? []).map((c) => para([clipNode(c)])),
  ]);
  const mine = (t: string) => (doc = withBlocks(doc, [...blocks(doc).filter((b) => !(b.type === "paragraph" && !b.content?.length)), ...lines(t).map((l) => para([text(l)]))]));
  const draft = p.draft ?? "";
  if (made && p.text.trim()) {
    if (draft.trim() && draft.trim() !== made.draft.trim()) mine(draft);
    const [d, b] = splitStart(made.draft, made.bridge);
    if (p.text === d + b) {
      mine(d);
      doc = appendText(doc, b, "model");
    } else mine(p.text);
  } else mine(draft);
  if (p.ran?.trim()) doc = appendText(doc, p.ran, "lab");
  return { w: p.w, h: p.h, sized: p.sized, doc, createdAt: p.createdAt };
}

/** Whether a saved board holds a note from before the document (one a load converts). */
export function hasOldNotes(board: unknown): boolean {
  const recs = (board as { store?: Record<string, { typeName?: string; type?: string; props?: Record<string, unknown> }> } | undefined)?.store ?? {};
  return Object.values(recs).some((r) => r?.typeName === "shape" && r.type === "lesson-note" && r.props && !("doc" in r.props));
}

// ---- the opening call (/api/note/opening) ----

export type OpeningInput = { course: string; lesson: string; clips: Source[]; draft: string };

const cap = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** A request body as an OpeningInput (strings capped, at most 12 clips), or null if it isn't one. */
export function readOpening(body: unknown): OpeningInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.clips) || typeof b.draft !== "string") return null;
  const clips = b.clips
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({ quote: cap(c.quote, 6000), where: cap(c.where, 160), around: cap(c.around, 1200) })) // a clip can be paragraphs long
    .filter((c) => c.quote)
    .slice(0, 12);
  const draft = b.draft.trim().slice(0, 6000); // its own line breaks kept
  if (!clips.length && !draft) return null;
  return { course: cap(b.course, 160), lesson: cap(b.lesson, 200), clips, draft };
}

export const OPENING_SYSTEM = `You write the opening of a live explanation that a learner will steer. They give you:
LESSON: the course and lesson they are reading.
CLIPS: passages they pulled from it, each with where it came from and the paragraph around it.
DRAFT: their own writing so far. It may be empty, and it may stop mid-sentence.

The DRAFT is the learner's own words. Never rewrite, repeat, correct, summarise or quote it: the app shows it unchanged, and your BRIDGE is placed straight after its last word.

Reply with exactly two lines and nothing else:
TOPIC: one heading line naming what the explanation is about, at most 12 words, no full stop
BRIDGE: the continuation

If the DRAFT has text, BRIDGE is 1 to 3 sentences that carry on from its last word (finish its sentence first if it stops mid-sentence), in the learner's voice and person, and tie in what the CLIPS say. BRIDGE starts with the word that comes next: never with any of the DRAFT's own words.
If the DRAFT is empty, BRIDGE is 2 to 3 opening sentences drawn from the CLIPS.
Plain text only: no markdown, no lists, no quotation marks around either line.`;

/** The opening call's messages: the rules, then the LESSON, CLIPS and DRAFT blocks. */
export function openingMessages(o: OpeningInput): { role: "system" | "user"; content: string }[] {
  const clips = o.clips.length
    ? o.clips.map((c, i) => `${i + 1}. "${c.quote}"\n   From: ${c.where || "the lesson"}\n   Around it: ${c.around || c.quote}`).join("\n\n")
    : "(none)";
  const user = `LESSON\n${[o.course, o.lesson].filter(Boolean).join(" · ") || "(untitled)"}\n\nCLIPS\n${clips}\n\nDRAFT\n${o.draft || "(empty)"}`;
  return [
    { role: "system", content: OPENING_SYSTEM },
    { role: "user", content: user },
  ];
}

const unwrap = (s: string) => s.replace(/^[\s*_"“”']+|[\s*_"“”']+$/g, "");

/** A line's label: "Topic:" in any case, or the capitalised label with a dash or only a space after it
    ("TOPIC Reading on demand", which the model writes now and then). Without a colon only TOPIC counts,
    so a reply that merely starts with the word ("Topics like…") is not taken for a label. */
const label = (name: string) => {
  const anyCase = [...name].map((c) => `[${c.toUpperCase()}${c.toLowerCase()}]`).join("");
  return `(?:^|\\n)[\\s*_#]*(?:${anyCase}[\\s*_]*:|${name.toUpperCase()}\\b[\\s*_]*[-–—]?)\\s*`;
};
const TOPIC_LINE = new RegExp(`${label("topic")}(.*)`);
const BRIDGE_LINE = new RegExp(`${label("bridge")}([\\s\\S]*)`);

/** The model's reply as { topic, bridge }, or null if it has neither. */
export function parseOpening(raw: string): { topic: string; bridge: string } | null {
  const text = raw.replace(/\r/g, "");
  const t = TOPIC_LINE.exec(text);
  const b = BRIDGE_LINE.exec(text);
  // the model often leaves BRIDGE's label off: then the bridge is whatever follows the topic's line
  const bridge = b ? b[1] : t ? text.slice(t.index + t[0].length) : "";
  const out = { topic: unwrap(t?.[1] ?? "").replace(/\.$/, ""), bridge: unwrap(bridge.replace(/\s+/g, " ")) };
  return out.topic || out.bridge ? out : null;
}

const word = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** The bridge without the draft it repeats at its start. The model sometimes echoes the draft, or its
    last words, before carrying on; the longest run of the draft's closing words (three or more, or
    all of a shorter draft) that the bridge opens with is cut, case and punctuation aside. */
export function dropEcho(draft: string, bridge: string): string {
  const d = draft.trim().split(/\s+/).filter(Boolean).map(word);
  const b = bridge.trim().split(/\s+/).filter(Boolean);
  for (let n = Math.min(d.length, b.length); n >= Math.min(3, d.length) && n > 0; n--)
    if (d.slice(-n).every((w, i) => w === word(b[i]))) return b.slice(n).join(" ");
  return b.join(" ");
}

// ---- pinning a note to the screen ----
// A pinned note stays where it is on the screen while the board scrolls under it, so it can be read
// beside any part of the lesson. Zooming out well past the zoom it was pinned at (to look over the
// board) unpins it, and it stays on the board where it then is. The pin lives in the note's meta.

/** Where a pinned note's top-left corner sits on the screen (px from the board's top-left), and the zoom it was pinned at. */
export type Pin = { x: number; y: number; z: number };
type Camera = { x: number; y: number; z: number };

/** Below this share of the zoom a note was pinned at, it unpins. */
export const UNPIN_BELOW = 0.6;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isPin = (v: unknown): v is Pin =>
  !!v && typeof v === "object" && finite((v as Pin).x) && finite((v as Pin).y) && finite((v as Pin).z) && (v as Pin).z > 0;

/** The pin for a note at board point `at`, under camera `c` (tldraw's: screen = (board + camera) × zoom). */
export function pinOf(at: { x: number; y: number }, c: Camera): Pin {
  return { x: (at.x + c.x) * c.z, y: (at.y + c.y) * c.z, z: c.z };
}

/** Where a pinned note goes on the board under camera `c`, or null once that camera has zoomed out far enough to unpin it. */
export function pinnedAt(pin: Pin, c: Camera): { x: number; y: number } | null {
  if (c.z < pin.z * UNPIN_BELOW - 1e-9) return null;
  return { x: pin.x / c.z - c.x, y: pin.y / c.z - c.y };
}
