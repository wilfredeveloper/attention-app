"use client";

// The lesson view: the lesson on a tldraw board (draw, shapes, arrows, text, Space to pan, the usual
// shortcuts), with the app's own shapes on it (components/canvas/shapes.tsx). Highlighting text (in
// the lesson or in any card) offers Explore, Ask, Steer live and → Note. In the lesson the highlight is also
// defined at once, in the margin, and a knob with a fan of handles stands in for the bar (the HUD:
// components/canvas/LessonHud.tsx). Explore opens a card beside it,
// joined by an arrow; zooming into a card deepens it through four levels: definition, plain words,
// mechanism, drawing. Each level streams from /api/explain, and the next level is fetched ahead of
// the zoom. Ask puts the highlight to the tutor in the margin (Simple / Mid / Deep). A link to another
// lesson, cheat sheet or site opens that page beside the lesson on the board. A note (N, or a
// double-click on an empty spot) is for the learner's own writing; → Note clips a highlight into it
// (or the highlight is dragged onto a note, carryPick), and from a note's clips and writing the note
// turns into the live lab, in its place on the board (launchNote). Steer live on a highlight makes a
// note of that phrase and launches it at once.
//
// The board is saved as learning/<course>/app-data/canvas/<lesson>.json: `board` is tldraw's
// document, and `cards` / `pages` keep their older shape for the readers of that file (lib/board.ts).

import Link from "next/link";
import dynamic from "next/dynamic";
import type { Features } from "@/lib/features";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import "katex/dist/katex.min.css";
import { createShapeId, getSnapshot, useValue, type Editor, type TLEventInfo, type TLShape, type TLShapeId, type TLShapePartial } from "tldraw";
import type { Editor as TipTap } from "@tiptap/core";
import { logEvent, logSteer, useDwell, useLessonMessages } from "@/lib/events";
import { LAB_CLAUDE_MODEL, LAB_ROUTE, labModelStamp } from "@/lib/spaceship";
import ReturnPanel from "@/components/ReturnPanel";
import SessionEnd from "@/components/SessionEnd";
import TutorPanel, { type TutorPanelHandle } from "@/components/TutorPanel";
import { elText, rangeText, wholeMath } from "@/lib/rangeText";
import { LEVEL_LABEL, useTutor, type TutorLevel } from "@/lib/tutor";
import { findAll } from "@/lib/anchor";
import {
  BAR_H, CARD_H, CARD_W, GAP_X, GAP_Y, LESSON_W, PAGE_W, bareId, cardW, freeY, fromLegacyCard, newerSave, placeLegacy, settle, shapeId, toLegacyCard,
  type CardProps, type LegacyCard, type LegacyPage, type Rect, type Saved, type Status,
} from "@/lib/board";
import {
  CHAT_THREAD, NOTE_H, NOTE_W, appendText, clipFromChat, clipFromTutor, docBody, docClips, docPlain, docTopic, dropAuthored, dropRun, hasOldNotes, insertClip, isPin, isSavedLab, labRest, labResume,
  labStart, pinOf, pinnedAt, setClipSteer, startDoc, withStart,
  type At, type ChatBit, type Clip, type ClipSteer, type DocNode, type NoteProps, type Pin, type SavedLab, type TutorBit,
} from "@/lib/note";
import { headingOf } from "@/lib/lab/story/prompt";
import { LessonHud, useHudTakesPick } from "@/components/canvas/LessonHud";
import BoardChat from "@/components/canvas/BoardChat";
import { attachBoard, attachLesson, attachPage, gloss, hudSounds, peekGloss, sourceOf, subscribe as glossSubscribe } from "@/components/canvas/lessonGloss";
import { frameHooks } from "@/components/canvas/Frame"; // one frame for everything on the board
import type { LabState } from "@/lib/lab/lab";
import {
  CARD, CHIP_W, DOC, LAB, LEADER, LESSON_ID, NOTE, VIDEO, VIDEO_H, VIDEO_W, drawnOver, followers, morphLab, noteEditor, onTravel, shapeOver,
  type Attached, type CanvasHost, type CardShape, type DocShape, type Ends, type LabShape, type NoteShape, type VideoShape,
} from "@/components/canvas/shapes";

// tldraw needs the browser; the board renders on the client only.
const Board = dynamic(() => import("@/components/canvas/Board"), { ssr: false, loading: () => <p className="cv-loading">Opening the board…</p> });

/** The clear part of the board's screen, in px, that a lab is kept in when it opens or is gone to:
    below the Back button (top), above tldraw's toolbar (bottom), clear of the edges (side) and of the
    style panel on the right. See showLab. */
const LAB_FIT = { top: 56, bottom: 64, side: 24 };
// A lab opens centred in the clear part of the screen, most of it (LAB_OPEN), at the board's zoom; its grips resize it and its bar
// moves it from there, and it lays itself out for its box. Never smaller than LAB_W × LAB_H, nor wider than LAB_MAX_W, past which
// its column (120ch, app/reader.css) only gets wider margins. Board units.
const LAB_W = 720;
const LAB_H = 480;
const LAB_MAX_W = 1120;
const LAB_OPEN = { w: 0.92, h: 0.94 };
const TOPIC_WORDS = 8; // Steer live on a highlight this long or shorter uses it as the lab's heading; a longer one gets a heading made
const GLIDE = 450; // ms
const CARRY_PX = 4; // screen px a press on a highlight moves before it carries the highlight (less is a click)
// the board's comfort: one frame, a tidy column, the dock, focus and J (see the section below)
const OPEN_DEPTH_MAX = 2; // a card opens at most at "Plain words": deeper only by its depth handle (zoom no longer deepens)
/** Between the lesson and the column of cards and notes beside it: room for the HUD's definitions (26 + 280 + 24 px). */
const LANE_GUTTER = 330;
const LANE_LEAVE = 24; // page px: a card or note dragged further than this sideways out of its column is free of it
const DOCK_TOP = 58; // screen px from the board's top to the docked note
const DOCK_GAP = 16; // screen px between the docked note and the board's right edge
const FOCUS_MAX_Z = 1.1; // bringing a thing into view zooms in no further than this
/** Where the docked note sits on the board: at the screen's right edge, under its top bar, whatever the camera. */
function dockAt(ed: Editor, n: TLShape) {
  const cam = ed.getCamera();
  const r = ed.getViewportScreenBounds();
  const w = n.meta.fold ? CHIP_W : (n.props as { w: number }).w; // screen px: a docked note keeps its size on the screen (NoteView)
  return { x: (r.w - DOCK_GAP - w) / cam.z - cam.x, y: DOCK_TOP / cam.z - cam.y };
}
/** The clear part of the screen for a lab (screen px, from the board's top left): under the top bar, above the toolbar, left of
    tldraw's style panel (the lab's bar, its ✕, keeps clear of it) and of the docked note, unless that is the lab's own (hidden) note. */
function labArea(ed: Editor, ownNote?: TLShapeId) {
  const vp = ed.getViewportScreenBounds();
  const panel = ed.getContainer().querySelector(".tlui-style-panel__wrapper")?.getBoundingClientRect();
  const docked = ed.getCurrentPageShapes().find((n) => n.type === NOTE && n.meta.dock && n.id !== ownNote);
  const right = Math.max(
    LAB_FIT.side,
    panel?.width ? vp.x + vp.w - panel.left + 12 : 0,
    docked ? (docked.meta.fold ? CHIP_W : (docked.props as { w: number }).w) + DOCK_GAP * 2 : 0, // the dock is screen px
  );
  return { x: LAB_FIT.side, y: LAB_FIT.top, w: vp.w - LAB_FIT.side - right, h: vp.h - LAB_FIT.top - LAB_FIT.bottom };
}
/** Where a lab opens and how big (board units): centred in the clear part of the screen, LAB_OPEN of it at the board's zoom, within
    LAB_W × LAB_H and LAB_MAX_W. At a zoom so close that this is more than the screen, showLab then zooms out to show it. */
function labOpening(ed: Editor, ownNote: TLShapeId) {
  const a = labArea(ed, ownNote);
  const { x: cx, y: cy, z } = ed.getCamera();
  const w = Math.round(Math.min(LAB_MAX_W, Math.max(LAB_W, (a.w * LAB_OPEN.w) / z)));
  const h = Math.round(Math.max(LAB_H, (a.h * LAB_OPEN.h) / z - BAR_H)); // h is the body's: the bar is on top of it
  return { w, h, x: (a.x + a.w / 2) / z - cx - w / 2, y: (a.y + a.h / 2) / z - cy - (BAR_H + h) / 2 };
}
/** Everything on the board that wears the frame: cards, notes, linked pages and labs. */
const isFrame = (s: TLShape | undefined): s is CardShape | NoteShape | DocShape | LabShape | VideoShape =>
  !!s && (s.type === CARD || s.type === NOTE || s.type === LAB || s.type === VIDEO || (s.type === DOC && (s as DocShape).props.role === "page"));
const newId = () => Math.random().toString(36).slice(2, 10);
const normTerm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const SESSION_GAP = 45 * 60 * 1000; // an explore older than this was in an earlier session
const RECALL_WAIT = 4000; // ms to wait for a generated recall question before asking a plain one
const recallFallback = (term: string) => `What do you remember about ${term}?`;
const proxied = (href: string) => `/api/page?url=${encodeURIComponent(href)}`;

const isCard = (s: TLShape | undefined): s is CardShape => s?.type === CARD;
const isDoc = (s: TLShape | undefined): s is DocShape => s?.type === DOC;
/** What the tutor's window takes from the lesson's HUD: the definition showing for the highlight, and its sounds. */
const TUTOR_HUD = { gloss: peekGloss, sounds: hudSounds };
const isLab = (s: TLShape | undefined): s is LabShape => s?.type === LAB;
const isNote = (s: TLShape | undefined): s is NoteShape => s?.type === NOTE;
const isVideo = (s: TLShape | undefined): s is VideoShape => s?.type === VIDEO;

const sid = (bare: string) => shapeId(bare) as TLShapeId;
/** The start a note's document gives its lab: its heading as the lab writes one, then its text. */
const prefixOf = (doc: DocNode) => {
  const topic = docTopic(doc);
  const body = docBody(doc);
  return body ? `${headingOf(topic)} ${body}` : headingOf(topic);
};
/** Where a page's content starts on the board (a linked page's bar is above it). */
const contentTop = (s: DocShape) => s.y + (s.props.role === "page" ? BAR_H : 0);
/** The lesson, linked page or card a note's clip was highlighted in. */
const clipSrc = (c: Clip) => (c.card ? sid(c.card) : c.page ? sid(c.page) : LESSON_ID);

// ---- marks (see refreshMarks) ----
type MarkKind = "explore" | "ask" | "note" | "watch";
const MARK_KINDS: MarkKind[] = ["explore", "ask", "note", "watch"];
/** A passage to mark: src, the lesson / page / card it is in (null: look everywhere, for a tutor
    question); rel, its end in src's content when known; target, the card, thread or note it stands for. */
type MarkItem = { key: string; kind: MarkKind; term: string; context: string; target: string; src: TLShapeId | null; rel: { x: number; y: number } | null };
type MarkHit = { range: Range; item: MarkItem };
/** A mark's tag: at the end of its passage (x, y: from src's content top-left). */
type Tag = { key: string; kind: MarkKind; target: string; src: TLShapeId; x: number; y: number };
const TAG_TEXT: Record<MarkKind, string> = { explore: "E", ask: "A", note: "N", watch: "V" };
const TAG_TITLE: Record<MarkKind, string> = { explore: "Explored: go to its card", ask: "Asked the tutor: open the answer", note: "Clipped to a note: go to the note", watch: "Made into a video: go to the video" };
/** The marks' colours inside the lesson and linked pages (their own documents). */
const MARK_CSS =
  "::highlight(cv-explore){background-color:rgba(221,245,158,.9);color:inherit}" +
  "::highlight(cv-ask){background-color:rgba(166,182,255,.42);color:inherit}" +
  "::highlight(cv-note){background-color:rgba(20,184,166,.28);color:inherit}" +
  "::highlight(cv-watch){background-color:rgba(35,75,231,.14);color:inherit;text-decoration:underline;text-decoration-color:#234be7}";

/** Every place a phrase appears in an element's text, as ranges (lib/anchor.ts does the reading). */
function locate(root: Element, term: string): Range[] {
  const doc = root.ownerDocument;
  const nodes: Text[] = [];
  const walk = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("script,style,noscript,.katex-mathml") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n as Text);
  return findAll(nodes.map((n) => n.data), term).map((p) => {
    const r = doc.createRange();
    r.setStart(nodes[p.start[0]], p.start[1]);
    r.setEnd(nodes[p.end[0]], p.end[1]);
    return r;
  });
}
/** Where a range ends in its source's content: x, y (middle of its last line, as a highlight's
    relX / relY were taken) and top (that line's top), or null if it isn't laid out. */
function rangeEnd(ed: Editor, range: Range, src: TLShapeId): { x: number; y: number; top: number } | null {
  const rects = range.getClientRects();
  const last = rects[rects.length - 1];
  if (!last || (!last.width && !last.height)) return null;
  const s = ed.getShape(src);
  if (isCard(s)) {
    // a card's text is in this document, on screen: back to board units, from the card's corner
    const p = ed.screenToPage({ x: last.right, y: last.top + last.height / 2 });
    const t = ed.screenToPage({ x: last.right, y: last.top });
    return { x: p.x - s.x, y: p.y - s.y, top: t.y - s.y };
  }
  return { x: last.right, y: last.top + last.height / 2, top: last.top }; // a page's frame never scrolls
}
/** Whether a range sits in the paragraph a tutor question was asked about. */
function inParagraph(range: Range, context: string): boolean {
  const node = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : (range.startContainer as Element);
  const block = node?.closest("p,li,figure,td,dd,h1,h2,h3,blockquote,div");
  const want = context.replace(/\s+/g, " ").trim().slice(0, 60);
  return !!block && !!want && elText(block).startsWith(want);
}

/** Whether keys pressed here are typing (a text field, or editable text), so the board's keys keep
    off. A slider, checkbox or button doesn't count: it keeps focus after a lesson's widget is used,
    and Space, U and the tool keys must still work then (tldraw draws the line in the same place).
    Anything in a live lab counts: its keys are its own (it hands Escape back through onEscape). */
const NOT_TEXT = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);
function takesText(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.tagName) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.closest(".steer-lab")) return true;
  return el.tagName === "INPUT" && !NOT_TEXT.has((el as HTMLInputElement).type);
}

/** A camera kept for a board (x, y, z), if there is a sound one. */
function readCamera(key: string): { x: number; y: number; z: number } | null {
  try {
    const c = JSON.parse(localStorage.getItem(key) ?? "null") as { x?: unknown; y?: unknown; z?: unknown } | null;
    const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
    return c && ok(c.x) && ok(c.y) && ok(c.z) && c.z > 0 ? { x: c.x, y: c.y, z: c.z } : null;
  } catch {
    return null;
  }
}

/** The board's looks, chosen in the header and kept in this browser. "sage" is the app's own look
    (and follows the system's light / dark); the others re-set the app's colour tokens (reader.css). */
type Vibe = "sage" | "lilac" | "peach" | "night";
const VIBES: { id: Vibe; name: string; base: string; pop: string }[] = [
  { id: "sage", name: "Sage", base: "#e9ede5", pop: "#ddf59e" },
  { id: "lilac", name: "Lilac", base: "#e9e2fa", pop: "#ffdf5e" },
  { id: "peach", name: "Peach", base: "#fde2d2", pop: "#a8eedd" },
  { id: "night", name: "Night", base: "#1d1a33", pop: "#ff9fe0" },
];
const VIBE_KEY = "learn.canvas.vibe";
const vibeListeners = new Set<() => void>();
let vibeNow: Vibe | null = null; // this visit's pick, for when storage is blocked
function readVibe(): Vibe {
  if (vibeNow) return vibeNow;
  try {
    const v = localStorage.getItem(VIBE_KEY);
    return VIBES.find((x) => x.id === v)?.id ?? "sage";
  } catch {
    return "sage"; // storage blocked: the default look
  }
}
function saveVibe(v: Vibe) {
  vibeNow = v;
  try {
    localStorage.setItem(VIBE_KEY, v);
  } catch {
    /* storage blocked: kept for this visit only */
  }
  vibeListeners.forEach((f) => f());
}
const onVibe = (f: () => void) => {
  vibeListeners.add(f);
  return () => vibeListeners.delete(f);
};

/** The level this learner usually reaches: median of the highest level per card over their
    last 20 cards (explore = 1, deepen = its level), at most 3 so the drawing is never opened
    unasked. 1 with no history. Even counts take the lower middle, to err shallow. */
function usualDepth(evs: { kind?: string; card?: string; level?: number }[]): number {
  const top = new Map<string, number>(); // insertion order = order the cards were first logged
  for (const e of evs) {
    if (typeof e.card !== "string") continue;
    const lv = e.kind === "explore" ? (typeof e.level === "number" ? e.level : 1) : e.kind === "deepen" && typeof e.level === "number" ? e.level : 0;
    if (lv) top.set(e.card, Math.max(top.get(e.card) ?? 0, lv));
  }
  const last = [...top.values()].slice(-20).sort((a, b) => a - b);
  if (!last.length) return 1;
  return Math.min(3, Math.max(1, last[Math.floor((last.length - 1) / 2)]));
}

