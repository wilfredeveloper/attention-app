// The lesson canvas is a tldraw board (components/LessonCanvas.tsx). These are its pure parts,
// kept free of tldraw so `pnpm test` can run them: where a new card goes, and the bridge to the
// saved file's older shape. The file keeps `cards` and `pages` in that older shape next to the
// board, because /api/cards, lib/asks.ts and scripts/digest.mjs read cards from it.

export type Status = "idle" | "streaming" | "done" | "error";
export type Recall = { step: "ask" | "had" | "done"; q?: string; had?: boolean };
export type From = { lesson: string; card: string; createdAt?: number };

/** A card as the saved file has always held it (ids are bare, not tldraw's "shape:" ids). */
export type LegacyCard = {
  id: string;
  parentId: string | null; // null = opened from a page (the lesson, or the linked page in `page`)
  page?: string;
  term: string;
  context: string;
  trail: string[];
  x: number;
  y?: number;
  relX: number; // the highlight, relative to the top-left of what it was opened from
  relY: number;
  level: number;
  parts: string[];
  status: Status[];
  w?: number;
  h?: number;
  createdAt?: number;
  from?: From;
  recall?: Recall;
};
/** A linked page as the saved file has always held it. y is the top of its content (the bar sits above). */
export type LegacyPage = {
  id: string; src: string; href?: string; title: string; x: number; y: number; jump?: string;
  from?: string; relX?: number; relY?: number; collapsed?: boolean;
};

export const LESSON_W = 880;
export const PAGE_W = LESSON_W;
export const CARD_W = 360;
export const MECH_W = 440; // "How it works" and deeper hold formulas and worked examples: give them room
export const GAP_X = 90;
export const GAP_Y = 16;
export const BAR_H = 34; // a linked page's or the lab's title bar, above its content
export const CARD_H = 120; // a card's height before its text has been measured

export const cardW = (level: number) => (level >= 3 ? MECH_W : CARD_W);
export const shapeId = (bare: string) => `shape:${bare}`;
export const bareId = (id: string) => id.replace(/^shape:/, "");

export type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The first y at or below `want` where a w x h box at x clears every rect (with GAP_Y between). */
export function freeY(x: number, want: number, w: number, h: number, taken: Rect[]): number {
  let y = want;
  for (let moved = true; moved; ) {
    moved = false;
    for (const r of taken)
      if (overlaps({ x, y, w, h: h + GAP_Y }, r)) {
        y = r.y + r.h + GAP_Y;
        moved = true;
      }
  }
  return y;
}

/** Where saved cards and pages go on the board. Cards never dragged had no y (they stacked in
    their column as they were laid out); they get one here the same way: parents first, top to
    bottom, each below the last one in its column. Page y here is the top of its bar. */
export function placeLegacy(cards: LegacyCard[], pages: LegacyPage[]): { cards: (LegacyCard & { y: number })[]; pages: LegacyPage[] } {
  const pageY = new Map(pages.map((p) => [p.id, p.y]));
  const ys = new Map<string, number>();
  const cols = new Map<number, number>(); // column x -> next free y
  let pending = cards.slice();
  while (pending.length) {
    const ready = pending.filter((c) => !c.parentId || ys.has(c.parentId) || !cards.some((p) => p.id === c.parentId));
    if (!ready.length) break;
    const want = (c: LegacyCard) => (c.parentId ? (ys.get(c.parentId) ?? 0) : (c.page ? (pageY.get(c.page) ?? 0) : 0)) + c.relY - 24;
    ready.sort((a, b) => want(a) - want(b));
    for (const c of ready) {
      const y = c.y ?? Math.max(want(c), cols.get(c.x) ?? -Infinity);
      ys.set(c.id, y);
      if (c.y === undefined) cols.set(c.x, y + (c.h ?? CARD_H) + GAP_Y);
    }
    pending = pending.filter((c) => !ys.has(c.id));
  }
  return {
    cards: cards.map((c) => ({ ...c, y: ys.get(c.id) ?? c.y ?? c.relY })),
    pages: pages.map((p) => ({ ...p, y: p.y - BAR_H })),
  };
}