/** A lesson h2: its top in the iframe document and its text. */
type Heading = { top: number; text: string };
/** The text of the last heading at or above document y, or "" above the first one. */
function headingAt(hs: Heading[], y: number): string {
  let text = "";
  for (const h of hs) {
    if (h.top > y) break;
    text = h.text;
  }
  return text;
}

/** A highlight waiting for the reader to press Explore, Ask, Steer live or → Note. parent: the card it is
    in; page: the linked page it is on (both null = the lesson). relX, relY: its end, from the
    top-left of the card or of the page's content. heading: where it is, for the tutor. */
type Pick = { parent: TLShapeId | null; page: TLShapeId | null; term: string; heading: string; context: string; relX: number; relY: number; range: Range };

/** The word under a point, as a range (for Alt + click). */
function wordRangeAt(doc: Document, x: number, y: number): Range | null {
  const d = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const pos = d.caretPositionFromPoint?.(x, y);
  const r0 = pos ? null : d.caretRangeFromPoint?.(x, y);
  const node = pos?.offsetNode ?? r0?.startContainer;
  const off = pos?.offset ?? r0?.startOffset ?? 0;
  if (!node || node.nodeType !== 3) return null;
  const t = (node as Text).data;
  const isWord = (ch: string) => /[\p{L}\p{N}_'’-]/u.test(ch);
  let a = off;
  let b = off;
  while (a > 0 && isWord(t[a - 1])) a--;
  while (b < t.length && isWord(t[b])) b++;
  if (b - a < 2) return null;
  const r = doc.createRange();
  r.setStart(node, a);
  r.setEnd(node, b);
  return r;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** tldraw's own reading of a wheel event (its normalizeWheel, which it keeps internal), for wheels
    forwarded from a frame. */
function wheelDelta(e: WheelEvent) {
  let x = Number.isFinite(e.deltaX) ? e.deltaX : 0;
  let y = Number.isFinite(e.deltaY) ? e.deltaY : 0;
  let z = 0;
  if (e.ctrlKey || e.altKey || e.metaKey) z = (Math.abs(y) > 10 ? 10 * Math.sign(y) : y) / 100;
  else if (e.shiftKey && !isMac) [x, y] = [y, 0];
  return { x: -x, y: -y, z: -z };
}

export default function LessonCanvas({
  courseSlug,
  courseTitle,
  lessonSlug,
  lessonTitle,
  src,
  prev,
  next,
  can,
}: {
  courseSlug: string;
  courseTitle: string;
  lessonSlug: string;
  lessonTitle: string;
  src: string;
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
  can: Features; // the optional features this machine can run (lib/features.ts)
}) {
  const storeKey = `learn.canvas.v1:${courseSlug}/${lessonSlug}`;
  const cameraKey = `learn.canvas.camera:${courseSlug}/${lessonSlug}`;
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  // a highlight in the lesson gets the HUD's knob instead of the bar (PickPop)
  // the shape a highlight is in: a card, a linked page or the lesson
  const pickSource = pick ? (pick.parent ?? pick.page ?? LESSON_ID) : null;
  const hudTakesPick = useHudTakesPick(pickSource);
  // a highlight in a note: the canvas makes no pick of it (a note's words are its editor's), so the HUD's knob gets one from what
  // it shows, as from the lesson at that height: Explore opens its card in the column beside the lesson, Ask asks about it
  const glossShown = useSyncExternalStore(glossSubscribe, () => gloss().shown, () => null);
  const notePick = useMemo((): Pick | null => {
    const ed = editorRef.current;
    if (!ed || !glossShown || sourceOf(glossShown.source)?.kind !== "note") return null;
    const r = glossShown.range.getBoundingClientRect();
    const at = ed.screenToPage({ x: r.right, y: r.top + r.height / 2 });
    const lesson = ed.getShape(LESSON_ID);
    return {
      parent: null,
      page: null,
      term: glossShown.range.toString().replace(/\s+/g, " ").trim(),
      heading: lessonTitle,
      context: (glossShown.block?.textContent ?? "").slice(0, 1800),
      relX: at.x - (lesson?.x ?? 0),
      relY: at.y - (lesson?.y ?? 0),
      range: glossShown.range,
    };
  }, [glossShown, lessonTitle]);
  const altAt = useRef(0); // when an Alt + highlight was last handled (its click must not open a second card)
  // Where you were before each jump (a card, a tag, a page, the lab), newest last: Esc steps back one.
  const trail = useRef<{ x: number; y: number; z: number }[]>([]);
  const landing = useRef<{ x: number; y: number; z: number } | null>(null); // where a glide in flight will end
  const [backs, setBacks] = useState(0);
  const gliding = useRef(0); // until when (ms) the camera is moving on its own: zoom then deepens nothing
  const [tutorOpen, setTutorOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // The how-to tips over an empty board; once dismissed they stay hidden in this browser.
  const [hintGone, setHintGone] = useState(true); // read once the saved board has loaded (see below)
  const hideHint = useCallback(() => {
    setHintGone(true);
    try {
      localStorage.setItem("learn.canvas.hintGone", "1");
    } catch {
      /* storage blocked: hidden for this visit only */
    }
  }, []);
  const tutor = useRef<TutorPanelHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  const vibe = useSyncExternalStore(onVibe, readVibe, () => "sage" as Vibe);
  // The board follows the vibe: light or dark tools, and selections in the vibe's accent.
  useEffect(() => {
    if (!editor || !root.current) return;
    editor.user.updateUserPreferences({ colorScheme: vibe === "night" ? "dark" : vibe === "sage" ? "system" : "light" });
    const accent = getComputedStyle(root.current).getPropertyValue("--accent").trim();
    const theme = editor.getCurrentTheme();
    if (!/^#[0-9a-f]{6}$/i.test(accent) || !theme) return; // the canvas draws selections itself: plain hex only
    const tint = (mode: "light" | "dark") => ({ ...theme.colors[mode], selectionStroke: accent, selectionFill: `${accent}2e` });
    editor.updateTheme({ ...theme, colors: { light: tint("light"), dark: tint("dark") } });
  }, [editor, vibe]);
  const lessonFrame = useRef<HTMLIFrameElement | null>(null);
  const frames = useRef(new Map<string, HTMLIFrameElement>()); // "" = the lesson, else a page's bare id
  // Lesson h2 positions in iframe document px, refreshed whenever a page resizes, so getSection
  // (called often by useDwell) does no layout work of its own. "" = the lesson, else a page's bare id.
  const heads = useRef(new Map<string, Heading[]>());
  const aborts = useRef(new Map<string, AbortController>()); // `${bare card id}:${level}`
  const wired = useRef(new WeakSet<Document>());

  // ---- reading the board ----
  const cards = useValue("cards", () => (editor ? editor.getCurrentPageShapes().filter(isCard) : []), [editor]);
  const notes = useValue("notes", () => (editor ? editor.getCurrentPageShapes().filter(isNote) : []), [editor]);
  const videos = useValue("videos", () => (editor ? editor.getCurrentPageShapes().filter(isVideo) : []), [editor]);
  const jumping = useValue("jumping", () => (editor ? (editor.getCurrentPageShapes().find((s): s is DocShape => isDoc(s) && !!s.props.jump) ?? null) : null), [editor]);

  const docOf = (key: string) => {
    const s = editorRef.current?.getShape(key ? sid(key) : LESSON_ID);
    return isDoc(s) ? s : null;
  };
  /** Change shapes without an undo step (streaming text, measured heights, bookkeeping), the locked lesson included. */
  const quietly = useCallback((fn: () => void) => editorRef.current?.run(fn, { history: "ignore", ignoreShapeLock: true }), []);

  const getSection = useCallback((): string | null => {
    const ed = editorRef.current;
    const lesson = ed?.getShape(LESSON_ID);
    if (!ed || !isDoc(lesson)) return null;
    const vp = ed.getViewportPageBounds();
    const z = ed.getZoomLevel();
    // The lesson counts as in view only if it fills a fair share of the screen's width
    // (when the view glides onto a card, a sliver of the lesson often stays at the edge).
    const seen = (Math.min(vp.maxX, lesson.x + LESSON_W) - Math.max(vp.x, lesson.x)) * z;
    if (seen < (vp.w * z) / 4 || vp.y > lesson.y + lesson.props.h || vp.maxY < lesson.y) return null;
    return headingAt(heads.current.get("") ?? [], vp.center.y - lesson.y);
  }, []);
  useDwell(courseSlug, lessonSlug, "canvas", getSection);
  useLessonMessages(courseSlug, lessonSlug, "canvas", lessonFrame);

  // ---- the editor ----
  const onMount = useCallback(
    (ed: Editor) => {
      editorRef.current = ed;
      ed.run(
        () => {
          ed.createShape({ id: LESSON_ID, type: DOC, x: 0, y: 0, isLocked: true, props: { role: "lesson", src, title: lessonTitle, w: LESSON_W, h: 1200 } });
        },
        { history: "ignore" },
      );
      ed.setCamera({ x: 40, y: 24, z: 1 });
      const fx = ed.sideEffects;
      const offs = [
        // The lesson stays.
        fx.registerBeforeDeleteHandler("shape", (s) => (s.id === LESSON_ID ? false : undefined)),
        // An unsized card gets the width of the level it shows: wider only, never narrower again, so moving its depth
        // handle back doesn't move the card under the hand.
        fx.registerBeforeChangeHandler("shape", (prev, next) => {
          if (isCard(next) && isCard(prev) && next.props.level !== prev.props.level && !next.props.sized && !next.props.fixedW)
            return { ...next, props: { ...next.props, w: Math.max(prev.props.w, cardW(next.props.level)) } };
          return next;
        }),
        // The margin keeps itself tidy: cards and notes in a column never overlap (see tidy below).
        fx.registerAfterChangeHandler("shape", (prev, next) => tidy.current.changed(prev, next)),
        fx.registerAfterCreateHandler("shape", (sh) => isCard(sh) || isNote(sh) ? tidy.current.schedule(40) : undefined),
        fx.registerAfterDeleteHandler("shape", (sh) => isCard(sh) || isNote(sh) ? tidy.current.schedule(40) : undefined),
        // Whatever you select comes to the front (a card's or a page's bar, as a note's always did).
        fx.registerAfterChangeHandler("instance_page_state", (prev, next) => {
          const added = next.selectedShapeIds.filter((id) => !prev.selectedShapeIds.includes(id) && isFrame(ed.getShape(id)));
          if (added.length && ed.getCurrentPageShapesSorted().at(-1)?.id !== added.at(-1)) ed.bringToFront(added);
        }),
        // A pinned thing keeps its spot on the screen as the board scrolls or zooms; zooming out far enough unpins it (lib/note.ts).
        // The docked note keeps to the screen's right edge, whatever the zoom. Any frame can be pinned, not only notes.
        fx.registerAfterChangeHandler("camera", (_, cam) => {
          const pinned = ed.getCurrentPageShapes().filter((n) => isFrame(n) && isPin(n.meta.pin));
          if (!pinned.length) return;
          ed.run(
            () => {
              for (const n of pinned) {
                const at = n.meta.dock ? dockAt(ed, n) : pinnedAt(n.meta.pin as Pin, cam);
                ed.updateShape(at ? { id: n.id, type: n.type, ...at } : { id: n.id, type: n.type, meta: { ...n.meta, pin: null } });
              }
            },
            { history: "ignore" },
          );
        }),
        // A pinned thing moved by hand (dragged, or put back where its lab was) is pinned at its new spot; the docked note
        // dragged away from the dock is let go there. A move that only followed the camera leaves it where its pin says.
        // (These handlers run once the whole change is done, so a flag set around the camera's moves above would already be off.)
        fx.registerAfterChangeHandler("shape", (prev, next) => {
          if (!isFrame(next) || !isPin(next.meta.pin) || (next.x === prev.x && next.y === prev.y)) return;
          const cam = ed.getCamera();
          const at = next.meta.dock ? dockAt(ed, next) : pinnedAt(next.meta.pin, cam);
          if (at && Math.abs(at.x - next.x) < 0.01 && Math.abs(at.y - next.y) < 0.01) return;
          if (next.meta.dock) return void ed.updateShape({ id: next.id, type: next.type, meta: { ...next.meta, dock: null, pin: null, home: null } });
          ed.updateShape({ id: next.id, type: next.type, meta: { ...next.meta, pin: pinOf(next, cam) } });
        }),
      ];
      offs.push(onTravel(ed, (ends, attached) => travel.current(ends, attached)));
      // A double-click on an empty spot of the board makes a note there (tldraw's text box is off, Board.tsx).
      const onEvent = (e: TLEventInfo) => {
        if (e.type !== "click" || e.name !== "double_click" || e.phase !== "down" || e.target !== "canvas" || e.shiftKey || e.ctrlKey) return;
        const at = ed.inputs.getCurrentPagePoint();
        if (!ed.isIn("select.idle") || ed.getShapeAtPoint(at, { hitInside: true, hitLocked: true, margin: ed.getHitTestMargin(), renderingOnly: true })) return;
        noteAtRef.current({ x: at.x, y: at.y });
      };
      ed.on("event", onEvent);
      offs.push(() => ed.off("event", onEvent));
      // A link pasted onto the board opens as a page right there (instead of tldraw's bookmark card).
      ed.registerExternalContentHandler("url", (c) => {
        openLinkRef.current(c.url, c.point);
      });
      setEditor(ed);
      return () => {
        offs.forEach((off) => off());
        editorRef.current = null;
      };
    },
    [src, lessonTitle],
  );

  // ---- persistence: learning/<course>/app-data/canvas/<lesson>.json, with localStorage as a cache ----
  const fileName = `canvas/${lessonSlug}`;
  const behind = useRef(false); // the board opened from the browser's copy, newer than the file: save it at once
  useEffect(() => {
    if (!editor) return;
    let dead = false;
    let local: Saved | null = null;
    try {
      local = JSON.parse(localStorage.getItem(storeKey) ?? "null");
    } catch {
      /* nothing saved */
    }
    fetch(`/api/state?course=${courseSlug}&name=${fileName}`)
      .then((r) => (r.ok ? r.json() : null), () => null)
      .then((file: Saved | null) => {
        if (dead) return;
        let gone = false;
        try {
          gone = localStorage.getItem("learn.canvas.hintGone") === "1";
        } catch {
          /* storage blocked: show the tips */
        }
        setHintGone(gone);
        const saved = newerSave(file, local); // the newer copy (lib/board.ts); the file on a tie
        behind.current = !!saved && saved !== file; // the file is older than what opens: write it again once loaded
        // Its notes from before they were one document convert as it opens (NoteShapeUtil's migration):
        // the board as it was is kept first, once (app-data/backup/), in case the conversion lost anything.
        if (saved?.board && hasOldNotes(saved.board))
          fetch("/api/state", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ course: courseSlug, name: `backup/canvas-${lessonSlug}`, data: saved }),
          }).catch(() => {});
        let ok = true;
        try {
          if (saved?.board) editor.loadSnapshot({ document: saved.board } as Parameters<Editor["loadSnapshot"]>[0]);
          else if (saved?.cards?.length || saved?.pages?.length) migrate(editor, saved.cards ?? [], saved.pages ?? []);
        } catch (e) {
          ok = false; // never save over a file this board could not read
          console.error("The saved board could not be read; showing the lesson alone, and not saving.", e);
        }
        quietly(() => {
          const lesson = editor.getShape(LESSON_ID);
          const lessonProps = { role: "lesson" as const, src, title: lessonTitle, w: LESSON_W };
          if (isDoc(lesson)) editor.updateShape<DocShape>({ id: LESSON_ID, type: DOC, isLocked: true, props: lessonProps });
          else editor.createShape({ id: LESSON_ID, type: DOC, x: 0, y: 0, isLocked: true, props: { ...lessonProps, h: 1200 } });
          editor.sendToBack([LESSON_ID]);
          const shapes = editor.getCurrentPageShapes();
          // The lab is never kept (its sound and model calls end with the page), nor is a pending jump or a pinned note.
          editor.deleteShapes(shapes.filter(isLab).map((s) => s.id));
          editor.updateShapes(shapes.filter((s) => isNote(s) && s.meta.pin).map((s) => ({ id: s.id, type: NOTE, meta: { ...s.meta, pin: null } })));
          editor.updateShapes(
            shapes.flatMap((s): TLShapePartial[] =>
              isCard(s) ? [{ id: s.id, type: CARD, props: settle(s.props) }] : isDoc(s) && s.props.jump ? [{ id: s.id, type: DOC, props: { jump: "" } }] : [],
            ),
          );
          // Lines from a highlight to its card (two earlier versions drew them) give way to the highlights' own tags.
          editor.deleteShapes(shapes.filter((s) => s.type === LEADER || (s.type === "arrow" && s.meta.leader)).map((s) => s.id));
        });
        editor.clearHistory();
        // back where you left this board on this device, or at the top of the lesson
        editor.setCamera(readCamera(cameraKey) ?? { x: 40, y: 24, z: 1 });
        setLoaded(ok);
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per editor and lesson
  }, [editor, storeKey, courseSlug, fileName]);

  /** A board saved before the tldraw canvas: its cards and pages become shapes. */
  function migrate(ed: Editor, cs: LegacyCard[], ps: LegacyPage[]) {
    const placed = placeLegacy(cs, ps);
    ed.run(
      () => {
        for (const p of placed.pages)
          ed.createShape({
            id: sid(p.id),
            type: DOC,
            x: p.x,
            y: p.y,
            props: { role: "page", src: p.src, href: p.href ?? "", title: p.title, collapsed: !!p.collapsed, from: p.from ?? "", relX: p.relX ?? 0, relY: p.relY ?? 0, w: PAGE_W, h: 1000 },
          });
        for (const c of placed.cards) ed.createShape({ id: sid(c.id), type: CARD, x: c.x, y: c.y, props: fromLegacyCard(c) });
      },
      { history: "ignore" },
    );
  }

  // Where you are on the board (scroll and zoom) is kept per lesson in this browser, half a second
  // after the camera stops and as the page goes away, so the board opens where you left it.
  useEffect(() => {
    if (!editor || !loaded) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const keep = () => {
      timer = null;
      const { x, y, z } = editor.getCamera();
      try {
        localStorage.setItem(cameraKey, JSON.stringify({ x, y, z }));
      } catch {
        /* storage full or blocked: the board opens at the top next time */
      }
    };
    const off = editor.sideEffects.registerAfterChangeHandler("camera", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(keep, 500);
    });
    const now = () => timer && (clearTimeout(timer), keep());
    window.addEventListener("pagehide", now);
    return () => {
      off();
      window.removeEventListener("pagehide", now);
      now();
    };
  }, [editor, loaded, cameraKey]);

  // Save at most once a second after the board changes, including while a card is still streaming.
  useEffect(() => {
    if (!editor || !loaded) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      timer = null;
      const doc = getSnapshot(editor.store).document;
      // the lab is never saved
      const recs = doc.store as Record<string, { typeName: string; type?: string; fromId?: string; toId?: string }>;
      const drop = new Set(Object.keys(recs).filter((k) => recs[k].typeName === "shape" && recs[k].type === LAB));
      for (const k of Object.keys(recs))
        if (drop.has(k) || (recs[k].typeName === "binding" && (drop.has(recs[k].fromId!) || drop.has(recs[k].toId!)))) delete recs[k];
      const shapes = editor.getCurrentPageShapes();
      const cardsOut = shapes.filter(isCard).map((c) => toLegacyCard(c.id, c.x, c.y, c.props));
      const pagesOut: LegacyPage[] = shapes
        .filter((s): s is DocShape => isDoc(s) && s.props.role === "page")
        .map((p) => ({
          id: bareId(p.id), src: p.props.src, title: p.props.title, x: p.x, y: p.y + BAR_H,
          ...(p.props.href ? { href: p.props.href } : {}),
          ...(p.props.from ? { from: p.props.from } : {}),
          relX: p.props.relX, relY: p.props.relY, collapsed: p.props.collapsed,
        }));
      const body = JSON.stringify({ savedAt: Date.now(), cards: cardsOut, pages: pagesOut, board: doc });
      try {
        localStorage.setItem(storeKey, body);
      } catch {
        /* storage full or blocked */
      }
      fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: `{"course":${JSON.stringify(courseSlug)},"name":${JSON.stringify(fileName)},"data":${body}}`,
      }).catch(() => {});
    };
    const off = editor.store.listen(() => {
      if (!timer) timer = setTimeout(save, 1000);
    }, { scope: "document" });
    const flushNow = () => timer && (clearTimeout(timer), save());
    window.addEventListener("pagehide", flushNow);
    if (behind.current) {
      behind.current = false;
      save();
    }
    return () => {
      off();
      window.removeEventListener("pagehide", flushNow);
      flushNow();
    };
  }, [editor, loaded, storeKey, courseSlug, fileName]);

  // ---- study log ----
  // Explores from earlier visits, fetched once, so a new card can say whether its term was seen before.
  const pastRef = useRef<{ term: string; t: number }[]>([]);
  const usualRef = useRef(1); // the level new cards open at (see usualDepth)
  type PastCard = { lesson: string; card: string; term: string; level: number; parts: string[]; createdAt?: number };
  const pastCardsRef = useRef<PastCard[]>([]); // finished cards of this course, fetched once
  useEffect(() => {
    let dead = false;
    fetch(`/api/events?course=${courseSlug}`)
      .then((r) => (r.ok ? r.json() : []), () => [])
      .then((evs: { kind?: string; term?: string; t?: string; card?: string; level?: number }[]) => {
        if (dead || !Array.isArray(evs)) return;
        pastRef.current = evs
          .filter((e) => e.kind === "explore" && typeof e.term === "string")
          .map((e) => ({ term: normTerm(e.term!), t: Date.parse(e.t ?? "") }));
        usualRef.current = usualDepth(evs);
      });
    fetch(`/api/cards?course=${courseSlug}`)
      .then((r) => (r.ok ? r.json() : []), () => [])
      .then((cs: PastCard[]) => {
        if (!dead && Array.isArray(cs)) pastCardsRef.current = cs;
      });
    return () => {
      dead = true;
    };
  }, [courseSlug]);

  // One `deepen` per level a card gains, whatever raised it (Zoom in bar, zooming the board).
  // Levels seen at load are the baseline, so restoring saved cards logs nothing.
  const levelsRef = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const seen = levelsRef.current;
    levelsRef.current = new Map(cards.map((c) => [c.id, c.props.level]));
    if (!seen) return;
    for (const c of cards)
      for (let lv = (seen.get(c.id) ?? c.props.level) + 1; lv <= c.props.level; lv++)
        logEvent(courseSlug, { kind: "deepen", lesson: lessonSlug, view: "canvas", card: bareId(c.id), term: c.props.term, level: lv as 2 | 3 | 4 });
  }, [cards, loaded, courseSlug, lessonSlug]);

  // ---- streaming ----
  const patch = useCallback(
    (id: TLShapeId, lv: number, text: string | null, status: Status) => {
      const c = editorRef.current?.getShape(id);
      if (!isCard(c)) return; // deleted meanwhile
      quietly(() =>
        editorRef.current!.updateShape<CardShape>({
          id,
          type: CARD,
          props: {
            parts: text === null ? c.props.parts : c.props.parts.map((p, i) => (i === lv - 1 ? text : p)),
            status: c.props.status.map((s, i) => (i === lv - 1 ? status : s)),
          },
        }),
      );
    },
    [quietly],
  );

  const start = useCallback(
    async (c: CardShape, lv: number) => {
      const key = `${bareId(c.id)}:${lv}`;
      const ctrl = new AbortController();
      aborts.current.set(key, ctrl);
      patch(c.id, lv, "", "streaming");
      let acc = "";
      let raf = 0;
      try {
        const res = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            course: courseTitle,
            courseSlug,
            lesson: lessonTitle,
            term: c.props.term,
            context: c.props.context,
            trail: c.props.trail,
            level: lv,
            prior: c.props.parts.slice(0, Math.min(lv - 1, 3)).join("\n\n"),
          }),
        });
        if (!res.ok || !res.body) throw new Error(`request failed (${res.status})`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          if (!raf)
            raf = requestAnimationFrame(() => {
              raf = 0;
              patch(c.id, lv, acc, "streaming");
            });
        }
        cancelAnimationFrame(raf);
        const err = acc.indexOf("[tutor error]");
        if (err >= 0) patch(c.id, lv, acc.slice(err + 13).trim(), "error");
        else patch(c.id, lv, acc.trim(), "done");
      } catch (e) {
        cancelAnimationFrame(raf);
        if ((e as Error).name !== "AbortError") patch(c.id, lv, `The tutor didn’t answer (${(e as Error).message}).`, "error");
      } finally {
        aborts.current.delete(key);
      }
    },
    [courseTitle, courseSlug, lessonTitle, patch],
  );

  // "Prefetch pictures" (Control room > Models): when off, the picture (level 4) is never
  // fetched ahead, only once the card is zoomed to it. Held off until the setting is known.
  const [prefetchPictures, setPrefetchPictures] = useState(false);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null), () => null)
      .then((s: { prefetchPictures?: boolean } | null) => setPrefetchPictures(s?.prefetchPictures !== false));
  }, []);

  // Fetch every revealed level plus one ahead, each after the level before it. A level marked as
  // streaming with nothing fetching it (an undo brought the card back) starts again. A card that
  // is gone stops its requests.
  useEffect(() => {
    if (!loaded) return;
    const ids = new Set(cards.map((c) => bareId(c.id)));
    aborts.current.forEach((a, key) => !ids.has(key.split(":")[0]) && a.abort());
    for (const c of cards)
      for (let lv = 1; lv <= Math.min(prefetchPictures || c.props.level >= 4 ? 4 : 3, c.props.level + 1); lv++) {
        const st = c.props.status[lv - 1];
        const busy = aborts.current.has(`${bareId(c.id)}:${lv}`);
        if (
          c.props.recall?.step !== "ask" && // a reused card waits for its recall question before fetching ahead
          (st === "idle" || (st === "streaming" && !busy)) &&
          (lv === 1 || c.props.status[lv - 2] === "done") &&
          !busy
        )
          start(c, lv);
      }
  }, [cards, loaded, start, prefetchPictures]);

  useEffect(() => {
    const live = aborts.current;
    return () => live.forEach((a) => a.abort());
  }, []);

  // ---- "Recall first?" on reused cards ----
  // The question is generated once per old card by /api/recall (cached there). If it has not
  // come within RECALL_WAIT, or the call fails, a plain question takes its place for good.
  const recallAsked = useRef(new Set<string>());
  const setRecall = useCallback(
    (id: TLShapeId, fn: (r: NonNullable<CardProps["recall"]>) => CardProps["recall"]) => {
      const c = editorRef.current?.getShape(id);
      if (isCard(c) && c.props.recall) quietly(() => editorRef.current!.updateShape<CardShape>({ id, type: CARD, props: { recall: fn(c.props.recall!) } }));
    },
    [quietly],
  );
  useEffect(() => {
    if (!loaded) return;
    for (const c of cards) {
      const p = c.props;
      if (p.recall?.step !== "ask" || p.recall.q || !p.from || recallAsked.current.has(c.id)) continue;
      recallAsked.current.add(c.id);
      const { id } = c;
      const term = p.term;
      let settled = false;
      const done = (q: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        setRecall(id, (r) => (r.q ? r : { ...r, q }));
      };
      const timer = setTimeout(() => done(recallFallback(term)), RECALL_WAIT);
      fetch("/api/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // the written levels only: a drawing says nothing a question can be built on
        body: JSON.stringify({ course: courseSlug, card: p.from.card, term, text: p.parts.slice(0, 3).filter(Boolean).join("\n\n") }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (d: { q?: unknown } | null) => done(typeof d?.q === "string" ? d.q : recallFallback(term)),
          () => done(recallFallback(term)),
        );
    }
  }, [cards, loaded, courseSlug, setRecall]);

  // ---- camera ----
  /** Keep where you are now (scroll and zoom) before a jump, so Esc can bring you back to it. A jump
      made while the last glide is still moving keeps where that glide was going, not a midway spot. */
  const rememberHome = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const { x, y, z } = Date.now() < gliding.current && landing.current ? landing.current : ed.getCamera();
    const top = trail.current.at(-1);
    if (top && Math.abs(top.x - x) < 1 && Math.abs(top.y - y) < 1 && Math.abs(top.z - z) < 0.001) return;
    trail.current = [...trail.current.slice(-49), { x, y, z }];
    setBacks(trail.current.length);
  }, []);
  /** Ease the camera to a place (camera x, y are in page units: screen = (page + camera) * z). */
  const glide = useCallback((cam: { x: number; y: number; z: number }) => {
    gliding.current = Date.now() + GLIDE + 80;
    landing.current = cam;
    editorRef.current?.setCamera(cam, { animation: { duration: GLIDE } });
  }, []);
  const screen = () => editorRef.current!.getViewportScreenBounds();

  /** A click on a leader or an arrow travels along it: to its start, or to its end if the start is
      what you are looking at. With both ends on screen there is nowhere to go, and the click only selects it. */
  const travel = useRef<(ends: Ends, attached: Attached) => void>(() => {});
  travel.current = (ends, attached) => {
    const ed = editorRef.current;
    if (!ed) return;
    const vp = ed.getViewportPageBounds();
    const seen = (p: { x: number; y: number }) => vp.containsPoint(p);
    if (seen(ends.start) && seen(ends.end)) return;
    const to = seen(ends.start) ? "end" : "start";
    const p = ends[to];
    // Frame what that end is on (the lesson, a page, a card), level with the point.
    const id = attached[to];
    const b = id ? ed.getShapePageBounds(id) : undefined;
    const z = ed.getZoomLevel();
    const r = screen();
    const cx = b && b.w * z < r.w - 80 ? b.center.x : p.x;
    rememberHome();
    glide({ z, x: r.w / 2 / z - cx, y: (r.h * 0.42) / z - p.y });
  };

  const stepRef = useRef<(dir: 1 | -1) => void>(() => {});
  const goBack = useCallback(() => {
    const prev = trail.current.pop();
    setBacks(trail.current.length);
    if (prev) glide(prev);
  }, [glide]);
  // Esc steps back to where you were before the last jump, zoom included, one jump per press (a
  // selection is cleared on the way). Not while drawing with a tool or typing in a shape: there Esc
  // keeps its own meaning.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ed = editorRef.current;
      if (!ed) return;
      // J / Shift+J: the next or previous thing on the board (tldraw leaves the key free)
      if ((e.code === "KeyJ" || e.key.toLowerCase() === "j") && !e.ctrlKey && !e.metaKey && !e.altKey && !takesText(e.target) && !ed.getEditingShapeId()) {
        e.preventDefault();
        return stepRef.current(e.shiftKey ? -1 : 1);
      }
      // U: open a link (tldraw leaves the key free)
      const u = e.code === "KeyU" || e.key.toLowerCase() === "u"; // by position too, for any keyboard layout
      if (u && !e.ctrlKey && !e.metaKey && !e.altKey && !takesText(e.target) && !ed.getEditingShapeId()) {
        e.preventDefault();
        e.stopPropagation();
        setLinkBar(true);
        return;
      }
      if (e.key !== "Escape") return;
      if (ed.getEditingShapeId() || ed.getCurrentToolId() !== "select" || takesText(e.target)) return;
      if (trail.current.length) goBack();
    };
    window.addEventListener("keydown", onKey, true); // capture: before the board clears its selection
    return () => window.removeEventListener("keydown", onKey, true);
  }, [goBack]);

  /** Where the camera sits so a card (or a note) is centred, with the end of what it already shows
      near the upper part of the screen (the part about to be revealed lands in view). A video is shown whole. */
  const onCard = (c: CardShape | NoteShape | VideoShape, z: number) => {
    const r = screen();
    if (isVideo(c)) return { z, x: r.w / 2 / z - (c.x + c.props.w / 2), y: Math.max(70, (r.h - c.props.h * z) / 2) / z - c.y }; // whole, in the middle
    return { z, x: r.w / 2 / z - (c.x + c.props.w / 2), y: Math.min(70 / z - c.y, (r.h * 0.4) / z - (c.y + c.props.h)) };
  };

  /** A card's depth handle: the card shows this deep (back as well as on). Nothing moves: the board stays where it is. */
  function setLevel(id: TLShapeId, lv: number) {
    const ed = editorRef.current!;
    const c = ed.getShape(id);
    if (isCard(c) && c.props.level !== lv) ed.updateShape<CardShape>({ id, type: CARD, props: { level: lv } });
  }

  // ---- the board's comfort ----
  /** The positions the tidy column set itself, so its own moves aren't taken for the learner's. */
  const ours = useRef(new Map<TLShapeId, { x: number; y: number }>());
  const tidyTimer = useRef<number | undefined>(undefined);
  /** The thing last brought into view: J steps on from it. */
  const focused = useRef<TLShapeId | null>(null);
  const laneOf = (sh: TLShape) => (typeof sh.meta.lane === "number" ? sh.meta.lane : null);
  const wantOf = (sh: TLShape) => (typeof sh.meta.wantY === "number" ? sh.meta.wantY : sh.y);

  /** Cards and notes in a column (meta.lane: its x) stack down it in the order they want to be (meta.wantY: level with what they
      came from), each below the one above, so they never overlap and one that grows pushes those below it down. A note that is a
      lab just now keeps its own room (the lab floats where it opened, launchNote), so nothing shifts as it opens or closes.
      Pinned and docked ones are out of the column. */
  function reflow() {
    const ed = editorRef.current;
    if (!ed) return;
    const lanes = new Map<number, (CardShape | NoteShape)[]>();
    for (const sh of ed.getCurrentPageShapes()) {
      if (!(isCard(sh) || isNote(sh))) continue;
      const lane = laneOf(sh);
      if (lane === null || isPin(sh.meta.pin)) continue;
      lanes.set(lane, [...(lanes.get(lane) ?? []), sh]);
    }
    const moves: TLShapePartial[] = [];
    for (const [lane, members] of lanes) {
      members.sort((a, b) => wantOf(a) - wantOf(b) || a.props.createdAt - b.props.createdAt);
      let floor = -Infinity;
      for (const m of members) {
        const y = Math.max(wantOf(m), floor);
        if (Math.abs(m.y - y) > 0.5 || Math.abs(m.x - lane) > 0.5) {
          moves.push({ id: m.id, type: m.type, x: lane, y });
          ours.current.set(m.id, { x: lane, y });
        }
        floor = y + ed.getShapeGeometry(m).bounds.h + GAP_Y;
      }
    }
    if (moves.length) ed.run(() => ed.updateShapes(moves), { history: "ignore" });
  }

  type Tidy = { schedule: (ms: number) => void; changed: (prev: TLShape, next: TLShape) => void; touch: (id: TLShapeId) => void };
  const tidy = useRef<Tidy>({ schedule: () => {}, changed: () => {}, touch: () => {} });
  tidy.current = {
    schedule(ms) {
      clearTimeout(tidyTimer.current);
      tidyTimer.current = window.setTimeout(reflow, ms);
    },
    changed(prev, next) {
      if (!(isCard(next) || isNote(next)) || !(isCard(prev) || isNote(prev))) return;
      const lane = laneOf(next);
      if (lane === null && laneOf(prev) === null) return;
      if (lane !== null && (next.x !== prev.x || next.y !== prev.y)) {
        const set = ours.current.get(next.id);
        if (set && Math.abs(set.x - next.x) < 0.5 && Math.abs(set.y - next.y) < 0.5) ours.current.delete(next.id);
        else if (!isPin(next.meta.pin)) {
          // moved by hand: dragged out sideways it is free of the column; along it, it wants to be where it was put
          const meta = Math.abs(next.x - lane) > LANE_LEAVE ? { lane: null } : { wantY: next.y };
          editorRef.current!.updateShape({ id: next.id, type: next.type, meta: { ...next.meta, ...meta } });
          return tidy.current.schedule(400);
        }
      }
      const differs = (k: string) => prev.meta[k] !== next.meta[k];
      if (prev.props.h !== next.props.h || prev.props.w !== next.props.w || ["fold", "lane", "wantY", "dock"].some(differs) || !!prev.meta.pin !== !!next.meta.pin)
        tidy.current.schedule(40);
    },
    touch(id) {
      const ed = editorRef.current;
      if (ed && ed.getCurrentPageShapesSorted().at(-1)?.id !== id) quietly(() => ed.bringToFront([id]));
    },
  };

  /** Dock a note at the screen's right edge, as the current note (→ Note goes there). One at a time: the note docked before goes
      back where it was. */
  function dock(n: NoteShape) {
    const ed = editorRef.current!;
    for (const o of ed.getCurrentPageShapes()) if (isNote(o) && o.id !== n.id && o.meta.dock) undock(o);
    const meta = { ...n.meta, dock: true, pin: pinOf(n, ed.getCamera()), home: { x: n.x, y: n.y, lane: laneOf(n) }, lane: null };
    ed.updateShape<NoteShape>({ id: n.id, type: NOTE, meta, ...dockAt(ed, { ...n, meta }) });
    ed.bringToFront([n.id]);
    lastNote.current = n.id;
  }
  /** Put the docked note back where it was before it docked (into its column, if it was in one). */
  function undock(n: NoteShape) {
    const ed = editorRef.current!;
    const home = n.meta.home as { x: number; y: number; lane: number | null } | null;
    ed.updateShape<NoteShape>({
      id: n.id,
      type: NOTE,
      meta: { ...n.meta, dock: null, pin: null, home: null, lane: home?.lane ?? null, wantY: home?.y ?? null },
      ...(home ? { x: home.x, y: home.y } : {}),
    });
  }

  /** A frame's own controls: Pin (a note's: Dock), – and ✕. */
  function frameAct(id: TLShapeId, act: "pin" | "fold" | "close") {
    const ed = editorRef.current!;
    const sh = ed.getShape(id);
    if (!isFrame(sh)) return;
    if (act === "close") {
      if (isCard(sh)) removeCard(id);
      else if (isDoc(sh)) closePage(id);
      else if (isLab(sh)) closeLab(id);
      else {
        // a video still being made stops with its card (one already finished just answers that it is)
        if (isVideo(sh)) void fetch("/api/watch/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ course: sh.props.course, id: sh.props.video }) }).catch(() => {});
        ed.deleteShapes([id]);
      }
      return;
    }
    if (act === "fold") {
      if (isDoc(sh)) return togglePage(id);
      ed.markHistoryStoppingPoint("fold");
      const meta = { ...sh.meta, fold: sh.meta.fold ? null : true };
      ed.updateShape({ id, type: sh.type, meta, ...(sh.meta.dock ? dockAt(ed, { ...sh, meta }) : {}) }); // docked: still at the edge
      return;
    }
    if (isNote(sh)) return sh.meta.dock ? undock(sh) : dock(sh);
    const pinned = isPin(sh.meta.pin);
    ed.updateShape({ id, type: sh.type, meta: { ...sh.meta, pin: pinned ? null : pinOf(sh, ed.getCamera()), lane: pinned ? (sh.meta.lane ?? null) : null } });
    if (!pinned) ed.bringToFront([id]);
  }

  /** Bring a thing into view (double-click its bar, a tick on the rail, J): as wide as the clear part of the screen allows, up to
      FOCUS_MAX_Z, centred, or from its top when it is taller than the screen. Esc goes back. */
  function focusFrame(id: TLShapeId) {
    const ed = editorRef.current;
    const b = ed?.getShapePageBounds(id);
    if (!ed || !b) return;
    focused.current = id;
    const r = screen();
    const docked = ed.getCurrentPageShapes().find((n) => isNote(n) && n.meta.dock && n.id !== id);
    const right = docked ? (docked.meta.fold ? CHIP_W : (docked.props as { w: number }).w) + DOCK_GAP * 2 : 24; // the dock is screen px
    const area = { x: 24, y: 56, w: r.w - 24 - right, h: r.h - 56 - 72 };
    const z = Math.min(FOCUS_MAX_Z, area.w / b.w);
    const fits = b.h * z <= area.h;
    rememberHome();
    glide({ z, x: (area.x + area.w / 2) / z - b.center.x, y: fits ? (area.y + area.h / 2) / z - b.center.y : area.y / z - b.y });
  }
  frameHooks.focus = focusFrame;
  stepRef.current = step;

  /** J / Shift+J: the next or previous thing on the board, top to bottom, from the one last brought into view (or from the top
      of the screen). */
  function step(dir: 1 | -1) {
    const ed = editorRef.current!;
    const list = ed
      .getCurrentPageShapes()
      .filter((sh) => isFrame(sh) && !sh.meta.dock && !ed.isShapeHidden(sh))
      .map((sh) => ({ id: sh.id, b: ed.getShapePageBounds(sh.id)! }))
      .sort((a, b) => a.b.y - b.b.y || a.b.x - b.b.x);
    if (!list.length) return;
    let i = list.findIndex((x) => x.id === focused.current);
    if (i === -1) {
      const below = list.findIndex((x) => x.b.y >= ed.getViewportPageBounds().y);
      i = dir > 0 ? (below === -1 ? list.length - 1 : below - 1) : below === -1 ? list.length : below;
    }
    focusFrame(list[(i + dir + list.length) % list.length].id);
  }

  // Words highlighted in a card are defined too, with the glossary of the lesson or page its chain of cards started on.
  useEffect(() => {
    const ed = editorRef.current;
    if (!editor || !ed) return;
    attachBoard(window, (cardId) => {
      let c = ed.getShape(cardId as TLShapeId);
      while (isCard(c) && c.props.parent) {
        const up = ed.getShape(sid(c.props.parent));
        if (!isCard(up)) break;
        c = up;
      }
      return isCard(c) && c.props.page ? sid(c.props.page) : LESSON_ID;
    });
  }, [editor]);

  // A board saved before the tidy column: cards and notes standing in a column (beside the lesson, a page, or the card they came
  // from) join it where they are, and it tidies them once as the board opens. The rest stay free.
  useEffect(() => {
    const ed = editorRef.current;
    if (!editor || !loaded || !ed) return;
    const besideOf = (id: string) => {
      const b = id ? ed.getShapePageBounds(sid(id)) : undefined;
      return b ? [b.maxX + GAP_X] : [];
    };
    const lessonRight = ed.getShapePageBounds(LESSON_ID)?.maxX ?? LESSON_W;
    const lessonLane = lessonRight + LANE_GUTTER;
    const joins: TLShapePartial[] = [];
    for (const sh of ed.getCurrentPageShapes()) {
      if (!(isCard(sh) || isNote(sh)) || sh.meta.lane !== undefined || isPin(sh.meta.pin) || sh.meta.dock) continue;
      // the column beside the lesson used to stand GAP_X from it, where the definitions are now: those move out to the new one
      const besideLesson = Math.abs(sh.x - lessonLane) < 4 || Math.abs(sh.x - (lessonRight + GAP_X)) < 4;
      const near = isCard(sh) ? [...besideOf(sh.props.parent), ...besideOf(sh.props.page)] : [];
      const lane = besideLesson ? lessonLane : (near.find((x) => Math.abs(sh.x - x) < 4) ?? null);
      joins.push({ id: sh.id, type: sh.type, meta: { ...sh.meta, lane, wantY: sh.y } });
    }
    if (joins.length) ed.run(() => ed.updateShapes(joins), { history: "ignore" });
    tidy.current.schedule(60);
  }, [editor, loaded]);

  // ---- opening cards ----
  /** Everything a new card or panel must not land on. */
  const obstacles = (ed: Editor, skip: Set<TLShapeId>): Rect[] =>
    ed
      .getCurrentPageShapes()
      .filter((s) => (isCard(s) || isDoc(s) || isNote(s) || isLab(s) || isVideo(s)) && !skip.has(s.id))
      .map((s) => ed.getShapePageBounds(s.id)!)
      .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  /** The right edge of everything on the board's own shapes. */
  const rightEdge = (ed: Editor) =>
    Math.max(LESSON_W, ...ed.getCurrentPageShapes().filter((s) => isCard(s) || isDoc(s) || isNote(s)).map((s) => ed.getShapePageBounds(s.id)!.maxX));

  const spawn = useCallback(
    (p: Pick) => {
      const ed = editorRef.current;
      const t = p.term.replace(/\s+/g, " ").trim();
      if (!ed || t.length < 2) return null;
      const parent = p.parent ? ed.getShape(p.parent) : undefined;
      const page = p.page ? ed.getShape(p.page) : undefined;
      const source = isCard(parent) ? parent : isDoc(page) ? page : ed.getShape(LESSON_ID);
      if (!source) return null;
      const bare = newId();
      const id = sid(bare);
      // The section is where the chain of cards started: the nearest h2 above the root card's anchor
      // (on the lesson, or on the linked page the chain started on).
      let root: CardShape | null = isCard(parent) ? parent : null;
      while (root?.props.parent) {
        const up = ed.getShape(sid(root.props.parent));
        root = isCard(up) ? up : null;
      }
      const rootPage = root ? root.props.page : isDoc(page) ? bareId(page.id) : "";
      const now = Date.now();
      const key = normTerm(t);
      // An earlier card for this term (another lesson, or this one in an earlier session) lends
      // its finished levels, so they cost no new Claude call. The deepest such card wins; ties go
      // to the oldest, the one the learner first wrote.
      const old = pastCardsRef.current
        .filter((x) => normTerm(x.term) === key && (x.lesson !== lessonSlug || x.createdAt === undefined || now - x.createdAt >= SESSION_GAP))
        .sort((a, b) => b.parts.length - a.parts.length || (a.createdAt ?? 0) - (b.createdAt ?? 0))[0];
      const level = Math.min(OPEN_DEPTH_MAX, old ? old.level : usualRef.current);
      logEvent(courseSlug, {
        kind: "explore",
        lesson: lessonSlug,
        view: "canvas",
        term: t,
        from: isCard(parent) ? parent.props.term : null,
        section: headingAt(heads.current.get(rootPage) ?? [], root ? root.props.relY : p.relY),
        context: p.context.slice(0, 600),
        card: bare,
        seenBefore: pastRef.current.some((e) => e.term === key && now - e.t > SESSION_GAP),
        // the depth it opens at, so a card opened deeper isn't counted as a level-1 card by usualDepth
        level,
      });
      // Beside what it came from, level with the highlight, below any card already there.
      const sb = ed.getShapePageBounds(source.id)!;
      const top = isDoc(source) ? contentTop(source) : source.y;
      const x = sb.maxX + (source.id === LESSON_ID ? LANE_GUTTER : GAP_X); // beside the lesson: past its definitions
      const w = cardW(level);
      const y = freeY(x, top + p.relY - 24, w, CARD_H, obstacles(ed, new Set([source.id])));
      ed.run(() => {
        ed.createShape({
          id,
          type: CARD,
          x,
          y,
          meta: { lane: x, wantY: y }, // in the column beside what it came from (tidy)
          props: {
            w,
            h: CARD_H,
            term: t,
            context: p.context,
            trail: isCard(parent) ? [...parent.props.trail, parent.props.term] : [],
            parent: isCard(parent) ? bareId(parent.id) : "",
            page: !isCard(parent) && isDoc(page) ? bareId(page.id) : "",
            relX: p.relX,
            relY: p.relY,
            // A new card opens at the learner's usual depth; levels it starts at are not deepens
            // (the deepen log takes a card's first level as its baseline).
            level,
            parts: [0, 1, 2, 3].map((i) => old?.parts[i] ?? ""),
            status: [0, 1, 2, 3].map((i): Status => (old && i < old.parts.length ? "done" : "idle")),
            createdAt: now,
            from: old ? { lesson: old.lesson, card: old.card, ...(old.createdAt !== undefined ? { createdAt: old.createdAt } : {}) } : null,
            recall: old ? { step: "ask" } : null,
          },
        });
      });
      return id;
    },
    [courseSlug, lessonSlug],
  );

  const clearPick = useCallback((p: Pick) => {
    p.range.startContainer.ownerDocument?.defaultView?.getSelection()?.removeAllRanges();
    setPick(null);
  }, []);
  // A press anywhere but on the bar under a highlight lets the highlight go, bar and all (a press in a
  // page's text does this in that page's own document, see wireFrame).
  useEffect(() => {
    const el = root.current;
    if (!el || !pick) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".cv-pick, .hud-knob")) clearPick(pick); // .hud-knob: the HUD's knob and its fan
    };
    el.addEventListener("pointerdown", onDown, true);
    return () => el.removeEventListener("pointerdown", onDown, true);
  }, [pick, clearPick]);

  const explore = useCallback(
    (p: Pick) => {
      const id = spawn(p);
      if (!id) return;
      // once the card has its place, ease onto it at the reading zoom
      requestAnimationFrame(() => {
        const c = editorRef.current?.getShape(id);
        if (!isCard(c)) return;
        const r = screen();
        rememberHome();
        glide({ z: 1, x: Math.min(r.w * 0.52, r.w - CARD_W - 40) - c.x, y: r.h * 0.3 - c.y });
      });
      clearPick(p);
    },
    [spawn, rememberHome, glide, clearPick],
  );

  /** Watch: a short narrated video about a highlight, in a card beside what it came from (as an Explore
      card lands). The job starts at once and the card plays each scene as it is made, the first within
      seconds (VideoView); the board keeps only the video's id, its files stay on disk. */
  const watch = useCallback(
    async (p: Pick) => {
      const ed = editorRef.current;
      const term = p.term.replace(/\s+/g, " ").trim();
      if (!ed || term.length < 2) return;
      clearPick(p);
      const parent = p.parent ? ed.getShape(p.parent) : undefined;
      const page = p.page ? ed.getShape(p.page) : undefined;
      const source = isCard(parent) ? parent : isDoc(page) ? page : ed.getShape(LESSON_ID);
      if (!source) return;
      // What the learner has made of this lesson, so the video builds on it: their notes (own words and clips), the terms
      // they opened cards on, and what they asked the tutor here. The route keeps the newest few and cuts them to length.
      const shapes = ed.getCurrentPageShapes();
      const learner = {
        notes: shapes.filter(isNote).map((n) => ({ topic: docTopic(n.props.doc), text: docBody(n.props.doc), clips: docClips(n.props.doc).map((c) => c.quote) })),
        explored: shapes.filter(isCard).map((c) => c.props.term),
        asked: useTutor
          .getState()
          .threads.filter((t) => t.course === courseSlug && t.lesson === lessonSlug)
          .flatMap((t) => [t.selection, ...t.turns.map((x) => x.q)]),
      };
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course: courseSlug, courseTitle, lesson: lessonTitle, term, context: p.context, heading: p.heading, learner }),
      }).catch(() => null);
      const video = res?.ok ? ((await res.json()) as { job?: { id?: string } }).job?.id : undefined;
      if (!video) return;
      const sb = ed.getShapePageBounds(source.id)!;
      const top = isDoc(source) ? contentTop(source) : source.y;
      const x = sb.maxX + (source.id === LESSON_ID ? LANE_GUTTER : GAP_X);
      const y = freeY(x, top + p.relY - 24, VIDEO_W, VIDEO_H, obstacles(ed, new Set([source.id])));
      const id = createShapeId();
      ed.createShape({
        id,
        type: VIDEO,
        x,
        y,
        props: {
          term, context: p.context, course: courseSlug, video, relX: p.relX, relY: p.relY, createdAt: Date.now(),
          parent: isCard(parent) ? bareId(parent.id) : "",
          page: !isCard(parent) && isDoc(page) ? bareId(page.id) : "",
        },
      });
      const r = screen();
      rememberHome();
      glide({ z: 1, x: Math.min(r.w * 0.52, r.w - VIDEO_W - 40) - x, y: r.h * 0.2 - y });
    },
    [courseSlug, courseTitle, lessonSlug, lessonTitle, rememberHome, glide, clearPick],
  );

  /** Ask the tutor about a highlight, at a depth; the answer opens in the margin. */
  const askTutor = useCallback(
    (p: Pick, level: TutorLevel) => {
      tutor.current?.ask({ selection: p.term, heading: p.heading, context: p.context, level });
      clearPick(p);
    },
    [clearPick],
  );

  // ---- the live lab ("Steer live") ----
  /** Bring a lab into view, as a card is brought: not at all if it is already wholly in the clear
      part of the screen (LAB_FIT), else the least move that shows it, zoomed out only if it doesn't fit.
      The board stays as it is around it: a lab is a note you steer, not a mode. Esc goes back. */
  /** Where the camera was before each lab came into view (its entry on the trail), for closeLab. */
  const labHome = useRef(new Map<TLShapeId, { x: number; y: number; z: number } | undefined>());
  const showLab = useCallback(
    (l: LabShape) => {
      const ed = editorRef.current!;
      const b = ed.getShapePageBounds(l.id);
      if (!b) return;
      const area = labArea(ed, sid(String(l.meta.note ?? "")));
      const cam = ed.getCamera();
      const z = Math.min(cam.z, area.w / b.w, area.h / b.h);
      const at = { x: (b.x + cam.x) * z, y: (b.y + cam.y) * z }; // where it is on screen (at z)
      const to = {
        x: z < cam.z ? area.x + (area.w - b.w * z) / 2 : Math.min(Math.max(at.x, area.x), area.x + area.w - b.w * z),
        y: z < cam.z ? area.y : Math.min(Math.max(at.y, area.y), area.y + area.h - b.h * z),
      };
      if (z === cam.z && Math.abs(to.x - at.x) < 1 && Math.abs(to.y - at.y) < 1) return;
      rememberHome();
      labHome.current.set(l.id, trail.current.at(-1));
      glide({ x: to.x / z - b.x, y: to.y / z - b.y, z });
    },
    [rememberHome, glide],
  );

  /** The lab of a note, if it is open. */
  const labOf = (ed: Editor, note: TLShapeId) => ed.getCurrentPageShapes().find((x): x is LabShape => isLab(x) && x.meta.note === bareId(note));

  /** A note turns into the lab: the one way the lab is launched ("Launch" on a note, and Steer live on
      a highlight). The lab opens out of the note, centred on the screen and most of it (labOpening), and
      the note hides while it is open (noteVisibility), keeping its own place on the board.
      It carries on from the note's starting point, with the clips as its sources; it can't take back
      that start (its floor), and what it writes goes into the note as it writes (labText). Opened
      again, it picks up where it was closed (the note keeps it, labState): what it wrote, the knob, its
      boxes and dials, and the knob can go back into its own text; if the learner changed the note
      since, it starts from the note as it is, with its dials (lib/note.ts labStart). Several notes can
      be labs at once; only one runs (LabView). */
  function launchNote(note: NoteShape) {
    readLabModel();
    const ed = editorRef.current!;
    // A pinned or docked note keeps that state across its lab: the note is hidden while the lab is open (the lab shape is never
    // pinned itself), and closeLab puts it back on its pin or in the dock. (It used to clear only the pin, orphaning a dock.)
    const open = labOf(ed, note.id);
    if (open) return showLab(open);
    const { doc } = note.props;
    const topic = docTopic(doc);
    if (!topic) return;
    const clips = docClips(doc);
    const sources = clips.map(({ quote, where, around, weight }) => ({ quote, where, around, weight }));
    const saved = isSavedLab(note.meta.lab) ? note.meta.lab : undefined;
    const { run, start: prefix } = labStart(doc, saved, prefixOf, newId());
    const id = createShapeId();
    const { x, y, w, h } = labOpening(ed, note.id);
    ed.run(
      () =>
        ed.createShape({
          id,
          type: LAB,
          x,
          y,
          meta: { note: bareId(note.id), run },
          props: {
            w, h, topic, section: clips[0]?.heading ?? "", from: "", relX: 0, relY: 0,
            start: prefix, prefix, sources,
          },
        }),
      { history: "ignore" },
    );
    const l = ed.getShape(id);
    if (isLab(l)) showLab(l);
  }

  /** Steer live on a highlight: a note with that passage as its only clip, launched at once. A short
      highlight is the starting point's heading itself; a longer passage would make a poor heading, so
      the model names one first ("Steer from this", makeStart) and the note launches once it has. If
      none comes back, it launches anyway under the passage's first words. */
  function steerLive(p: Pick) {
    const t = p.term.replace(/\s+/g, " ").trim();
    const words = t.split(" ");
    if (words.length <= TOPIC_WORDS) {
      const n = noteBeside(p, { doc: startDoc(t, [clipOf(p)]) });
      clearPick(p);
      if (n) launchNote(n);
      return;
    }
    const n = noteBeside(p, { doc: startDoc("", [clipOf(p)]) });
    clearPick(p);
    if (!n) return;
    const launchAs = (topic: string) => {
      const m0 = editorRef.current!.getShape(n.id);
      if (isNote(m0)) editorRef.current!.updateShape<NoteShape>({ id: n.id, type: NOTE, props: { doc: withStart(m0.props.doc, topic, "") } });
      const m = editorRef.current!.getShape(n.id);
      if (isNote(m)) launchNote(m);
    };
    makeStart(n.id).then(
      () => {
        const m = editorRef.current?.getShape(n.id);
        if (isNote(m) && docTopic(m.props.doc)) launchNote(m);
      },
      (e) => {
        console.error("Steer live: no starting point came back for the passage; launching under its first words", e);
        if (isNote(editorRef.current?.getShape(n.id))) launchAs(`${words.slice(0, TOPIC_WORDS).join(" ").replace(/[.,;:]$/, "")}…`);
      },
    );
  }

  /** Close a lab: back to where the reader was (if it moved them), and the lab shrinks into its note and goes, stopping its
      sound and requests. Its note shows again where it was, holding what the lab wrote (labText kept it as it went),
      and what it showed, to open from again (labState). One undo step opens it again, as it was. */
  const closing = useRef(new Set<TLShapeId>());
  function closeLab(id: TLShapeId) {
    if (closing.current.has(id)) return;
    // back to where the reader was before the lab came into view, unless they went back already (Esc in
    // the lab): that step is gone from the trail, and going back again would land on an older jump
    const home = labHome.current.get(id);
    labHome.current.delete(id);
    if (home && trail.current.at(-1) === home) goBack();
    const ed = editorRef.current!;
    const l = ed.getShape(id);
    if (!isLab(l)) return;
    const note = ed.getShape(sid(String(l.meta.note ?? "")));
    const from = isNote(note) ? ed.getShapePageBounds(note.id) : undefined;
    const box = ed.getShapePageBounds(id);
    const el = ed.getContainer().querySelector(`.tl-shape[data-shape-id="${id}"] .cv-lab`);
    closing.current.add(id);
    (from && box ? morphLab(el, from, box, false) : Promise.resolve()).then(() => {
      closing.current.delete(id);
      if (!isLab(ed.getShape(id))) return;
      ed.markHistoryStoppingPoint("close lab");
      ed.run(() => {
        // The note stays where it is (the lab floated over the board); a docked or pinned one is set back on the dock or its pin
        // for the camera now, as the camera may have moved while it was hidden.
        const at = !isNote(note) ? undefined : note.meta.dock ? dockAt(ed, note) : isPin(note.meta.pin) ? pinnedAt(note.meta.pin as Pin, ed.getCamera()) : undefined;
        if (at) ed.updateShape<NoteShape>({ id: note!.id, type: NOTE, ...at });
        ed.deleteShapes([id]);
      });
    });
  }

  /** What a lab opening now resumes: what its note kept of it (labState), all of it if it is the same
      lab (its run and start), else its dials. */
  function labResumeOf(id: TLShapeId): Partial<LabState> | undefined {
    const ed = editorRef.current;
    const l = ed?.getShape(id);
    if (!ed || !isLab(l)) return undefined;
    const note = ed.getShape(sid(String(l.meta.note ?? "")));
    const saved = isNote(note) && isSavedLab(note.meta.lab) ? (note.meta.lab as SavedLab<LabState>) : undefined;
    return labResume(saved, String(l.meta.run ?? ""), l.props.start);
  }

  /** A lab's state as it settles, pauses or goes: kept on its note (outside undo), to open from again. */
  function labState(note: string, run: string, start: string, state: LabState) {
    const ed = editorRef.current;
    const n = ed?.getShape(sid(note));
    if (!ed || !isNote(n)) return;
    // as JSON, which is all a shape's meta may hold: a dial's unset fields (undefined) go, a number that isn't one becomes null
    const lab = JSON.parse(JSON.stringify({ run, start, state } satisfies SavedLab<LabState>));
    if (JSON.stringify(lab) !== JSON.stringify(n.meta.lab)) quietly(() => ed.updateShape<NoteShape>({ id: n.id, type: NOTE, meta: { ...n.meta, lab } }));
  }

  /** A lab's text up to its knob, as it changes: what it wrote past the note's starting point goes into
      the note as the lab's (this session's run: dragging the knob back takes it out again), so the note
      keeps it (through a reload too) and the next launch carries on from it. */
  function labText(id: TLShapeId, text: string) {
    const ed = editorRef.current;
    const l = ed?.getShape(id);
    if (!ed || !isLab(l)) return;
    const note = ed.getShape(sid(String(l.meta.note ?? "")));
    if (!isNote(note)) return;
    const run = String(l.meta.run ?? bareId(id));
    const doc = appendText(dropRun(note.props.doc, run), labRest(text, l.props.prefix), "lab", run);
    if (JSON.stringify(doc) !== JSON.stringify(note.props.doc)) quietly(() => ed.updateShape<NoteShape>({ id: note.id, type: NOTE, props: { doc } }));
  }

  // ---- notes ----
  // A note is the learner's own: they write in it, and → Note clips highlights into it from the
  // lesson, a linked page or a card. Each clip marks its passage (N) for as long as it is in the note.
  const lastNote = useRef<TLShapeId | null>(null); // the note last touched: → Note sends there

  /** Pin a note to its spot on the screen, on top of the rest, or unpin it where it is (lib/note.ts). */
  function pinNote(id: TLShapeId) {
    const ed = editorRef.current!;
    const n = ed.getShape(id);
    if (!isNote(n)) return;
    quietly(() => {
      ed.updateShape<NoteShape>({ id, type: NOTE, meta: { ...n.meta, pin: isPin(n.meta.pin) ? null : pinOf(n, ed.getCamera()) } });
      if (!isPin(n.meta.pin)) ed.bringToFront([id]);
    });
  }
  // The lab's text model, as picked in the control room's Models tab, for stamping its steer events. Read as the canvas opens and
  // again at each launch, so a change made meanwhile is stamped from the next launch on.
  const labModel = useRef(LAB_CLAUDE_MODEL);
  const readLabModel = () =>
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { lab?: string } | null) => {
        if (d?.lab) labModel.current = d.lab;
      })
      .catch(() => {});
  useEffect(() => void readLabModel(), []);
  // Where the pointer last was (screen px), over the board or over a page on it (wireFrame: a page's
  // frame keeps its own pointer events). N puts a note there.
  const pointerAt = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => (pointerAt.current = { x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);

  /** A new note with its top-left at a point on the board, as an undo step; it takes the next → Note. */
  function addNote(at: { x: number; y: number }, props: Partial<NoteProps> = {}, meta: Record<string, number | boolean | null> = {}): NoteShape {
    const ed = editorRef.current!;
    const id = createShapeId();
    ed.markHistoryStoppingPoint("new note");
    ed.createShape({ id, type: NOTE, x: at.x, y: at.y, meta, props: { createdAt: Date.now(), ...props } });
    lastNote.current = id;
    return ed.getShape(id) as NoteShape;
  }

  /** N or a double-click: a note at a point (kept on screen), ready to type in. */
  function noteAt(at: { x: number; y: number }) {
    const ed = editorRef.current!;
    const vp = ed.getViewportPageBounds();
    ed.setCurrentTool("select");
    const { id } = addNote({ x: Math.max(vp.x, Math.min(at.x, vp.maxX - NOTE_W)), y: Math.max(vp.y, Math.min(at.y, vp.maxY - NOTE_H)) });
    let tries = 0;
    const focus = () => {
      const t = noteEditor(id);
      if (t) t.commands.focus();
      else if (++tries < 10) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }
  const noteAtRef = useRef(noteAt);
  noteAtRef.current = noteAt;

  /** N: a note where the pointer is (when it is on the board); the toolbar's note: in the middle of the view. Either
      way it docks at the screen's right edge as the current note (→ Note goes there); the note docked before goes back to
      where it was made. A double-click on an empty spot still makes a note there, on the board. */
  function newNote(atPointer: boolean) {
    const ed = editorRef.current!;
    const vp = ed.getViewportPageBounds();
    const p = atPointer && pointerAt.current ? ed.screenToPage(pointerAt.current) : null;
    noteAt(p && vp.containsPoint(p) ? p : { x: vp.center.x - NOTE_W / 2, y: vp.center.y - NOTE_H / 2 });
    const n = lastNote.current ? ed.getShape(lastNote.current) : undefined;
    if (isNote(n)) dock(n);
  }

  /** The note → Note sends to: the one last touched, else the newest; null when there is none. */
  function targetNote(): NoteShape | null {
    const ed = editorRef.current!;
    const docked = ed.getCurrentPageShapes().find((n): n is NoteShape => isNote(n) && !!n.meta.dock);
    if (docked) return docked;
    const last = lastNote.current ? ed.getShape(lastNote.current) : undefined;
    if (isNote(last)) return last;
    return ed.getCurrentPageShapes().filter(isNote).sort((a, b) => b.props.createdAt - a.props.createdAt)[0] ?? null;
  }

  /** A highlight as a clip: its words, a short label for where it is, and what finds it again. */
  function clipOf(p: Pick): Clip {
    const ed = editorRef.current!;
    const card = p.parent ? ed.getShape(p.parent) : undefined;
    const page = p.page ? ed.getShape(p.page) : undefined;
    return {
      id: newId(),
      quote: p.term.replace(/\s+/g, " ").trim(),
      where: isCard(card) ? card.props.term : isDoc(page) ? page.props.title : p.heading || lessonTitle,
      around: p.context.slice(0, 1200),
      heading: p.heading,
      card: isCard(card) ? bareId(card.id) : "",
      page: !isCard(card) && isDoc(page) ? bareId(page.id) : "",
      relX: p.relX,
      relY: p.relY,
    };
  }

  /** A new note beside a highlight (where a card would open), level with it, below anything already there. */
  function noteBeside(p: Pick, props: Partial<NoteProps>): NoteShape | null {
    const ed = editorRef.current!;
    const parent = p.parent ? ed.getShape(p.parent) : undefined;
    const page = p.page ? ed.getShape(p.page) : undefined;
    const source = isCard(parent) ? parent : isDoc(page) ? page : ed.getShape(LESSON_ID);
    if (!source) return null;
    const x = ed.getShapePageBounds(source.id)!.maxX + (source.id === LESSON_ID ? LANE_GUTTER : GAP_X); // past the lesson's definitions
    const top = isDoc(source) ? contentTop(source) : source.y;
    const y = freeY(x, top + p.relY - 24, NOTE_W, NOTE_H, obstacles(ed, new Set([source.id])));
    return addNote({ x, y }, props, { lane: x, wantY: y }); // in the column beside the highlight, as a card is (tidy)
  }

  /** → Note: the passage joins the note last touched as a clip (once: the same passage twice stays
      one clip), at its end, or starts a note beside the highlight when there is none. into: the note it
      was dragged onto (carryPick), instead of the one last touched; at: where in its text it was let go. */
  function toNote(p: Pick, into?: NoteShape, at?: At) {
    const clip = clipOf(p);
    if (!clipInto(clip, into, at)) noteBeside(p, { doc: startDoc("", [clip]) });
    clearPick(p);
  }
  /** A clip into the note it was dropped on (at: where in its text), else the one last touched, at its
      end. false: there is no note to take it. */
  function clipInto(clip: Clip, into?: NoteShape, at?: At): boolean {
    const n = into ?? targetNote();
    if (!n) return false;
    editorRef.current!.updateShape<NoteShape>({ id: n.id, type: NOTE, props: { doc: insertClip(n.props.doc, clip, at) } });
    lastNote.current = n.id;
    flash(n.id);
    return true;
  }
  /** → Note on words selected in a tutor answer (or them dragged onto a note): a clip of that answer,
      into a note as a highlight's is, or a new note in the middle of the view when there is none. */
  function tutorToNote(b: TutorBit, into?: NoteShape, at?: At) {
    const clip = clipFromTutor(b, newId());
    if (clipInto(clip, into, at)) return;
    const vp = editorRef.current!.getViewportPageBounds();
    addNote({ x: vp.center.x - NOTE_W / 2, y: vp.center.y - NOTE_H / 2 }, { doc: startDoc("", [clip]) });
  }
  /** → Note on words snipped from a board-chat reply (or them dragged onto a note): a clip into the note
      it was dropped on, else the one last used, or a new one in view when there is none. */
  function chatToNote(b: ChatBit, into?: NoteShape, at?: At) {
    const clip = clipFromChat(b, newId());
    if (clipInto(clip, into, at)) return;
    const vp = editorRef.current!.getViewportPageBounds();
    addNote({ x: vp.center.x - NOTE_W / 2, y: vp.center.y - NOTE_H / 2 }, { doc: startDoc("", [clip]) });
  }
  /** What the board can tell the chat about what the learner is reading and has gathered: their notes and
      the terms they opened as cards. Read when a message is sent, and capped so the prompt stays lean. */
  function boardContext(): string {
    const parts: string[] = [];
    const written = notes
      .map((n) => [docTopic(n.props.doc), docPlain(n.props.doc).slice(0, 800)].filter(Boolean).join("\n"))
      .filter(Boolean);
    if (written.length) parts.push(`Their notes:\n${written.join("\n\n")}`);
    const terms = [...new Set(cards.map((c) => c.props.term).filter(Boolean))];
    if (terms.length) parts.push(`Terms they opened as cards: ${terms.join(", ")}`);
    return parts.join("\n\n").slice(0, 6000);
  }

  // ---- dragging a highlight onto a note ----
  // Press on the highlight (in the lesson, a linked page or a card) and drag: a chip with its words
  // follows the pointer, the note under it lights up with a caret where in its text the clip would go,
  // and letting go there clips it in at the caret. Let go anywhere else and nothing happens: the highlight stays. A press that moves
  // less than CARRY_PX is a click, as before. Only a plain press on the highlight itself starts this,
  // so highlighting new text, Alt + click and Shift + click work as they did.
  const [carry, setCarry] = useState<{ quote: string; x: number; y: number } | null>(null); // the chip; x, y from the board's top-left
  const carryChip = useRef<HTMLDivElement>(null);
  const carryCaret = useRef<HTMLDivElement>(null);

  /** A position in a note's editor as lib/note.ts counts places: an inline block at the top of the note
      and the offset into it. Anywhere else (in a list, say), none: the clip goes at the end. */
  function placeIn(t: TipTap | undefined, pos: number | null): At | undefined {
    if (!t || pos === null) return undefined;
    const $p = t.state.doc.resolve(Math.min(pos, t.state.doc.content.size));
    return $p.depth === 1 && $p.parent.isTextblock ? { block: $p.index(0), offset: $p.parentOffset } : undefined;
  }

  /** The note on top at a screen point on the board, if a note is what is on top there. A note that is
      a lab just now is hidden (noteVisibility), so it is never one. */
  function noteUnder(pt: { x: number; y: number }): NoteShape | null {
    const ed = editorRef.current!;
    if (!ed.getViewportScreenBounds().containsPoint(pt)) return null;
    const s = ed.getShapeAtPoint(ed.screenToPage(pt), { hitInside: true, renderingOnly: true });
    return isNote(s) ? s : null;
  }

  function carryPick(p: Pick, win: Window, down: PointerEvent) {
    carryPassage(p.term, win, down, (n, at) => toNote(p, n, at), () => clearPick(p));
  }

  /** Follow a press on a passage (a highlight, or words selected in the tutor) until it is let go: let
      go on a note, drop puts it there; let go without moving, it was a click. win: the window the passage
      is in, the board's or a page's frame's; pointer capture keeps the press's moves coming there
      wherever the pointer goes. */
  function carryPassage(quote: string, win: Window, down: PointerEvent, drop: (n: NoteShape, at?: At) => void, click: () => void) {
    const ed = editorRef.current!;
    const frame = win === window ? null : (win.frameElement as HTMLIFrameElement | null);
    // a page's own px to the board's screen px, as its wheel is forwarded (wireFrame)
    const screenOf = (e: PointerEvent) => {
      if (!frame) return { x: e.clientX, y: e.clientY };
      const r = frame.getBoundingClientRect();
      const z = ed.getZoomLevel();
      return { x: r.left + e.clientX * z, y: r.top + e.clientY * z };
    };
    const from = screenOf(down);
    const el = down.target as HTMLElement;
    el.setPointerCapture(down.pointerId);
    let moved = false;
    let over: { note: NoteShape; lab: LabShape | null } | null = null;
    let dropPos: number | null = null; // where in the note's text it would go
    /** The drop target on top at a screen point: a note, or a lab — a passage dropped on an open lab clips into its (hidden)
        note at the end, and the lab writes from it at once (no in-note caret, as the note's text isn't shown under the lab). */
    const dropUnder = (pt: { x: number; y: number }): { note: NoteShape; lab: LabShape | null } | null => {
      const n = noteUnder(pt);
      if (n) return { note: n, lab: null };
      if (!ed.getViewportScreenBounds().containsPoint(pt)) return null;
      const s = ed.getShapeAtPoint(ed.screenToPage(pt), { hitInside: true, renderingOnly: true });
      if (isLab(s)) {
        const m = ed.getShape(sid(String(s.meta.note ?? "")));
        if (isNote(m)) return { note: m, lab: s };
      }
      return null;
    };
    /** The caret in the note under the pointer, where the clip would go; none off a note's text. */
    const aim = (n: NoteShape | null, at: { x: number; y: number }, vp: { x: number; y: number }) => {
      const t = n ? noteEditor(n.id) : undefined;
      const hit = t?.view.posAtCoords({ left: at.x, top: at.y });
      const c = carryCaret.current;
      dropPos = hit ? hit.pos : null;
      if (!c) return;
      if (!t || !hit) return void (c.hidden = true);
      const r = t.view.coordsAtPos(hit.pos);
      Object.assign(c.style, { left: `${r.left - vp.x - 1}px`, top: `${r.top - vp.y}px`, height: `${Math.max(12, r.bottom - r.top)}px` });
      c.hidden = false;
    };
    const light = (d: { note: NoteShape; lab: LabShape | null } | null, on: boolean) => {
      if (!d) return;
      const sel = d.lab ? `.tl-shape[data-shape-id="${d.lab.id}"] .cv-lab` : `.tl-shape[data-shape-id="${d.note.id}"] .cv-note`;
      document.querySelector(sel)?.classList.toggle("cv-drop", on);
    };
    const move = (e: PointerEvent) => {
      const at = screenOf(e);
      if (!moved && Math.hypot(at.x - from.x, at.y - from.y) < CARRY_PX) return;
      const vp = ed.getViewportScreenBounds();
      const x = at.x - vp.x + 12; // below and right of the pointer, so the pointer stays in sight
      const y = at.y - vp.y + 14;
      if (!moved) setCarry({ quote, x, y });
      else if (carryChip.current) Object.assign(carryChip.current.style, { left: `${x}px`, top: `${y}px` });
      moved = true;
      const d = dropUnder(at);
      aim(d && !d.lab ? d.note : null, at, vp); // over a lab, the clip goes at its note's end: no caret to place
      if (d?.note.id === over?.note.id) return;
      light(over, false);
      light(d, true);
      over = d;
    };
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const done = (e: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", done);
      el.removeEventListener("pointercancel", done);
      if (!moved) {
        // a click: the highlight goes, as a press on it always let it go, and the click goes on to the
        // page or card (a marked passage takes you to its card or note, a link opens)
        if (e.type === "pointerup") click();
        return;
      }
      setCarry(null);
      light(over, false);
      // the click this release makes was a drag, not a click on whatever is under it
      win.addEventListener("click", swallow, true);
      setTimeout(() => win.removeEventListener("click", swallow, true), 0);
      const n = over ? ed.getShape(over.note.id) : undefined;
      if (e.type === "pointerup" && isNote(n)) drop(n, over?.lab ? undefined : placeIn(noteEditor(n.id), dropPos));
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", done);
    el.addEventListener("pointercancel", done);
  }
  const carryRef = useRef(carryPick);
  carryRef.current = carryPick;
  // While there is a highlight, a plain press on it starts carryPick. It is caught in the highlight's own
  // window before anything else there sees it: the press-anywhere effect above, or a page's mousedown,
  // would let the highlight go.
  useEffect(() => {
    const win = pick?.range.startContainer.ownerDocument?.defaultView;
    if (!editor || !pick || !win) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
      // in a card, only its text takes it (with the pen, say, the press is the board's); a page's frame
      // gets presses only while the select tool is idle anyway (DocView)
      const node = pick.range.commonAncestorContainer;
      const box = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest(".cv-body") ?? win.document.documentElement;
      if (!box.contains(e.target as Node)) return;
      if (!Array.from(pick.range.getClientRects()).some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)) return;
      if (pick.parent && drawnOver(editor, pick.parent, e.clientX, e.clientY)) return; // a drawing on top is the board's
      e.preventDefault(); // the highlight stays as it is, and no new one starts
      e.stopPropagation();
      carryRef.current(pick, win, e);
    };
    win.addEventListener("pointerdown", onDown, true);
    return () => win.removeEventListener("pointerdown", onDown, true);
  }, [editor, pick]);

  /** "Steer from this": the note's clips and the learner's text go to /api/note/opening, which names a
      topic and writes a bridge on from the text's last word: the topic becomes the heading (when the
      note has none) and the bridge follows the learner's words, both marked as the model's. The
      learner's words never come back from the model. A new starting point starts over: what the model
      and the lab wrote before goes (one undo step brings it back); what the learner typed stays. */
  async function makeStart(id: TLShapeId) {
    const n = editorRef.current?.getShape(id);
    if (!isNote(n)) return;
    const mine = dropAuthored(n.props.doc, ["model", "lab"]);
    const res = await fetch("/api/note/opening", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course: courseTitle, lesson: lessonTitle, clips: docClips(mine).map(({ quote, where, around }) => ({ quote, where, around })), draft: docBody(mine) }),
    });
    if (!res.ok) throw new Error((await res.text().catch(() => "")) || `No starting point came back (${res.status}).`);
    const { topic, bridge } = (await res.json()) as { topic: string; bridge: string };
    const now = editorRef.current?.getShape(id); // as it is now: anything typed meanwhile stays
    if (!isNote(now)) return; // removed meanwhile
    editorRef.current!.updateShape<NoteShape>({ id, type: NOTE, props: { doc: withStart(dropAuthored(now.props.doc, ["model", "lab"]), topic, bridge) } });
  }

  /** ↗ on a clip: glide to its passage (where its mark is, else where it was highlighted), opening its
      page if it was minimized. Esc comes back to the note. */
  /** A clip's steer set from inside the lab (the note is hidden while the lab is open): a weight, or a `use`
      the learner picked from the model's ways, onto the clip node in the note's doc, so it persists and
      LabView re-reads it as a source and rewrites the text. */
  function steerClip(id: TLShapeId, clipId: string, steer: ClipSteer) {
    const ed = editorRef.current!;
    const n = ed.getShape(id);
    if (!isNote(n)) return;
    const doc = setClipSteer(n.props.doc, clipId, steer);
    if (doc !== n.props.doc) quietly(() => ed.updateShape<NoteShape>({ id, type: NOTE, props: { doc } }));
  }

  function goToClip(id: TLShapeId, clipId: string) {
    const ed = editorRef.current!;
    const n = ed.getShape(id);
    const c = isNote(n) ? docClips(n.props.doc).find((x) => x.id === clipId) : undefined;
    if (c?.thread === CHAT_THREAD) {
      setChatOpen(true); // a chat clip has no board source: reopen the chat sheet
      return;
    }
    if (c?.thread) {
      setTutorOpen(true);
      tutor.current?.open(c.thread);
      return;
    }
    const s = c && ed.getShape(clipSrc(c));
    if (!c || !(isDoc(s) || isCard(s))) return;
    if (isDoc(s) && s.props.collapsed) ed.updateShape<DocShape>({ id: s.id, type: DOC, props: { collapsed: false } });
    const tag = tags.find((t) => t.key === `${id}:${clipId}`);
    const top = isDoc(s) ? contentTop(s) : s.y;
    const p = { x: s.x + (tag?.x ?? c.relX), y: top + (tag?.y ?? c.relY) };
    const b = ed.getShapePageBounds(s.id)!;
    const z = Math.max(1, ed.getZoomLevel());
    const r = screen();
    rememberHome();
    glide({ z, x: r.w / 2 / z - (b.w * z < r.w - 80 ? b.center.x : p.x), y: (r.h * 0.42) / z - p.y });
  }

  /** Light up a card or a note for a moment (the one a mark or → Note just went to). */
  function flash(id: TLShapeId) {
    const el = document.querySelector(`.tl-shape[data-shape-id="${id}"] :is(.cv-card, .cv-note, .fr-chip)`);
    el?.classList.remove("cv-flash");
    requestAnimationFrame(() => el?.classList.add("cv-flash"));
    setTimeout(() => el?.classList.remove("cv-flash"), 1600);
  }

  // ---- linked pages ----
  /** Open a page beside the lesson (or glide to it if it is already open): path is a lesson or
      cheat sheet, or with href an external page's app copy. from: the page the link was clicked on
      (null = the lesson); linkY: the link's top there; anchor: the link's end there, for the arrow. */
  const openPage = useCallback(
    (
      path: string, label: string, from: DocShape | null, linkY: number, href?: string, jump?: string, anchor?: { relX: number; relY: number },
      free?: { x: number; y: number }, // a page opened from a pasted link: near this point, joined to nothing
    ) => {
      const ed = editorRef.current!;
      const lesson = ed.getShape(LESSON_ID) as DocShape;
      let at: DocShape | undefined =
        path === new URL(src, window.location.href).pathname ? lesson : ed.getCurrentPageShapes().find((s): s is DocShape => isDoc(s) && s.props.src === path);
      if (!at) {
        const id = createShapeId();
        const source = from ?? lesson;
        let title = label.replace(/\s+/g, " ").trim();
        if (!title) title = href ? new URL(href).host : decodeURIComponent(path.split("/").pop() ?? "");
        // to the right of everything on the board, level with the link; a free page where you are
        // looking, slid right past anything already there
        let x = rightEdge(ed) + 2 * GAP_X;
        let y = Math.max(0, contentTop(source) + linkY - 120) - BAR_H;
        if (free) {
          x = free.x - PAGE_W / 2;
          y = free.y;
          const taken = obstacles(ed, new Set());
          const hits = (r: Rect) => x < r.x + r.w && r.x < x + PAGE_W && y < r.y + r.h && r.y < y + 1000;
          for (let r = taken.find(hits); r; r = taken.find(hits)) x = r.x + r.w + GAP_X;
        }
        ed.run(() => {
          ed.createShape({
            id,
            type: DOC,
            x,
            y,
            props: {
              role: "page", src: path, href: href ?? "", jump: jump ?? "", title, w: PAGE_W, h: 1000,
              from: from ? bareId(from.id) : "", relX: anchor?.relX ?? 0, relY: anchor?.relY ?? 0,
            },
          });
        });
        at = ed.getShape(id) as DocShape;
      } else if (jump && at.props.role === "page") {
        // the page is already open; the jump effect glides to the fragment once it reads it
        quietly(() => ed.updateShape<DocShape>({ id: at!.id, type: DOC, props: { jump, collapsed: false } }));
      }
      const r = screen();
      rememberHome();
      glide({ z: 1, x: Math.min(60, (r.w - PAGE_W) / 2) - at.x, y: 70 - contentTop(at) });
    },
    [src, rememberHome, glide, quietly],
  );

  /** Open any web address as a page on the board, joined to nothing: where it was pasted, or where
      you are looking. A course page opens as itself, anything else through the app's copy. False:
      not something that can open here. */
  const openLink = useCallback(
    (raw: string, point?: { x: number; y: number }) => {
      const ed = editorRef.current;
      const text = raw.trim();
      if (!ed || !text || /\s/.test(text)) return false;
      let url: URL;
      try {
        url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
      } catch {
        return false;
      }
      const own = url.origin === window.location.origin && /^\/courses\/.+\.html$/.test(url.pathname);
      if (!own && (!/^https?:$/.test(url.protocol) || !url.hostname.includes("."))) return false;
      const vp = ed.getViewportPageBounds();
      const at = point ?? { x: vp.center.x, y: vp.y + 60 / ed.getZoomLevel() };
      const jump = url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined;
      if (own) openPage(url.pathname, "", null, 0, undefined, jump, undefined, at);
      else openPage(proxied(url.href), "", null, 0, url.href, jump, undefined, at);
      return true;
    },
    [openPage],
  );
  const openLinkRef = useRef(openLink);
  openLinkRef.current = openLink;
  const [linkBar, setLinkBar] = useState(false);

  /** A newly opened (or re-targeted) linked page carries a #fragment as props.jump. Glide the board
      to that element once its frame has loaded; a copied page keeps shifting as its CSS and fonts
      arrive (each shift changes its height), so re-align on every change and release the jump a
      short beat after the last one, rather than pinning to a half-laid-out position. */
  useEffect(() => {
    const pg = jumping;
    const ed = editorRef.current;
    if (!pg || !ed) return;
    const doc = frames.current.get(bareId(pg.id))?.contentDocument;
    if (!doc || doc.readyState !== "complete") return;
    const el = doc.getElementById(pg.props.jump) ?? doc.getElementsByName(pg.props.jump)[0];
    if (!el) return; // the id isn't in the page yet; keep the flag and try on the next change
    const cam = ed.getCamera();
    glide({ ...cam, y: 70 / cam.z - (contentTop(pg) + el.getBoundingClientRect().top) });
    const t = setTimeout(() => quietly(() => ed.updateShape<DocShape>({ id: pg.id, type: DOC, props: { jump: "" } })), 1200);
    return () => clearTimeout(t);
  }, [jumping, glide, quietly]);

  function closePage(id: TLShapeId) {
    const ed = editorRef.current!;
    ed.deleteShapes([id, ...followers(ed, id).map((c) => c.id)]);
    frames.current.delete(bareId(id));
    setPick(null);
  }

  /** Fetch a web page from its site again (the app's copy may be up to a day old), then reload its frame. */
  async function refreshPage(id: TLShapeId) {
    const p = editorRef.current?.getShape(id);
    if (!isDoc(p) || !p.props.href) return;
    await fetch(`${p.props.src}${p.props.src.includes("?") ? "&" : "?"}fresh=1`, { cache: "no-store" }).catch(() => {});
    frames.current.get(bareId(id))?.contentWindow?.location.reload();
  }

  /** Fold a linked page down to a small chip (the arrows stay), or open it again. */
  function togglePage(id: TLShapeId) {
    const ed = editorRef.current!;
    const p = ed.getShape(id);
    if (isDoc(p)) ed.updateShape<DocShape>({ id, type: DOC, props: { collapsed: !p.props.collapsed } });
  }

  /** A click in a page on the board (doc; page: the linked page it is, null = the lesson). Links
      to lessons, cheat sheets and other sites open beside it; a #jump glides the board there. */
  const followLink = useRef<(e: MouseEvent, doc: Document, page: DocShape | null) => void>(() => {});
  followLink.current = (e, doc, page) => {
    // A modified click keeps the browser's own meaning (new tab, new window).
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    // the lesson's own way out (Library, Course map), and "open in a new tab" on a page that couldn't load
    if (!a || /^_(parent|top)$/.test(a.target) || a.dataset.out) return;
    const url = new URL(a.href);
    const here = new URL(page?.props.href || doc.location.href);
    if (url.origin + url.pathname + url.search === here.origin + here.pathname + here.search) {
      // A jump within this page. The frame never scrolls (it is as tall as its page), so the
      // board glides to the spot instead.
      e.preventDefault();
      const id = decodeURIComponent(url.hash.slice(1));
      const el = id ? (doc.getElementById(id) ?? doc.getElementsByName(id)[0]) : doc.body;
      const shape = page ?? docOf("");
      if (!el || !shape) return;
      const cam = editorRef.current!.getCamera();
      rememberHome();
      glide({ ...cam, y: 70 / cam.z - (contentTop(shape) + el.getBoundingClientRect().top) });
    } else if (url.origin !== window.location.origin) {
      e.preventDefault();
      // Another site: the app serves a readable copy beside the lesson (see /api/page), unless
      // publishing found it can't be read here (data-open="tab", set by scripts/sync-courses.mjs).
      if (/^https?:$/.test(url.protocol) && a.dataset.open !== "tab") {
        const r = a.getBoundingClientRect();
        openPage(proxied(url.href), a.textContent ?? "", page, r.top, url.href, url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined, { relX: r.right, relY: r.top + r.height / 2 });
      } else window.open(url.href, "_blank", "noopener"); // and mailto: and the like
    } else if (/^\/courses\/.+\.html$/.test(url.pathname)) {
      e.preventDefault();
      const r = a.getBoundingClientRect();
      openPage(url.pathname, a.textContent ?? "", page, r.top, undefined, url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined, { relX: r.right, relY: r.top + r.height / 2 });
    } else {
      e.preventDefault();
      window.location.assign(url.href); // an app page: leave the canvas for it
    }
  };

  // The lesson iframe and each linked page are same-origin: size them to their content, hand their
  // wheel and keys to the board (a frame keeps its own events), offer their text selections as
  // cards or tutor questions, and open their links beside them instead of inside the frame.
  // key: "" for the lesson, else the linked page's bare id.
  const wireFrame = useCallback(
    (frame: HTMLIFrameElement, key: string) => {
      const ed = editorRef.current;
      const doc = frame.contentDocument;
      const win = frame.contentWindow as (Window & typeof globalThis) | null;
      if (!ed || !doc?.body || !win || doc.location.href === "about:blank" || wired.current.has(doc)) return;
      wired.current.add(doc);
      const id = key ? sid(key) : LESSON_ID;
      const pageNow = () => (key ? docOf(key) : null);
      doc.documentElement.style.overflow = "hidden";
      if (key && doc.title) quietly(() => ed.updateShape<DocShape>({ id, type: DOC, props: { title: doc.title } }));
      const size = () => {
        if (frame.clientWidth === 0) return; // not laid out: its height would be meaningless
        const h = Math.max(600, doc.documentElement.scrollHeight);
        const s = ed.getShape(id);
        if (isDoc(s) && s.props.h !== h) quietly(() => ed.updateShape<DocShape>({ id, type: DOC, props: { h } }));
        scheduleMarks.current(); // the page reflowed: its marks move
        // the frame never scrolls (it is sized to its content), so client tops are document tops
        heads.current.set(
          key,
          Array.from(doc.querySelectorAll("h1, h2"), (el) => ({ // the h1 names the part above the first h2, as in the reader
            top: el.getBoundingClientRect().top,
            text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
          })),
        );
      };
      size();
      new win.ResizeObserver(size).observe(doc.body);
      // a press in a linked page brings it to the front, as a press on anything does
      if (key) doc.addEventListener("pointerdown", () => tidy.current.touch(id), true);
      // the lesson defines what is highlighted in it, at once (the HUD)
      // and so does each linked page, with its own glossary (a website's: definitions written live only)
      if (!key) attachLesson(doc, win, { id: LESSON_ID, course: courseSlug, lesson: lessonSlug, title: lessonTitle });
      else {
        const pg = pageNow();
        if (pg) attachPage(doc, win, { id, course: courseSlug, src: pg.props.src, href: pg.props.href, title: pg.props.title || doc.title });
      }

      doc.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          const r = frame.getBoundingClientRect();
          const z = ed.getZoomLevel();
          ed.dispatch({
            type: "wheel",
            name: "wheel",
            delta: wheelDelta(e),
            point: { x: r.left + e.clientX * z, y: r.top + e.clientY * z, z: 0.5 },
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            ctrlKey: e.metaKey || e.ctrlKey,
            metaKey: e.metaKey,
            accelKey: isMac ? e.metaKey : e.ctrlKey,
          });
        },
        { passive: false },
      );

      // Keys pressed while the page has focus go to the board too (Space to pan, tool shortcuts,
      // Esc), except in the page's own fields and with Ctrl/Cmd (copy, find… stay the page's).
      const forward = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement;
        if (takesText(t) || e.ctrlKey || e.metaKey) return;
        if (e.code === "Space") e.preventDefault();
        ed.getContainer().dispatchEvent(
          new KeyboardEvent(e.type, { key: e.key, code: e.code, shiftKey: e.shiftKey, altKey: e.altKey, repeat: e.repeat, bubbles: true, cancelable: true }),
        );
      };
      doc.addEventListener("keydown", forward);
      doc.addEventListener("keyup", forward);
      // where the pointer is over this page, in the board's screen px (for N)
      doc.addEventListener("pointermove", (e) => {
        const r = frame.getBoundingClientRect();
        const z = ed.getZoomLevel();
        pointerAt.current = { x: r.left + e.clientX * z, y: r.top + e.clientY * z };
      });

      // A drawing on top of the page is the board's to select and move (see drawnOver), and so is the
      // bar of a card or note on top of it (shapeOver), but the frame gets the pointer first: while the
      // pointer is over one, the frame lets it through
      // (.cv-pass), and the board gives it back once the pointer leaves the drawing (see below).
      doc.addEventListener("pointermove", (e) => {
        if (e.buttons) return; // mid-highlight: the page keeps the pointer
        const r = frame.getBoundingClientRect();
        const z = ed.getZoomLevel();
        const x = r.left + e.clientX * z;
        const y = r.top + e.clientY * z;
        if (drawnOver(ed, id, x, y) || shapeOver(ed, id, x, y)) frame.classList.add("cv-pass");
      });

      // the marks on what you explored, asked about or clipped (see refreshMarks)
      const st = doc.createElement("style");
      st.textContent = MARK_CSS;
      (doc.head ?? doc.documentElement).append(st);
      scheduleMarks.current();
      const fromRange = (r0: Range): Pick => {
        const range = wholeMath(r0);
        const rects = range.getClientRects();
        const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
        const node = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : (range.startContainer as Element);
        const block = node?.closest("p,li,figure,td,dd,h1,h2,h3,blockquote,div") as HTMLElement | null;
        const term = rangeText(range);
        const relY = last.top + last.height / 2;
        const page = pageNow();
        return {
          parent: null,
          page: page?.id ?? null,
          term,
          heading: headingAt(heads.current.get(key) ?? [], relY) || page?.props.title || "",
          context: (block ? elText(block) : term).slice(0, 1800),
          relX: last.right,
          relY,
          range,
        };
      };
      // A highlight offers Explore, Ask and Steer live; it never opens a card by itself.
      // Holding Alt while highlighting skips straight to a card.
      doc.addEventListener("mouseup", (e) => {
        const sel = win.getSelection();
        const p = sel && sel.rangeCount > 0 && !sel.isCollapsed ? fromRange(sel.getRangeAt(0)) : null;
        const ok = p && p.term.length >= 2 ? p : null;
        if (!e.altKey) setPick(ok);
        else if (ok) {
          altAt.current = Date.now();
          explore(ok);
        }
      });
      doc.addEventListener("mousedown", () => setPick(null));
      doc.addEventListener("click", (e) => {
        // Alt + click a word: open its card straight away.
        if (e.altKey) {
          if (Date.now() - altAt.current < 400) return;
          const range = wordRangeAt(doc, e.clientX, e.clientY);
          if (!range) return;
          e.preventDefault();
          win.getSelection()?.removeAllRanges();
          explore(fromRange(range));
          return;
        }
        // a click on a marked passage goes to its card (or tutor thread, or lab)
        const m = hitMark(win, e.clientX, e.clientY);
        if (m) {
          e.preventDefault();
          goToMark.current(m);
          return;
        }
        // through the ref, so a frame wired earlier still runs the current link rules
        followLink.current(e, doc, pageNow());
      });
    },
    [explore, quietly, courseSlug, lessonSlug, lessonTitle],
  );
  // A frame letting the pointer through to a drawing on top of it takes it back once the pointer
  // is off the drawing (the frame sees no moves meanwhile: the board does).
  useEffect(() => {
    if (!editor) return;
    const onMove = (e: PointerEvent) =>
      frames.current.forEach((f, key) => {
        const under = key ? sid(key) : LESSON_ID;
        if (f.classList.contains("cv-pass") && !drawnOver(editor, under, e.clientX, e.clientY) && !shapeOver(editor, under, e.clientX, e.clientY)) f.classList.remove("cv-pass");
      });
    window.addEventListener("pointermove", onMove, true);
    return () => window.removeEventListener("pointermove", onMove, true);
  }, [editor]);

  // Frames that finished loading before the editor (or before wireFrame changed) are wired now.
  useEffect(() => {
    if (!editor) return;
    frames.current.forEach((f, key) => f.contentDocument?.readyState === "complete" && wireFrame(f, key));
  }, [editor, wireFrame, loaded]);

  // ---- marks: what you explored, asked about or clipped stays highlighted, with a small tag ----
  // Each card (E), tutor question (A) and note clip (N) marks its passage in the lesson, a linked page
  // or a card, for as long as it exists. The passage is found again by its text (lib/anchor.ts),
  // nearest where it was highlighted; a tutor question, which keeps no position, by its paragraph.
  // A click on the passage or its tag goes to the card or note (or opens the thread). The live lab is
  // marked on the note it was launched from (S, NoteView), not on a passage.
  const threads = useTutor((t) => t.threads);
  const items = useMemo((): MarkItem[] => {
    const out: MarkItem[] = cards.map((c) => ({
      key: c.id, kind: "explore", term: c.props.term, context: c.props.context, target: c.id,
      src: c.props.parent ? sid(c.props.parent) : c.props.page ? sid(c.props.page) : LESSON_ID,
      rel: { x: c.props.relX, y: c.props.relY },
    }));
    for (const t of threads)
      if (t.course === courseSlug && t.lesson === lessonSlug)
        out.push({ key: t.id, kind: "ask", term: t.selection, context: t.context, target: t.id, src: null, rel: null });
    for (const n of notes)
      for (const c of docClips(n.props.doc))
        if (!c.thread) // a tutor answer's words aren't on the board
          out.push({ key: `${n.id}:${c.id}`, kind: "note", term: c.quote, context: c.around, target: n.id, src: clipSrc(c), rel: { x: c.relX, y: c.relY } });
    for (const v of videos)
      out.push({
        key: v.id, kind: "watch", term: v.props.term, context: v.props.context, target: v.id,
        src: v.props.parent ? sid(v.props.parent) : v.props.page ? sid(v.props.page) : LESSON_ID,
        rel: { x: v.props.relX, y: v.props.relY },
      });
    return out;
  }, [cards, threads, notes, videos, courseSlug, lessonSlug]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // What the marks depend on, so streaming text into a card doesn't re-find every mark each frame:
  // the passages, and the text of cards that have marks in them.
  const markSig = useMemo(() => {
    const srcCards = new Set(items.map((i) => i.src).filter((x) => x && cards.some((c) => c.id === x)));
    return [
      ...items.map((i) => `${i.key}|${i.term}|${i.src}|${i.rel?.x},${i.rel?.y}`),
      ...cards.filter((c) => srcCards.has(c.id)).map((c) => `${c.id}:${c.props.level}:${c.props.parts.map((t) => t.length).join(",")}:${c.props.w}`),
    ].join("\n");
  }, [items, cards]);

  const [tags, setTags] = useState<Tag[]>([]);
  const hits = useRef(new Map<Window, MarkHit[]>()); // per document: its marked ranges, for clicks

  /** The text a mark may be in: a page's document, or a card's text. */
  const markRoot = (src: TLShapeId): { win: Window; root: Element } | null => {
    const ed = editorRef.current;
    const s = ed?.getShape(src);
    if (isDoc(s)) {
      const f = frames.current.get(s.props.role === "lesson" ? "" : bareId(s.id));
      const doc = f?.contentDocument;
      return f?.contentWindow && doc?.body && doc.readyState !== "loading" ? { win: f.contentWindow, root: doc.body } : null;
    }
    if (isCard(s)) {
      const el = document.querySelector(`.tl-shape[data-shape-id="${s.id}"] .cv-body`);
      return el ? { win: window, root: el } : null;
    }
    return null;
  };

  const refreshMarks = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const shapes = ed.getCurrentPageShapes();
    const everywhere = [LESSON_ID, ...shapes.filter((x) => isDoc(x) && x.props.role === "page").map((x) => x.id), ...shapes.filter(isCard).map((c) => c.id)];
    const ranges = new Map<Window, Record<MarkKind, Range[]>>();
    const nextHits = new Map<Window, MarkHit[]>();
    const nextTags: Tag[] = [];
    const found = new Map<string, Range[]>(); // root + term -> its places, once per refresh
    for (const it of itemsRef.current) {
      let best: { range: Range; win: Window; src: TLShapeId; score: number } | null = null;
      for (const src of it.src ? [it.src] : everywhere) {
        const at = markRoot(src);
        if (!at) continue;
        const k = `${src}\u0000${it.term}`;
        if (!found.has(k)) found.set(k, locate(at.root, it.term));
        for (const range of found.get(k)!) {
          const end = rangeEnd(ed, range, src);
          if (!end) continue;
          // nearest where it was highlighted; a question by the paragraph it was asked about
          const score = it.rel
            ? Math.abs(end.y - it.rel.y) + 0.25 * Math.abs(end.x - it.rel.x)
            : inParagraph(range, it.context) ? 0 : 1e6 + everywhere.indexOf(src);
          if (!best || score < best.score) best = { range, win: at.win, src, score };
        }
        if (best && (it.src || best.score === 0)) break;
      }
      if (!best) continue;
      const r = ranges.get(best.win) ?? { explore: [], ask: [], note: [], watch: [] };
      r[it.kind].push(best.range);
      ranges.set(best.win, r);
      nextHits.set(best.win, [...(nextHits.get(best.win) ?? []), { range: best.range, item: it }]);
      const end = rangeEnd(ed, best.range, best.src)!;
      nextTags.push({ key: it.key, kind: it.kind, target: it.target, src: best.src, x: end.x, y: end.top });
    }
    const wins = new Set<Window>([window, ...[...frames.current.values()].map((f) => f.contentWindow).filter((w): w is Window & typeof globalThis => !!w)]);
    for (const w of wins) {
      const win = w as Window & typeof globalThis;
      if (!win.CSS?.highlights || !win.Highlight) continue;
      const r = ranges.get(w);
      for (const kind of MARK_KINDS) win.CSS.highlights.set(`cv-${kind}`, new win.Highlight(...(r?.[kind] ?? [])));
    }
    hits.current = nextHits;
    setTags((old) => (JSON.stringify(old) === JSON.stringify(nextTags) ? old : nextTags));
  };
  // Marks are found again a frame after whatever moved them (cards rendered, a page laid out).
  const scheduleMarks = useRef(() => {});
  const refreshRef = useRef(refreshMarks);
  refreshRef.current = refreshMarks;
  useEffect(() => {
    let raf = 0;
    scheduleMarks.current = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => requestAnimationFrame(() => refreshRef.current()));
    };
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (loaded) scheduleMarks.current();
  }, [markSig, loaded]);

  /** The marked passage under a point in a document, unless text is being selected there. */
  const hitMark = (win: Window, x: number, y: number): MarkItem | null => {
    const sel = win.getSelection();
    if (sel && !sel.isCollapsed) return null;
    for (const h of hits.current.get(win) ?? [])
      for (const r of Array.from(h.range.getClientRects())) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return h.item;
    return null;
  };

  /** Go to what a mark stands for: zoom onto its card or note, or open its tutor thread. */
  const goToMark = useRef<(m: { kind: MarkKind; target: string }) => void>(() => {});
  goToMark.current = (m) => {
    const ed = editorRef.current;
    if (!ed) return;
    if (m.kind === "ask") {
      setTutorOpen(true);
      tutor.current?.open(m.target);
      return;
    }
    const s = ed.getShape(m.target as TLShapeId);
    const lab = isNote(s) ? labOf(ed, s.id) : undefined;
    if (lab) return showLab(lab); // the note is a lab just now
    if (!isCard(s) && !isNote(s) && !isVideo(s)) return;
    rememberHome();
    glide(onCard(s, Math.max(1, ed.getZoomLevel())));
    flash(s.id);
  };

  // ---- highlights inside cards ----
  function pickInCard(id: TLShapeId, r0: Range): Pick | null {
    const ed = editorRef.current!;
    const c = ed.getShape(id);
    if (!isCard(c)) return null;
    const range = wholeMath(r0);
    const rects = range.getClientRects();
    const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
    const at = ed.screenToPage({ x: last.right, y: last.top + last.height / 2 });
    return {
      parent: id,
      page: null,
      term: rangeText(range),
      heading: c.props.term,
      context: c.props.parts.slice(0, 3).join("\n\n").slice(0, 1800),
      relX: at.x - c.x,
      relY: at.y - c.y,
      range,
    };
  }
  function cardMouseUp(id: TLShapeId, e: React.MouseEvent) {
    const sel = window.getSelection();
    const body = e.currentTarget as HTMLElement;
    const p = sel && sel.rangeCount > 0 && !sel.isCollapsed && body.contains(sel.anchorNode) ? pickInCard(id, sel.getRangeAt(0)) : null;
    const ok = p && p.term.length >= 2 ? p : null;
    if (!e.altKey) setPick(ok);
    else if (ok) {
      altAt.current = Date.now();
      explore(ok);
    }
  }
  function cardClick(id: TLShapeId, e: React.MouseEvent) {
    if (!e.altKey) {
      const m = hitMark(window, e.clientX, e.clientY);
      if (m) goToMark.current(m);
      return;
    }
    if (Date.now() - altAt.current < 400) return;
    const range = wordRangeAt(document, e.clientX, e.clientY);
    if (!range || !(e.currentTarget as HTMLElement).contains(range.startContainer)) return;
    e.preventDefault();
    const p = pickInCard(id, range);
    if (p) explore(p);
  }

  /** A double-click in a card's text that didn't become a drag: select that word and offer it. */
  function cardWord(id: TLShapeId, x: number, y: number) {
    const range = wordRangeAt(document, x, y);
    const body = range && (range.startContainer.parentElement?.closest(".cv-body") as HTMLElement | null);
    if (!range || !body) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const p = pickInCard(id, range);
    if (p && p.term.length >= 2) setPick(p);
  }

  function removeCard(id: TLShapeId) {
    const ed = editorRef.current!;
    ed.deleteShapes([id, ...followers(ed, id).map((c) => c.id)]);
  }
  function retry(id: TLShapeId, lv: number) {
    aborts.current.get(`${bareId(id)}:${lv}`)?.abort();
    patch(id, lv, "", "idle");
  }
  function showOld(id: TLShapeId) {
    setRecall(id, (r) => ({ ...r, step: "had" }));
  }
  /** Close the ask: had = the learner's yes / no after seeing the old text, null = skipped. */
  function answerRecall(id: TLShapeId, had: boolean | null) {
    const c = editorRef.current?.getShape(id);
    if (isCard(c) && c.props.from)
      logEvent(courseSlug, { kind: "recall", lesson: lessonSlug, view: "canvas", term: c.props.term, card: c.props.from.card, had });
    setRecall(id, (r) => ({ ...r, step: "done", ...(had === null ? {} : { had }) }));
  }
  function clearAll() {
    const ed = editorRef.current!;
    ed.deleteShapes(ed.getCurrentPageShapes().filter(isCard).map((c) => c.id));
  }

  // What the shapes call. The object handed to them never changes; each call reaches this render's code.
  const impl = useRef<CanvasHost>(null!);
  impl.current = {
    wireFrame,
    setFrame: (key, el) => {
      if (el) frames.current.set(key, el);
      if (key === "") lessonFrame.current = el;
    },
    retry,
    removeCard,
    showOld,
    answerRecall,
    cardMouseUp,
    cardClick,
    cardWord,
    togglePage,
    refreshPage,
    closePage,
    closeLab,
    labText,
    labResume: labResumeOf,
    labState,
    goBack,
    // The lab in a note writes with the model picked in the Models tab, so its events are stamped with that model.
    labRoute: () => `${LAB_ROUTE}?course=${encodeURIComponent(courseSlug)}`,
    logSteer: (section, event, envelope) => logSteer(courseSlug, lessonSlug, "canvas", section, event, envelope, labModelStamp(labModel.current)),
    newNote,
    pinNote,
    // a press anywhere in a note (its bar, its text, a button) makes it the note → Note sends to, and
    // brings it over whatever it overlaps: the note in use is the one on top (outside undo)
    touchNote: (id) => {
      lastNote.current = id;
      const ed = editorRef.current;
      if (ed && ed.getCurrentPageShapesSorted().at(-1)?.id !== id) quietly(() => ed.bringToFront([id]));
    },
    goToClip,
    steerClip,
    frameAct,
    touch: (id) => tidy.current.touch(id),
    setLevel,
    makeStart,
    canSteer: () => can.steer,
    launchNote: (id) => {
      const n = editorRef.current?.getShape(id);
      if (isNote(n)) launchNote(n);
    },
  };
  const host = useMemo(
    () => Object.fromEntries(Object.keys(impl.current).map((k) => [k, (...a: unknown[]) => (impl.current[k as keyof CanvasHost] as (...a: unknown[]) => void)(...a)])) as CanvasHost,
    [],
  );

  return (
    <div className="rd" ref={root} data-vibe={vibe === "sage" ? undefined : vibe}>
      <header className="rd-bar">
        <Link href={`/learn/${courseSlug}`} className="rd-bar-course">
          ← {courseTitle}
        </Link>
        <span className="rd-bar-title">{lessonTitle}</span>
        <div className="rd-bar-nav">
          {prev && <Link href={`/learn/${courseSlug}/${prev.slug}`}>Previous</Link>}
          {next && <Link href={`/learn/${courseSlug}/${next.slug}`}>Next</Link>}
          <Link href={`/learn/${courseSlug}/${lessonSlug}/reader`}>Reader</Link>
          <SessionEnd courseSlug={courseSlug} courseTitle={courseTitle} lessonSlug={lessonSlug} lessonTitle={lessonTitle} view="canvas" />
          {cards.length > 0 && (
            <button className="cv-clear" onClick={clearAll}>
              Clear {cards.length} {cards.length === 1 ? "card" : "cards"}
            </button>
          )}
          <button className="cv-clear" onClick={() => setLinkBar(true)} title="Open a web page on the board (U, or paste a link onto the board)">
            Open a link
          </button>
          <div className="cv-vibes" role="radiogroup" aria-label="Board look">
            {VIBES.map((v) => (
              <button
                key={v.id}
                role="radio"
                aria-checked={vibe === v.id}
                aria-label={v.name}
                title={v.name}
                style={{ "--base": v.base, "--pop": v.pop } as React.CSSProperties}
                onClick={() => saveVibe(v.id)}
              />
            ))}
          </div>
          <button className="rd-toggle" aria-pressed={tutorOpen} onClick={() => setTutorOpen(!tutorOpen)}>
            Tutor
          </button>
        </div>
      </header>

      <div className="rd-body">
        <div className="cv-board">
          <Board host={host} onMount={onMount} />
          {editor && (
            <LessonHud
              editor={editor}
              onGo={focusFrame}
              notes={notes}
              pick={
                notePick
                  ? { term: notePick.term, explore: () => explore(notePick), ask: (level) => askTutor(notePick, level) }
                  : pick && hudTakesPick
                  ? {
                      term: pick.term,
                      explore: () => explore(pick),
                      ask: (level) => askTutor(pick, level),
                      watch: can.watch ? () => void watch(pick) : undefined,
                      steer: can.steer ? () => steerLive(pick) : undefined,
                      toNote: (into) => toNote(pick, into),
                      newNote: () => {
                        noteBeside(pick, { doc: startDoc("", [clipOf(pick)]) });
                        clearPick(pick);
                      },
                    }
                  : null
              }
            />
          )}
          {editor && pick && !hudTakesPick && <PickPop editor={editor} pick={pick} explore={explore} askTutor={askTutor} watch={can.watch ? watch : undefined} steerLive={can.steer ? steerLive : undefined} toNote={toNote} />}
          {carry && (
            // placed here as the drag starts; carryPick moves it from then on
            <div ref={carryChip} className="cv-carry" style={{ left: carry.x, top: carry.y }} aria-hidden="true">
              {carry.quote}
            </div>
          )}
          {carry && <div ref={carryCaret} className="cv-drop-caret" hidden aria-hidden="true" />}
          {linkBar && <LinkBar open={openLink} close={() => setLinkBar(false)} />}
          {editor && tags.length > 0 && <MarkTags editor={editor} tags={tags} go={(t) => goToMark.current(t)} />}
          <ReturnPanel courseSlug={courseSlug} courseTitle={courseTitle} lessonSlug={lessonSlug} lessonTitle={lessonTitle} view="canvas" />
          {backs > 0 && (
            <div className="cv-hud">
              <button onClick={goBack} className="cv-back" title="Back to where you were before the last jump, zoom included">
                ← Back{backs > 1 ? ` (${backs})` : " to where I was"} <kbd>Esc</kbd>
              </button>
            </div>
          )}
          {editor && (
            <BoardChat
              open={chatOpen}
              setOpen={setChatOpen}
              courseSlug={courseSlug}
              courseTitle={courseTitle}
              lessonSlug={lessonSlug}
              lessonTitle={lessonTitle}
              board={boardContext}
              toNote={chatToNote}
              carry={(b, down) =>
                carryPassage(b.quote, window, down, (n, at) => {
                  chatToNote(b, n, at);
                  window.getSelection()?.removeAllRanges();
                }, () => window.getSelection()?.removeAllRanges())
              }
            />
          )}
          {loaded && cards.length === 0 && !hintGone && (
            <p className="cv-hint">
              <button className="cv-x" onClick={hideHint} aria-label="Hide these tips">
                ✕
              </button>
              Highlight a word or phrase in the lesson and its definition shows beside it at once; pull the knob at its end (or click it) to Explore it in a card, Ask the tutor (pull further for Simple, Mid, Deep), clip it to a Note or Steer live.
              Alt while you highlight (or Alt + click one word) opens a card at once. Zoom in over a card to deepen it; double-click and drag anywhere on it to move it, and pull its right edge, bottom edge or corner to resize it. Draw on anything with the
              toolbar: <kbd>D</kbd> pen, <kbd>R</kbd> box, <kbd>O</kbd> ellipse, <kbd>A</kbd> arrow, <kbd>T</kbd> text, <kbd>E</kbd> eraser,{" "}
              <kbd>V</kbd> back to select. <kbd>N</kbd> makes a note docked at the screen&rsquo;s right edge, where → Note clips go (a double-click on an empty spot makes one there instead), and
              Steer from this on a note opens the live lab from it. Every card, note and page has the same bar: Pin keeps it on screen, – folds it to a chip, ✕ closes it; double-click
              the bar to bring it into view (<kbd>Esc</kbd> goes back), and <kbd>J</kbd> / <kbd>Shift</kbd>+<kbd>J</kbd> step through everything on the board. Hold <kbd>Space</kbd> and drag to pan; scroll moves, Ctrl + scroll zooms. Press <kbd>U</kbd> (or paste a link onto the board) to open any web page here. What you explored, asked about or clipped stays
              highlighted with a small tag (E, A, N); click it to go to its card, answer or note. The dots in the top bar change the look.
            </p>
          )}
        </div>
        <TutorPanel
          ref={tutor}
          courseSlug={courseSlug}
          courseTitle={courseTitle}
          lessonSlug={lessonSlug}
          lessonTitle={lessonTitle}
          view="canvas"
          open={tutorOpen}
          setOpen={setTutorOpen}
          hud={TUTOR_HUD}
          toNote={(b) => tutorToNote(b)}
          carry={(b, down) =>
            carryPassage(b.quote, window, down, (n, at) => {
              tutorToNote(b, n, at);
              window.getSelection()?.removeAllRanges();
            }, () => window.getSelection()?.removeAllRanges())
          }
        />
      </div>
    </div>
  );
}