/** A card shape's props, as LessonCanvas keeps them. */
export type CardProps = {
  w: number;
  h: number;
  term: string;
  context: string;
  trail: string[];
  parent: string; // the bare id of the card it was opened from, "" = opened from a page
  page: string; // with no parent: the bare id of the linked page it was opened from, "" = the lesson
  relX: number;
  relY: number;
  level: number;
  parts: string[];
  status: Status[];
  sized: boolean; // the reader set its height: keep it instead of fitting its text
  fixedW?: boolean; // the reader set its width (its height still fits its text unless sized)
  createdAt: number;
  from: From | null;
  recall: Recall | null;
};

/** The saved-file form of a card shape (x, y: its top-left on the board). */
export function toLegacyCard(id: string, x: number, y: number, p: CardProps): LegacyCard {
  return {
    id: bareId(id),
    parentId: p.parent || null,
    ...(!p.parent && p.page ? { page: p.page } : {}),
    term: p.term,
    context: p.context,
    trail: p.trail,
    x,
    y,
    relX: p.relX,
    relY: p.relY,
    level: p.level,
    parts: p.parts,
    status: p.status,
    ...(p.sized ? { w: p.w, h: p.h } : p.fixedW ? { w: p.w } : {}),
    ...(p.createdAt ? { createdAt: p.createdAt } : {}),
    ...(p.from ? { from: p.from } : {}),
    ...(p.recall ? { recall: p.recall } : {}),
  };
}

/** A saved card as card shape props. */
export function fromLegacyCard(c: LegacyCard): CardProps {
  return {
    w: c.w ?? cardW(c.level),
    h: c.h ?? CARD_H,
    term: c.term,
    context: c.context ?? "",
    trail: c.trail ?? [],
    parent: c.parentId ?? "",
    page: c.parentId ? "" : (c.page ?? ""),
    relX: c.relX,
    relY: c.relY,
    level: c.level,
    parts: [0, 1, 2, 3].map((i) => c.parts?.[i] ?? ""),
    status: [0, 1, 2, 3].map((i) => c.status?.[i] ?? "idle"),
    sized: c.w !== undefined && c.h !== undefined,
    ...(c.w !== undefined && c.h === undefined ? { fixedW: true } : {}),
    createdAt: c.createdAt ?? 0,
    from: c.from ?? null,
    recall: c.recall ?? null,
  };
}

/** A saved board as the file and the browser's copy hold it. */
export type Saved = { savedAt?: number; cards?: LegacyCard[]; pages?: LegacyPage[]; board?: unknown };

/** When a saved board was last saved: its `savedAt`, or for one saved before boards were stamped, the
    newest `createdAt` of any shape on it (a card or a note made later means a later save). 0 = unknown. */
export function savedTime(s: Saved | null): number {
  if (!s) return 0;
  if (typeof s.savedAt === "number") return s.savedAt;
  const recs = (s.board as { store?: Record<string, { typeName?: string; props?: { createdAt?: unknown } }> } | undefined)?.store ?? {};
  let t = 0;
  for (const r of Object.values(recs)) if (r?.typeName === "shape" && typeof r.props?.createdAt === "number") t = Math.max(t, r.props.createdAt);
  for (const c of s.cards ?? []) if (typeof c.createdAt === "number") t = Math.max(t, c.createdAt);
  return t;
}

/** Which copy a board opens from: the newer of the file and the browser's copy, the file on a tie. The
    browser's copy can be the newer one when the file could not be written (the app ran where it could
    not reach the learning folder), and opening the file then would drop what was made meanwhile. */
export function newerSave(file: Saved | null, local: Saved | null): Saved | null {
  if (!file || !local) return file ?? local;
  return savedTime(local) > savedTime(file) ? local : file;
}

/** Text a load can resume from: finished levels stay, anything cut off mid-stream starts again. */
export function settle(p: Pick<CardProps, "parts" | "status">): Pick<CardProps, "parts" | "status"> {
  return {
    parts: p.parts.map((t, i) => (p.status[i] === "done" ? t : "")),
    status: p.status.map((s) => (s === "done" ? "done" : "idle")),
  };
}