/** The Explore / Ask / ▶ Watch / Steer live / → Note bar under a highlight; it follows the board as it moves. */
function PickPop({
  editor,
  pick,
  explore,
  askTutor,
  watch,
  steerLive,
  toNote,
}: {
  editor: Editor;
  pick: Pick;
  explore: (p: Pick) => void;
  askTutor: (p: Pick, level: TutorLevel) => void;
  watch?: (p: Pick) => void;
  steerLive?: (p: Pick) => void;
  toNote: (p: Pick) => void;
}) {
  const at = useValue(
    "pick at",
    () => {
      const base = editor.getShape(pick.parent ?? pick.page ?? LESSON_ID);
      if (!base) return null;
      const top = isDoc(base) ? contentTop(base) : base.y;
      const p = editor.pageToViewport({ x: base.x + pick.relX + 4, y: top + pick.relY + 12 });
      return { ...p, room: editor.getViewportScreenBounds().w - p.x - 8 };
    },
    [editor, pick],
  );
  if (!at) return null;
  return (
    // slid left as far as it must to stay on the board (a highlight near its right edge, in a card)
    <div className="cv-pick" style={{ left: at.x, top: at.y, translate: `min(0px, calc(${at.room}px - 100%)) 0` }} onMouseDown={(e) => e.preventDefault()}>
      <button onClick={() => explore(pick)}>Explore</button>
      <span>Ask</span>
      {(Object.keys(LEVEL_LABEL) as TutorLevel[]).map((lv) => (
        <button key={lv} onClick={() => askTutor(pick, lv)}>
          {LEVEL_LABEL[lv]}
        </button>
      ))}
      {watch && (
        <button className="cv-watch" onClick={() => watch(pick)} title="A short narrated video about this, beside it">
          ▶ Watch
        </button>
      )}
      {steerLive && (
        <button className="cv-steer" onClick={() => steerLive(pick)}>
          Steer live
        </button>
      )}
      <button className="cv-to-note" onClick={() => toNote(pick)} title="Add this passage to the note you last used (or a new note beside it)">
        → Note
      </button>
    </div>
  );
}

/** The box for opening a web page on the board: paste an address, Enter opens it where you are. */
function LinkBar({ open, close }: { open: (url: string) => boolean; close: () => void }) {
  const [url, setUrl] = useState("");
  const [bad, setBad] = useState(false);
  return (
    <form
      className="cv-linkbar"
      onSubmit={(e) => {
        e.preventDefault();
        if (open(url)) close();
        else setBad(true);
      }}
    >
      <input
        autoFocus
        type="text"
        inputMode="url"
        spellCheck={false}
        placeholder="Paste a link, like code.chuanqisun.com/master-thesis"
        aria-label="Web address to open on the board"
        aria-invalid={bad || undefined}
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), close())}
        onBlur={() => !url && close()}
      />
      <button type="submit" disabled={!url.trim()}>
        Open
      </button>
      {bad && <p role="alert">That isn’t a web address. Try one that starts with https://</p>}
    </form>
  );
}

/** The small tags at the end of marked passages; they follow the board as it moves. */
function MarkTags({ editor, tags, go }: { editor: Editor; tags: Tag[]; go: (t: Tag) => void }) {
  const placed = useValue(
    "mark tags",
    () => {
      if (editor.getZoomLevel() < 0.3) return [];
      return tags.flatMap((t) => {
        const s = editor.getShape(t.src);
        if (!s || (isDoc(s) && s.props.collapsed)) return [];
        const top = isDoc(s) ? contentTop(s) : s.y;
        const p = editor.pageToViewport({ x: s.x + t.x, y: top + t.y });
        return [{ t, x: p.x, y: p.y }];
      });
    },
    [editor, tags],
  );
  return (
    <>
      {placed.map(({ t, x, y }) => (
        <button
          key={t.key}
          className={`cv-tag cv-tag-${t.kind}`}
          style={{ left: x + 2, top: y - 9 }}
          onClick={() => go(t)}
          title={TAG_TITLE[t.kind]}
          aria-label={TAG_TITLE[t.kind]}
        >
          {TAG_TEXT[t.kind]}
        </button>
      ))}
    </>
  );
}
