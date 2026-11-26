"use client";

// The lesson canvas's own shapes on the tldraw board: the lesson and the pages opened from its
// links ("lesson-doc"), the Explore cards ("lesson-card"), the notes ("lesson-note"), the Steer
// live lab ("lesson-lab") and the narrated videos ("lesson-video").
// They are ordinary tldraw shapes, so they can be selected, moved, connected with arrows and drawn
// over. What they do (stream a level, open a highlight, close a page) lives in LessonCanvas and
// reaches them through CanvasHost.
//
// Pointer events: everything inside a shape is inert by default, so tldraw gets the pointer and a
// title bar drags its shape. The parts you use (a page's text, a card's text and buttons, a note's
// fields, the lab) take the pointer only while the select tool is idle; with the pen, a shape tool
// or the hand (Space) they go inert again, so you can draw over the lesson or pan across it. A
// drawing on top of them still takes a press on it, to be selected and moved (drawnOver).

import { createContext, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Editor as TipTap } from "@tiptap/core";
import {
  ArrowShapeUtil,
  HTMLContainer,
  atom,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  getArrowInfo,
  Rectangle2d,
  ShapeUtil,
  T,
  useEditor,
  useValue,
  type Atom,
  type Editor,
  type TLArrowShape,
  type TLResizeInfo,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import { markdownWithMath } from "@/lib/mathMarkdown";
import { Lab } from "@/components/Lab";
import { headingOf } from "@/lib/lab/story/prompt";
import type { LabState } from "@/lib/lab/lab";
import type { SteerEnvelope, SteerEvent } from "@/lib/spaceship";
import { BAR_H, bareId, cardW, shapeId, type CardProps, type Status } from "@/lib/board";
import { useTutor } from "@/lib/tutor";
import { NOTE_H, NOTE_W, clipWeightOf, docClips, docPlain, docTopic, emptyDoc, hasAuthored, noteFromOld, removeClip, type Clip, type ClipSteer, type DocNode, type NoteProps, type OldNoteProps, type Source } from "@/lib/note";
import { NoteDoc } from "@/components/canvas/NoteDoc";
import { FrameBar, FrameChip, frameHooks } from "@/components/canvas/Frame"; // one frame for everything on the board
import { StopRail } from "@/components/DepthRail";
import { dropAuthored } from "@/lib/note";
import type { Scene, WatchJob } from "@/lib/watch";
import { stage } from "@/lib/motion";
type Pt = { x: number; y: number };

export const CARD = "lesson-card";
export const DOC = "lesson-doc";
export const LAB = "lesson-lab";
export const NOTE = "lesson-note";
export const LEADER = "lesson-leader";
export const VIDEO = "lesson-video";
export const LESSON_ID = "shape:lesson" as TLShapeId;

/** The lesson ("lesson" role, at the back, locked) or a page opened from a link. h: its content's
    height (a page's bar sits above that, inside the shape). from/relX/relY: the link it came from
    (from: the source page's bare id, "" = the lesson), kept for the saved file. */
export type DocProps = {
  w: number; h: number; role: "lesson" | "page"; src: string; title: string; href: string; jump: string;
  collapsed: boolean; from: string; relX: number; relY: number;
};
/** The live lab: a note's other face, opened in its place (its note: meta.note; which of the note's lab
    text is its: meta.run). start: what it carries on from; prefix: the same, what it writes past that
    goes back into the note; sources: the note's clips. Never saved itself: closing it, or leaving the
    page, stops its sound and model calls, and the note shows again, keeping what the lab showed
    (meta.lab) so it opens again where it stopped. */
export type LabProps = {
  w: number; h: number; topic: string; section: string; from: string; relX: number; relY: number;
  start: string; prefix: string; sources: Source[];
};
/** A narrated video about a highlight ("Watch"). The board keeps only which video it is (video: its id
    under the course's app-data/videos) and the passage it is about, as a card does; the scenes, voices
    and video.mp4 stay on disk and come through /api/watch, so the saved board never carries media. */
export type VideoProps = {
  w: number; h: number; term: string; context: string; parent: string; page: string; relX: number; relY: number;
  course: string; video: string; createdAt: number;
};
export const VIDEO_W = 520;
const VIDEO_FRAME_H = 325; // the picture: 640 x 400 at the card's width
export const VIDEO_H = BAR_H + VIDEO_FRAME_H + 176; // bar, picture, then the status line and the narration
const VIDEO_RATIO = VIDEO_FRAME_H / VIDEO_W; // the picture's height per unit of width: the frame keeps its 640×400 aspect as it resizes
const VIDEO_MIN_W = 360; // below this the picture and its captions stop being legible
const VIDEO_LINES_MIN = 96; // the narration list always keeps at least this much room under the picture
/** A line from a highlight to its card, as earlier versions saved it (see LeaderShapeUtil). */
export type LeaderProps = {
  from: string; to: string; ax: number; ay: number; ey: number; dx: number; dy: number; bends: { t: number; n: number }[]; lab: boolean;
  shaped?: boolean; axL?: number; side?: number;
};

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [CARD]: CardProps;
    [DOC]: DocProps;
    [LAB]: LabProps;
    [NOTE]: NoteProps;
    [LEADER]: LeaderProps;
    [VIDEO]: VideoProps;
  }
}
export type CardShape = TLShape<typeof CARD>;
export type DocShape = TLShape<typeof DOC>;
export type LabShape = TLShape<typeof LAB>;
export type NoteShape = TLShape<typeof NOTE>;
export type LeaderShape = TLShape<typeof LEADER>;
export type VideoShape = TLShape<typeof VIDEO>;

export const LEVEL_NAME = ["", "Definition", "In plain words", "How it works", "Picture"];
export const CHIP_W = 340; // a minimized page

/** What the shapes ask of the canvas around them. */
export type CanvasHost = {
  wireFrame: (frame: HTMLIFrameElement, key: string) => void; // key: "" = the lesson, else the page's bare id
  setFrame: (key: string, frame: HTMLIFrameElement | null) => void;
  retry: (id: TLShapeId, level: number) => void;
  removeCard: (id: TLShapeId) => void;
  showOld: (id: TLShapeId) => void;
  answerRecall: (id: TLShapeId, had: boolean | null) => void;
  cardMouseUp: (id: TLShapeId, e: React.MouseEvent) => void;
  cardClick: (id: TLShapeId, e: React.MouseEvent) => void;
  cardWord: (id: TLShapeId, x: number, y: number) => void; // select the word at a screen point, as a highlight
  togglePage: (id: TLShapeId) => void;
  refreshPage: (id: TLShapeId) => Promise<void>; // fetch a web page from its site again and reload it
  closePage: (id: TLShapeId) => void;
  closeLab: (id: TLShapeId) => void; // the lab goes and its note shows again, where the lab was
  labText: (id: TLShapeId, text: string) => void; // a lab's text up to its knob, as it changes: into its note
  labResume: (id: TLShapeId) => Partial<LabState> | undefined; // what a lab opening now picks up from (its note keeps it)
  labState: (note: string, run: string, start: string, state: LabState) => void; // a lab's state as it settles, pauses or goes: onto its note
  goBack: () => void;
  labRoute: () => string; // where a lab's text calls go, with the course for calls.jsonl
  logSteer: (section: string, event: SteerEvent, envelope: SteerEnvelope) => void; // a lab's event, for the study log
  newNote: (atPointer: boolean) => void; // N (at the pointer), or the toolbar's note (in the middle of the view)
  touchNote: (id: TLShapeId) => void; // the note last touched takes the next "→ Note"
  pinNote: (id: TLShapeId) => void; // pin a note to its spot on the screen as the board scrolls, or unpin it
  goToClip: (id: TLShapeId, clip: string) => void; // glide to where a note's clip came from
  steerClip: (note: TLShapeId, clip: string, steer: ClipSteer) => void; // set a clip's steer (a weight, or a picked use) from inside the lab
  makeStart: (id: TLShapeId) => Promise<void>; // "Steer from this": a starting point from the clips and the draft
  launchNote: (id: TLShapeId) => void; // the note turns into the lab, from its starting point
  canSteer: () => boolean; // the lab can run here (an OpenRouter key is set: lib/features.ts)
  // one frame for everything on the board (components/canvas/Frame.tsx)
  frameAct: (id: TLShapeId, act: "pin" | "fold" | "close") => void; // the frame's own controls (Pin or Dock, –, ✕)
  touch: (id: TLShapeId) => void; // a press on it: it comes to the front
  setLevel: (id: TLShapeId, level: number) => void; // a card's depth handle: show the card to this depth (back too)
};
export const HostCtx = createContext<CanvasHost | null>(null);
const useHost = () => useContext(HostCtx)!;

/** True while the parts of shapes you use should take the pointer (see the note at the top). */
export function useLive(): boolean {
  const editor = useEditor();
  return useValue("canvas live", () => editor.isIn("select.idle") && !editor.inputs.getIsPanning(), [editor]);
}
/** Follow a pointer from its press until release, in board units (dx, dy from the press). Pointer
    capture keeps it coming over the pages' frames, which also go inert meanwhile (.cv-dragging).
    Small jitter under 3 screen px doesn't count as a move; onEnd says whether it moved. */
function follow(editor: Editor, e: ReactPointerEvent, onMove: (dx: number, dy: number) => void, onEnd?: (moved: boolean) => void) {
  const el = e.currentTarget as HTMLElement;
  const z = editor.getZoomLevel();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let moved = false;
  el.setPointerCapture(e.pointerId);
  document.documentElement.classList.add("cv-dragging");
  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
    moved = true;
    onMove((ev.clientX - x0) / z, (ev.clientY - y0) / z);
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    document.documentElement.classList.remove("cv-dragging");
    onEnd?.(moved);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

/** For the parts that take the pointer: tldraw leaves the event to them. */
function useMine() {
  const editor = useEditor();
  return (e: ReactPointerEvent) => editor.markEventAsHandled(e);
}

const APP_SHAPES = new Set<string>([CARD, DOC, LAB, LEADER, NOTE, VIDEO]);

/** Whether one of the reader's own drawings (a pen line, a box, an arrow, text…) is on top of
    `under` at this screen point, so a press there is the board's: to select and move the drawing.
    A card's text or a page takes the pointer before the board sees it, so they ask this first.
    Hit as the board hits on a press (a line or an outline near it, a filled shape anywhere in it),
    plus anywhere inside a drawing that is already selected; not inside an empty outline, so a box
    drawn round a passage still lets you highlight the passage. */
export function drawnOver(editor: Editor, under: TLShapeId, x: number, y: number): boolean {
  const point = editor.screenToPage({ x, y });
  const margin = editor.getHitTestMargin();
  const drawn = (s: TLShape) => !APP_SHAPES.has(s.type);
  const top = editor.getShapeAtPoint(point, { margin, renderingOnly: true, filter: drawn });
  const onIt = top && editor.isPointInShape(top, point, { margin }) ? top : undefined;
  const sel = editor.getSelectedShapeAtPoint(point);
  const hit = onIt ?? (sel && drawn(sel) ? sel : undefined);
  if (!hit) return false;
  const order = editor.getCurrentPageShapesSorted();
  return order.indexOf(hit) > order.findIndex((s) => s.id === under);
}

/** Whether one of the app's own shapes (a card, a note, a page, a lab) is on top of `under` at this
    screen point. Their bars take no pointer of their own (the board drags them by it), so a page under
    one lets the pointer through there, as it does under a drawing (LessonCanvas wireFrame). */
export function shapeOver(editor: Editor, under: TLShapeId, x: number, y: number): boolean {
  const point = editor.screenToPage({ x, y });
  const top = editor.getShapeAtPoint(point, { hitInside: true, renderingOnly: true, filter: (s) => APP_SHAPES.has(s.type) && s.type !== LEADER && s.id !== under });
  if (!top) return false;
  const order = editor.getCurrentPageShapesSorted();
  return order.indexOf(top) > order.findIndex((s) => s.id === under);
}

// ---- which shapes travel together ----

/** The cards opened from a card or from a linked page, however deep (not the shape itself). */
export function followers(editor: Editor, id: TLShapeId): CardShape[] {
  const cards = editor.getCurrentPageShapes().filter((s): s is CardShape => s.type === CARD);
  const root = editor.getShape(id);
  const ids = new Set<string>();
  if (root?.type === CARD) ids.add(bareId(id));
  else if (root?.type === DOC) for (const c of cards) if (!c.props.parent && c.props.page === bareId(id)) ids.add(bareId(c.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of cards)
      if (c.props.parent && ids.has(c.props.parent) && !ids.has(bareId(c.id))) {
        ids.add(bareId(c.id));
        grew = true;
      }
  }
  ids.delete(bareId(id));
  return cards.filter((c) => ids.has(bareId(c.id)));
}

/** Dragging a page or a card brings the cards opened from it along (unless they are being dragged too). */
class Carry {
  private from: { id: TLShapeId; x: number; y: number }[] = [];
  start(editor: Editor, id: TLShapeId) {
    const moving = new Set(editor.getSelectedShapeIds());
    this.from = followers(editor, id)
      .filter((c) => !moving.has(c.id))
      .map((c) => ({ id: c.id, x: c.x, y: c.y }));
  }
  move(editor: Editor, initial: TLShape, current: TLShape) {
    if (!this.from.length) return;
    const dx = current.x - initial.x;
    const dy = current.y - initial.y;
    editor.updateShapes(this.from.map((f) => ({ id: f.id, type: CARD, x: f.x + dx, y: f.y + dy })));
  }
}

// ---- the lesson and linked pages ----

export class DocShapeUtil extends ShapeUtil<DocShape> {
  static override type = DOC;
  static override props = {
    w: T.number, h: T.number, role: T.literalEnum("lesson", "page"), src: T.string, title: T.string, href: T.string,
    jump: T.string, collapsed: T.boolean, from: T.string, relX: T.number, relY: T.number,
  };
  private carry = new Carry();
  getDefaultProps(): DocProps {
    return { w: 880, h: 1000, role: "page", src: "", title: "", href: "", jump: "", collapsed: false, from: "", relX: 0, relY: 0 };
  }
  /** Top of the content: a page's bar is above it. */
  static top(s: DocShape) {
    return s.props.role === "page" ? BAR_H : 0;
  }
  getGeometry(s: DocShape) {
    if (s.props.collapsed) return new Rectangle2d({ width: CHIP_W, height: BAR_H, isFilled: true });
    return new Rectangle2d({ width: s.props.w, height: DocShapeUtil.top(s) + s.props.h, isFilled: true });
  }
  override canResize() {
    return false;
  }
  override hideRotateHandle() {
    return true;
  }
  override canCull() {
    return false; // a culled frame is hidden, and a hidden page lays itself out again at zero width
  }
  override getText(s: DocShape) {
    return s.props.title;
  }
  /** Double-click a page's bar: bring it into view, fitted to the screen. */
  override onDoubleClick(s: DocShape) {
    if (s.props.role === "page") frameHooks.focus?.(s.id);
  }
  override onTranslateStart(s: DocShape) {
    this.carry.start(this.editor, s.id);
  }
  override onTranslate(initial: DocShape, current: DocShape) {
    this.carry.move(this.editor, initial, current);
  }
  component(s: DocShape) {
    return <DocView shape={s} />;
  }
  getIndicatorPath(s: DocShape) {
    const b = this.getGeometry(s).bounds;
    const p = new Path2D();
    p.rect(0, 0, b.w, b.h);
    return p;
  }
}

function DocView({ shape: s }: { shape: DocShape }) {
  const host = useHost();
  const live = useLive();
  const mine = useMine();
  const key = s.props.role === "lesson" ? "" : bareId(s.id);
  const [reloading, setReloading] = useState(false);
  const host0 = s.props.href ? safeHost(s.props.href) : "";
  return (
    <HTMLContainer className={`cv-doc cv-doc-${s.props.role}${s.props.collapsed ? " cv-doc-collapsed" : ""}`}>
      {s.props.role === "page" && !s.props.collapsed && (
        <FrameBar
          kind="page"
          // a page opened from a pasted link hangs from nothing: "Web", not "Linked"
          label={!s.props.from && !s.props.relX && !s.props.relY ? "Web" : "Linked"}
          title={s.props.title}
          mine={mine}
          live={live}
          extra={
            <>
              {s.props.href && (
                <a className="fr-link" href={s.props.href} target="_blank" rel="noopener noreferrer" onPointerDown={mine} title="Open the original in a new browser tab">
                  {host0} ↗
                </a>
              )}
              {s.props.href && (
                <button
                  className="fr-btn"
                  onPointerDown={mine}
                  disabled={reloading}
                  aria-busy={reloading || undefined}
                  onClick={() => {
                    setReloading(true);
                    host.refreshPage(s.id).finally(() => setReloading(false));
                  }}
                  aria-label={`Reload ${s.props.title} from the site`}
                  title="Reload from the site"
                >
                  ↻
                </button>
              )}
            </>
          }
          pinned={!!s.meta.pin}
          onPin={() => host.frameAct(s.id, "pin")}
          onFold={() => host.frameAct(s.id, "fold")}
          onClose={() => host.frameAct(s.id, "close")}
          closeLabel={`Close ${s.props.title}`}
        />
      )}
      {s.props.collapsed && (
        <FrameChip
          kind="page"
          label={!s.props.from && !s.props.relX && !s.props.relY ? "Web" : "Linked"}
          title={s.props.title}
          badge={host0 || undefined}
          mine={mine}
          live={live}
          onOpen={() => host.frameAct(s.id, "fold")}
          onClose={() => host.frameAct(s.id, "close")}
          closeLabel={`Close ${s.props.title}`}
        />
      )}
      {/* kept mounted while minimized (hidden, still laid out) so reopening is instant and keeps its highlights */}
      <div className="cv-doc-frame" style={{ top: DocShapeUtil.top(s), height: s.props.h, visibility: s.props.collapsed ? "hidden" : undefined }}>
        <iframe
          ref={(el) => host.setFrame(key, el)}
          src={s.props.src}
          title={s.props.title}
          data-canvas="1"
          style={{ pointerEvents: live && !s.props.collapsed ? "all" : "none" }}
          onLoad={(e) => host.wireFrame(e.currentTarget, key)}
        />
      </div>
    </HTMLContainer>
  );
}

function safeHost(href: string) {
  try {
    return new URL(href).host;
  } catch {
    return "";
  }
}

// ---- Explore cards ----

export class CardShapeUtil extends ShapeUtil<CardShape> {
  static override type = CARD;
  static override props = {
    w: T.number, h: T.number, term: T.string, context: T.string, trail: T.arrayOf(T.string), parent: T.string, page: T.string,
    relX: T.number, relY: T.number, level: T.number,
    parts: T.arrayOf(T.string), status: T.arrayOf(T.literalEnum("idle", "streaming", "done", "error")),
    sized: T.boolean, fixedW: T.boolean.optional(), createdAt: T.number,
    from: T.object({ lesson: T.string, card: T.string, createdAt: T.number.optional() }).nullable(),
    recall: T.object({ step: T.literalEnum("ask", "had", "done"), q: T.string.optional(), had: T.boolean.optional() }).nullable(),
  };
  private carry = new Carry();
  getDefaultProps(): CardProps {
    return {
      w: 360, h: 120, term: "", context: "", trail: [], parent: "", page: "", relX: 0, relY: 0, level: 1,
      parts: ["", "", "", ""], status: ["idle", "idle", "idle", "idle"], sized: false, createdAt: 0, from: null, recall: null,
    };
  }
  getGeometry(s: CardShape) {
    if (s.meta.fold) return new Rectangle2d({ width: CHIP_W, height: BAR_H, isFilled: true });
    return new Rectangle2d({ width: s.props.w, height: s.props.h, isFilled: true });
  }
  override hideRotateHandle() {
    return true;
  }
  // resized by its own grips (CardView): tldraw's handles would sit under the card's text
  override hideResizeHandles() {
    return true;
  }
  // always laid out: the marks inside a card are found and placed by their text's position
  override canCull() {
    return false;
  }
  override getText(s: CardShape) {
    return [s.props.term, ...s.props.parts.slice(0, 3).filter(Boolean)].join("\n\n");
  }
  override onResize(s: CardShape, info: TLResizeInfo<CardShape>) {
    const w = Math.max(240, info.initialShape.props.w * Math.abs(info.scaleX));
    const h = Math.max(140, info.initialShape.props.h * Math.abs(info.scaleY));
    return { x: info.newPoint.x, y: info.newPoint.y, props: { w, h, sized: true, fixedW: true } };
  }
  /** Double-click (its bar): bring it into view, fitted to the screen. Its grips fit it to its text. */
  override onDoubleClick(s: CardShape) {
    frameHooks.focus?.(s.id);
  }
  override onTranslateStart(s: CardShape) {
    this.carry.start(this.editor, s.id);
  }
  override onTranslate(initial: CardShape, current: CardShape) {
    this.carry.move(this.editor, initial, current);
  }
  component(s: CardShape) {
    return <CardView shape={s} />;
  }
  getIndicatorPath(s: CardShape) {
    const p = new Path2D();
    p.rect(0, 0, s.props.w, s.props.h);
    return p;
  }
}

/** Keep only inert drawing markup from a model-written SVG. */
function sanitizeSvg(raw: string): string {
  const start = raw.indexOf("<svg");
  if (start < 0) return "";
  const doc = new DOMParser().parseFromString(raw.slice(start), "text/html");
  const svg = doc.querySelector("svg");
  if (!svg) return "";
  const banned = new Set(["script", "style", "foreignobject", "iframe", "object", "embed", "link", "meta", "image", "audio", "video"]);
  for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    if (banned.has(el.tagName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      const v = a.value.trim().toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(a.name);
      else if ((n === "href" || n === "xlink:href") && !v.startsWith("#")) el.removeAttribute(a.name);
      else if (v.includes("url(") && !v.includes("url(#")) el.removeAttribute(a.name);
      else if (v.includes("javascript:")) el.removeAttribute(a.name);
    }
  }
  svg.removeAttribute("height");
  svg.setAttribute("width", "100%");
  return svg.outerHTML;
}

function Part({ level, text, status }: { level: number; text: string; status: Status }) {
  const html = useMemo(() => (level === 4 ? sanitizeSvg(text) : markdownWithMath(text)), [level, text]);
  // The same object while the text is the same: React sets innerHTML again for a new one even when the
  // HTML hasn't changed, which would remake the text on every re-render (a press on the board re-renders
  // cards) and collapse the marks on it.
  const inner = useMemo(() => ({ __html: html }), [html]);
  if (status === "error") return <p className="cv-err">{text || "The tutor didn’t answer."}</p>;
  if (!html) return <p className="cv-wait">{level === 4 ? "Drawing…" : "Thinking…"}</p>;
  return <div className={level === 4 ? "cv-svg" : `cv-text${status === "streaming" ? " live" : ""}`} dangerouslySetInnerHTML={inner} />;
}

/** A card's title; a term highlighted over maths arrives as $TeX$ and is typeset. */
function Term({ text }: { text: string }) {
  const html = useMemo(() => (text.includes("$") ? markdownWithMath(text).replace(/^<p>|<\/p>\s*$/g, "") : null), [text]);
  // a long highlight is cut to two lines (reader.css): the whole of it shows on hover
  return html ? <h3 title={text} dangerouslySetInnerHTML={{ __html: html }} /> : <h3 title={text}>{text}</h3>;
}

function CardView({ shape: s }: { shape: CardShape }) {
  const editor = useEditor();
  const host = useHost();
  const live = useLive();
  const mine = useMine();
  const p = s.props;
  const box = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);

  // An unsized card is as tall as its text: measure it and keep the shape's height in step
  // (outside undo, like the streaming itself).
  useEffect(() => {
    const el = box.current;
    if (!el || p.sized) return;
    const fit = () => {
      const h = Math.ceil(el.offsetHeight);
      if (!h) return; // hidden (off screen): nothing to measure
      const cur = editor.getShape<CardShape>(s.id);
      if (cur && !cur.props.sized && Math.abs(cur.props.h - h) > 1)
        editor.run(() => editor.updateShape<CardShape>({ id: s.id, type: CARD, props: { h } }), { history: "ignore" });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editor, s.id, p.sized]);

  // A card shorter than its text scrolls itself until it reaches its end; past that, the board moves.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.deltaY === 0) return;
      const room = e.deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      if (room) e.stopPropagation();
    };
    el.addEventListener("wheel", onWheel);
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Double-click and drag anywhere on the card moves it (and the cards opened from it). A double-click
  // that doesn't move selects the word under it, as a double-click in text always has.
  const lastDown = useRef(0);
  const [grab, setGrab] = useState<"" | "move" | "size">("");
  const onBodyDown = (e: ReactPointerEvent) => {
    // A drawing on top: the press is the board's (to select and move it), and starts no text selection.
    if (drawnOver(editor, s.id, e.clientX, e.clientY)) return e.preventDefault();
    editor.markEventAsHandled(e);
    host.touch(s.id); // the card in use is the one on top
    if (e.button !== 0) return;
    const second = e.timeStamp - lastDown.current < 400;
    lastDown.current = second ? 0 : e.timeStamp;
    if (!second) return;
    e.preventDefault(); // no native word selection: this press may become a drag
    window.getSelection()?.removeAllRanges();
    const { clientX, clientY } = e;
    const cur = editor.getShape<CardShape>(s.id);
    if (!cur) return;
    const from = [cur, ...followers(editor, s.id)].map((c) => ({ id: c.id, x: c.x, y: c.y }));
    editor.markHistoryStoppingPoint("move card");
    setGrab("move");
    follow(
      editor,
      e,
      (dx, dy) => editor.updateShapes(from.map((c) => ({ id: c.id, type: CARD, x: c.x + dx, y: c.y + dy }))),
      (moved) => {
        setGrab("");
        // after the click that ends this press, which would clear a selection made now
        if (!moved) setTimeout(() => host.cardWord(s.id, clientX, clientY), 0);
      },
    );
  };

  // The grips: the right edge sets the width (the height still fits the text), the bottom edge the
  // height, the corner both. Double-click any of them to fit the card to its text again.
  const resize = (e: ReactPointerEvent, sides: { w?: boolean; h?: boolean }) => {
    editor.markEventAsHandled(e);
    if (e.button !== 0) return;
    e.preventDefault();
    const cur = editor.getShape<CardShape>(s.id);
    if (!cur) return;
    const { w: w0, h: h0 } = cur.props;
    editor.markHistoryStoppingPoint("resize card");
    setGrab("size");
    follow(
      editor,
      e,
      (dx, dy) =>
        editor.updateShape<CardShape>({
          id: s.id,
          type: CARD,
          props: { ...(sides.w ? { w: Math.max(240, w0 + dx), fixedW: true } : {}), ...(sides.h ? { h: Math.max(120, h0 + dy), sized: true } : {}) },
        }),
      () => setGrab(""),
    );
  };
  const fit = () => editor.updateShape<CardShape>({ id: s.id, type: CARD, props: { w: cardW(p.level), sized: false, fixedW: false } });

  const on = live ? "all" : "none";
  if (s.meta.fold)
    return (
      <HTMLContainer>
        <FrameChip
          kind="card"
          title={p.term}
          badge={LEVEL_NAME[p.level]}
          mine={mine}
          live={live}
          onOpen={() => host.frameAct(s.id, "fold")}
          onClose={() => host.frameAct(s.id, "close")}
          closeLabel={`Remove card for ${p.term}`}
        />
      </HTMLContainer>
    );
  return (
    <HTMLContainer className={grab ? `cv-grab-${grab}` : undefined}>
      {live && (
        <>
          <span className="cv-grip cv-grip-r" onPointerDown={(e) => resize(e, { w: true })} onDoubleClick={fit} title="Drag to widen · double-click to fit" />
          <span className="cv-grip cv-grip-b" onPointerDown={(e) => resize(e, { h: true })} onDoubleClick={fit} title="Drag to set the height · double-click to fit" />
          <span className="cv-grip cv-grip-c" onPointerDown={(e) => resize(e, { w: true, h: true })} onDoubleClick={fit} title="Drag to resize · double-click to fit" />
        </>
      )}
      <article ref={box} className="cv-card" style={{ width: p.w, height: p.sized ? p.h : undefined }}>
        <FrameBar
          kind="card"
          title={<Term text={p.term} />}
          mine={mine}
          live={live}
          pinned={!!s.meta.pin}
          onPin={() => host.frameAct(s.id, "pin")}
          onFold={() => host.frameAct(s.id, "fold")}
          onClose={() => host.frameAct(s.id, "close")}
          closeLabel={`Remove card for ${p.term}`}
        />
        {p.recall?.step !== "ask" && (
          // the card's depth: moved by hand only (zooming no longer deepens a card), and back as well as on
          <div className="cv-depth" style={{ pointerEvents: on }} onPointerDown={mine}>
            <StopRail
              stops={["Definition", "Plain words", "How it works", "Picture"]}
              at={p.level - 1}
              have={p.status.flatMap((st, i) => (st === "done" ? [i] : []))}
              onChange={(i) => host.setLevel(s.id, i + 1)}
              label={`How deep the card on ${p.term} goes`}
            />
          </div>
        )}
        <div
          ref={body}
          className="cv-body"
          style={{ pointerEvents: on }}
          onPointerDown={onBodyDown}
          title="Double-click and drag to move the card"
          onMouseUp={(e) => host.cardMouseUp(s.id, e)}
          onClick={(e) => host.cardClick(s.id, e)}
        >
          {p.recall?.step === "ask" ? (
            <div className="cv-recall">
              <p className="cv-seen">
                You opened this {p.from?.createdAt ? new Date(p.from.createdAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "before"} · depth {p.level}
              </p>
              <p>
                <b>Recall first:</b> {p.recall.q ?? <span className="cv-wait">a question is coming…</span>}
              </p>
              <div>
                <button className="cv-show" onClick={() => host.showOld(s.id)}>
                  Show my card
                </button>
                <button className="cv-skip" onClick={() => host.answerRecall(s.id, null)}>
                  Skip
                </button>
              </div>
            </div>
          ) : (
            // the definition always, and below it only the depth the handle is on: the deeper parts swap, they don't pile up
            (p.level > 1 ? [1, p.level] : [1]).map((lv) => (
              <section key={lv} className={`cv-part cv-l${lv}`}>
                {lv > 1 && <h4>{LEVEL_NAME[lv]}</h4>}
                <Part level={lv} text={p.parts[lv - 1]} status={p.status[lv - 1]} />
                {p.status[lv - 1] === "error" && (
                  <button className="cv-mini" onClick={() => host.retry(s.id, lv)}>
                    Try again
                  </button>
                )}
                {lv === 4 && p.status[3] === "done" && (
                  <p className="cv-note">
                    Drawn by the tutor for this passage; check it against the text.{" "}
                    <button className="cv-mini" onClick={() => host.retry(s.id, 4)}>
                      Redraw
                    </button>
                  </p>
                )}
              </section>
            ))
          )}
        </div>
        {p.recall?.step === "had" && (
          <p className="cv-had" style={{ pointerEvents: on }} onPointerDown={mine}>
            Had it? <button onClick={() => host.answerRecall(s.id, true)}>yes</button>{" "}
            <button onClick={() => host.answerRecall(s.id, false)}>no</button>
          </p>
        )}
        {p.recall?.had === false && <p className="cv-had">It’ll come back in a warm-up.</p>}
      </article>
    </HTMLContainer>
  );
}

// ---- notes ----
// A sticky note the learner writes in: one document (lib/note.ts, NoteDoc) with passages highlighted
// anywhere on the board in it as clips ("→ Note", or dragged onto the note, landing where let go).
// From it, "Steer from this" makes a starting point (a heading, and a bridge after the learner's last
// word) to launch the lab from. Its bar drags it; its grips size it as a card's do.

const noteVersions = createShapePropsMigrationIds(NOTE, { OneDocument: 1 });

/** Two presses this close in time make a double click (the second one, held, moves a note). */
const DOUBLE_PRESS_MS = 400;

/** Select the word at a screen point in a note's text, as a double click on text does. */
function selectWordAt(t: TipTap | undefined, at: { left: number; top: number }) {
  const hit = t?.view.posAtCoords(at);
  if (!t || !hit) return;
  const $p = t.state.doc.resolve(hit.pos);
  if (!$p.parent.isTextblock) return;
  const text = $p.parent.textBetween(0, $p.parent.content.size, undefined, "\ufffc"); // a clip counts one, as positions do
  const inWord = (c: string | undefined) => !!c && /[\p{L}\p{N}'’_-]/u.test(c);
  let a = $p.parentOffset;
  let b = a;
  while (inWord(text[a - 1])) a--;
  while (inWord(text[b])) b++;
  t.chain().focus().setTextSelection({ from: $p.start() + a, to: $p.start() + b }).run();
}

/** Each note's editor while it is on the board: a highlight dragged over a note finds its place in the text through it. */
const noteEditors = new Map<TLShapeId, TipTap>();
export const noteEditor = (id: TLShapeId): TipTap | undefined => noteEditors.get(id);

export class NoteShapeUtil extends ShapeUtil<NoteShape> {
  static override type = NOTE;
  static override props = {
    w: T.number, h: T.number, sized: T.boolean, doc: T.jsonValue as unknown as T.Validator<DocNode>, createdAt: T.number,
  };
  // A note saved before it was one document (its draft, clips, starting point and the lab's text apart)
  // becomes one as its board opens (noteFromOld); the board's copy from before is kept (LessonCanvas).
  static override migrations = createShapePropsMigrationSequence({
    sequence: [{ id: noteVersions.OneDocument, up: (props) => noteFromOld(props as OldNoteProps) }],
  });
  getDefaultProps(): NoteProps {
    return { w: NOTE_W, h: NOTE_H, sized: false, doc: emptyDoc(), createdAt: 0 };
  }
  getGeometry(s: NoteShape) {
    // docked: one size on the screen at any zoom, so as big on the board as the zoom makes it small (NoteView draws it so)
    const z = s.meta.dock ? this.editor.getZoomLevel() : 1;
    if (s.meta.fold) return new Rectangle2d({ width: CHIP_W / z, height: BAR_H / z, isFilled: true });
    return new Rectangle2d({ width: s.props.w / z, height: s.props.h / z, isFilled: true });
  }
  override hideRotateHandle() {
    return true;
  }
  // resized by its own grips (NoteView), as a card is
  override hideResizeHandles() {
    return true;
  }
  override getText(s: NoteShape) {
    return docPlain(s.props.doc);
  }
  override onResize(s: NoteShape, info: TLResizeInfo<NoteShape>) {
    const w = Math.max(220, info.initialShape.props.w * Math.abs(info.scaleX));
    const h = Math.max(120, info.initialShape.props.h * Math.abs(info.scaleY));
    return { x: info.newPoint.x, y: info.newPoint.y, props: { w, h, sized: true } };
  }
  /** Double-click its bar: bring it into view, fitted to the screen. Its grips fit it to what is in it. */
  override onDoubleClick(s: NoteShape) {
    frameHooks.focus?.(s.id);
  }
  component(s: NoteShape) {
    return <NoteView shape={s} />;
  }
  getIndicatorPath(s: NoteShape) {
    const p = new Path2D();
    p.rect(0, 0, s.props.w, s.props.h);
    return p;
  }
}

function NoteView({ shape: s }: { shape: NoteShape }) {
  const editor = useEditor();
  const host = useHost();
  const live = useLive();
  const mine = useMine();
  const p = s.props;
  const box = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [grab, setGrab] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // An unsized note is as tall as what is in it (outside undo, as a card's measured height is).
  useEffect(() => {
    const el = box.current;
    if (!el || p.sized) return;
    const fit = () => {
      const h = Math.ceil(el.offsetHeight);
      if (!h) return; // hidden (off screen): nothing to measure
      const cur = editor.getShape<NoteShape>(s.id);
      if (cur && !cur.props.sized && Math.abs(cur.props.h - h) > 1)
        editor.run(() => editor.updateShape<NoteShape>({ id: s.id, type: NOTE, props: { h } }), { history: "ignore" });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editor, s.id, p.sized]);

  // A note shorter than what is in it scrolls itself until it reaches its end; past that, the board moves.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.deltaY === 0) return;
      const room = e.deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      if (room) e.stopPropagation();
    };
    el.addEventListener("wheel", onWheel);
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Selecting it (by its bar) touches it too: "→ Note" sends there next.
  const selected = useValue("note selected", () => editor.getSelectedShapeIds().includes(s.id), [editor, s.id]);
  useEffect(() => {
    if (selected) host.touchNote(s.id);
  }, [selected, host, s.id]);

  const clips = useMemo(() => docClips(p.doc), [p.doc]);
  // A clip whose page or card has closed, or whose tutor thread was removed, keeps its text, without its ↗ (and its mark).
  const threads = useTutor((t) => t.threads);
  const lost = useValue(
    "lost clip sources",
    () =>
      clips
        .filter((c) => (c.thread ? !threads.some((t) => t.id === c.thread) : (c.card || c.page) && !editor.getShape(shapeId(c.card || c.page) as TLShapeId)))
        .map((c) => c.id),
    [editor, clips, threads],
  );

  /** Typing goes outside the board's undo (the editor keeps its own); a clip taken out, a drop or a start is a step. */
  const write = (doc: DocNode) => editor.run(() => editor.updateShape<NoteShape>({ id: s.id, type: NOTE, props: { doc } }), { history: "ignore" });
  const onAct = (act: "go" | "x", clip: string) => {
    if (act === "go") return host.goToClip(s.id, clip);
    const cur = editor.getShape<NoteShape>(s.id);
    if (cur) editor.updateShape<NoteShape>({ id: s.id, type: NOTE, props: { doc: removeClip(cur.props.doc, clip) } });
  };

  // The grips: the right edge sets the width (the height still fits what is in it), the bottom edge
  // the height, the corner both. Double-click any of them to fit the note again.
  const resize = (e: ReactPointerEvent, sides: { w?: boolean; h?: boolean }) => {
    editor.markEventAsHandled(e);
    if (e.button !== 0) return;
    e.preventDefault();
    const cur = editor.getShape<NoteShape>(s.id);
    if (!cur) return;
    const { w: w0, h: h0 } = cur.props;
    editor.markHistoryStoppingPoint("resize note");
    setGrab(true);
    follow(
      editor,
      e,
      (dx, dy) =>
        editor.updateShape<NoteShape>({
          id: s.id,
          type: NOTE,
          props: { ...(sides.w ? { w: Math.max(220, w0 + dx) } : {}), ...(sides.h ? { h: Math.max(120, h0 + dy), sized: true } : {}) },
        }),
      () => setGrab(false),
    );
  };
  const fit = () => editor.updateShape<NoteShape>({ id: s.id, type: NOTE, props: { w: NOTE_W, sized: false } });

  // Double-click and drag anywhere on the note moves it, as a sticky on a whiteboard: the second press
  // of a double click is the note's, not the text's. Let go without moving and it was a double click
  // on the text after all: the word under it is selected, as the text would have.
  const lastPress = useRef({ t: 0, x: 0, y: 0 });
  const [moving, setMoving] = useState(false);
  const carried = useRef(false); // the click that ends a move is not a click on the note's empty space
  const pressBody = (e: ReactPointerEvent) => {
    carried.current = false; // a new press: no move's click is left to ignore
    if (e.button !== 0) return;
    const prev = lastPress.current;
    const now = performance.now();
    lastPress.current = { t: now, x: e.clientX, y: e.clientY };
    const second = now - prev.t < DOUBLE_PRESS_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 6;
    if (!second || (e.target as Element).closest("button") || drawnOver(editor, s.id, e.clientX, e.clientY)) return;
    lastPress.current.t = 0; // a third press starts over
    e.preventDefault(); // no mousedown follows: the text neither moves its caret nor selects
    e.stopPropagation();
    editor.markEventAsHandled(e);
    const cur = editor.getShape<NoteShape>(s.id);
    if (!cur) return;
    const { x: x0, y: y0 } = cur;
    const at = { left: e.clientX, top: e.clientY };
    editor.markHistoryStoppingPoint("move note");
    setMoving(true);
    follow(
      editor,
      e,
      (dx, dy) => editor.updateShape<NoteShape>({ id: s.id, type: NOTE, x: x0 + dx, y: y0 + dy }),
      (moved) => {
        setMoving(false);
        carried.current = moved;
        if (!moved) selectWordAt(noteEditor(s.id), at);
      },
    );
  };

  const make = () => {
    setBusy(true);
    setErr("");
    host
      .makeStart(s.id)
      .catch((e: Error) => setErr(e.message || "No starting point came back."))
      .finally(() => setBusy(false));
  };

  const on = live ? "all" : "none";
  const docked = !!s.meta.dock;
  // docked, it is drawn at one size on the screen, whatever the zoom (see NoteShapeUtil.getGeometry), and no taller than most of it
  const zoom = useValue("note zoom", () => editor.getZoomLevel(), [editor]);
  const dockStyle = docked ? { transform: `scale(${1 / zoom})`, transformOrigin: "0 0" } : undefined;
  const topic = docTopic(p.doc);
  const started = hasAuthored(p.doc, ["model", "lab"]);
  const any = clips.length > 0 || !!docPlain(p.doc).trim();
  // what the lab wrote here folds to one line until opened (it can run to hundreds of words)
  const labWords = useMemo(() => words(docPlain(p.doc)) - words(docPlain(dropAuthored(p.doc, ["lab"]))), [p.doc]);
  // the paragraphs that are the lab's alone (its first piece may carry on one of yours, which stays): their places in the note
  const labOnly = useMemo(
    () =>
      (p.doc.content ?? []).flatMap((b, i) =>
        b.type === "paragraph" && b.content?.length && b.content.every((n) => n.type === "text" && n.marks?.some((m) => m.attrs?.by === "lab")) ? [i + 1] : [],
      ),
    [p.doc],
  );
  const labOpen = !!s.meta.labOpen;
  const title = topic || docPlain(p.doc).trim().split(/\s+/).slice(0, 6).join(" ") || "Note";
  if (s.meta.fold)
    return (
      <HTMLContainer style={dockStyle}>
        <FrameChip
          kind="note"
          title={title}
          badge={clips.length ? `${clips.length} clip${clips.length === 1 ? "" : "s"}` : undefined}
          mine={mine}
          live={live}
          onOpen={() => host.frameAct(s.id, "fold")}
          onClose={() => host.frameAct(s.id, "close")}
          closeLabel="Remove this note"
        />
      </HTMLContainer>
    );
  return (
    <HTMLContainer className={grab ? "cv-grab-size" : undefined} style={dockStyle}>
      {live && !docked && (
        <>
          <span className="cv-grip cv-grip-r" onPointerDown={(e) => resize(e, { w: true })} onDoubleClick={fit} title="Drag to widen · double-click to fit" />
          <span className="cv-grip cv-grip-b" onPointerDown={(e) => resize(e, { h: true })} onDoubleClick={fit} title="Drag to set the height · double-click to fit" />
          <span className="cv-grip cv-grip-c" onPointerDown={(e) => resize(e, { w: true, h: true })} onDoubleClick={fit} title="Drag to resize · double-click to fit" />
        </>
      )}
      <article
        ref={box}
        className={`cv-note${moving ? " cv-moving" : ""}${labWords > 0 && !labOpen ? " fr-labfold" : ""}`}
        // docked: no taller than most of the screen (its text scrolls)
        style={{ width: p.w, height: p.sized && !docked ? p.h : undefined, maxHeight: docked ? "62vh" : undefined }}
        onPointerDownCapture={() => host.touchNote(s.id)}
      >
        <FrameBar
          kind="note"
          title={null} // its heading is its title: the bar doesn't say it again (a folded note's chip does)
          mine={mine}
          live={live}
          pinned={docked}
          dock
          onPin={() => host.frameAct(s.id, "pin")}
          onFold={() => host.frameAct(s.id, "fold")}
          onClose={() => host.frameAct(s.id, "close")}
          closeLabel="Remove this note"
        />
        <div
          ref={body}
          className="cv-note-body"
          style={{ pointerEvents: on }}
          onPointerDownCapture={pressBody}
          // a drawing on top is the board's to move (drawnOver); a press anywhere else is the note's
          onPointerDown={(e) => (drawnOver(editor, s.id, e.clientX, e.clientY) ? e.preventDefault() : mine(e))}
          // a click on the note's empty space writes at the end, as on a page
          onClick={(e) => {
            if (carried.current) return void (carried.current = false);
            if (!(e.target as Element).closest(".ProseMirror, button")) noteEditor(s.id)?.commands.focus("end");
          }}
        >
          {labWords > 0 && !labOpen && labOnly.length > 0 && (
            <style>{labOnly.map((k) => `.tl-shape[data-shape-id="${s.id}"] .cv-note-doc > :nth-child(${k})`).join(",") + "{display:none}"}</style>
          )}
          {lost.length > 0 && (
            <style>{lost.map((id) => `.tl-shape[data-shape-id="${s.id}"] .cv-clip[data-clip="${id}"] [data-act="go"]{display:none}`).join("")}</style>
          )}
          <NoteDoc
            value={p.doc}
            onChange={write}
            onAct={onAct}
            onEditor={(t) => (t ? noteEditors.set(s.id, t) : noteEditors.delete(s.id))}
            placeholder="Write your idea… (drop highlights anywhere in it)"
          />
        </div>
        {labWords > 0 && (
          <button
            className="fr-labline"
            style={{ pointerEvents: on }}
            onPointerDown={mine}
            onClick={() => editor.run(() => editor.updateShape<NoteShape>({ id: s.id, type: NOTE, meta: { ...s.meta, labOpen: !labOpen } }), { history: "ignore" })}
            aria-expanded={labOpen}
          >
            {labOpen ? "Fold what the lab wrote ▴" : `The lab wrote ${labWords} words here ▾`}
          </button>
        )}
        {any && host.canSteer() && (
          <footer className="cv-note-foot" style={{ pointerEvents: on }} onPointerDown={mine}>
            {topic && (
              <button className="cv-launch" onClick={() => host.launchNote(s.id)}>
                Launch ▸
              </button>
            )}
            <button
              className={topic ? "cv-skip" : "cv-launch"}
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={make}
              title={started ? "Take out what the model and the lab wrote, and make a new start from your words and clips" : undefined}
            >
              {busy ? "Finding a starting point…" : started ? "New starting point" : "Steer from this"}
            </button>
            {err && <p className="cv-err">{err}</p>}
          </footer>
        )}
      </article>
    </HTMLContainer>
  );
}

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** A note is hidden while it is a lab (the lab stands in its place, meta.note), for Tldraw's
    getShapeVisibility: hidden, it can't be selected or hit under the lab, or left behind if the lab moves. */
export function noteVisibility(shape: TLShape, editor: Editor): "hidden" | "inherit" {
  if (shape.type !== NOTE) return "inherit";
  const id = bareId(shape.id);
  return editor.getCurrentPageShapes().some((x) => x.type === LAB && x.meta.note === id) ? "hidden" : "inherit";
}

// ---- the live lab ----

const LAB_MIN_W = 560; // room for the rail, the column and the pins beside it; the lab lays itself out 1:1 at any width at or above this
const LAB_MIN_H = 320;

/** The lab that runs, when the board holds several: the one last opened or pressed into (or else the newest).
    The others pause, keeping what they show, so only one makes model calls and sound. */
const activeLabs = new WeakMap<Editor, Atom<TLShapeId | null>>();
function activeLab(editor: Editor) {
  let a = activeLabs.get(editor);
  if (!a) activeLabs.set(editor, (a = atom<TLShapeId | null>("active lab", null)));
  return a;
}

export class LabShapeUtil extends ShapeUtil<LabShape> {
  static override type = LAB;
  static override props = {
    w: T.number, h: T.number, topic: T.string, section: T.string, from: T.string, relX: T.number, relY: T.number,
    start: T.string, prefix: T.string, sources: T.arrayOf(T.object({ quote: T.string, where: T.string, around: T.string, weight: T.string.optional(), use: T.string.optional() })),
  };
  getDefaultProps(): LabProps {
    return { w: 1100, h: 720, topic: "", section: "", from: "", relX: 0, relY: 0, start: "", prefix: "", sources: [] };
  }
  getGeometry(s: LabShape) {
    return new Rectangle2d({ width: s.props.w, height: BAR_H + s.props.h, isFilled: true });
  }
  override canResize() {
    return false; // resized by its own grips (LabView), as tldraw's handles would sit on the lab
  }
  override hideRotateHandle() {
    return true;
  }
  override canCull() {
    return false;
  }
  /** Double-click its bar: bring it into view, fitted to the screen. */
  override onDoubleClick(s: LabShape) {
    frameHooks.focus?.(s.id);
  }
  component(s: LabShape) {
    return <LabView shape={s} />;
  }
  getIndicatorPath(s: LabShape) {
    const p = new Path2D();
    p.rect(0, 0, s.props.w, BAR_H + s.props.h);
    return p;
  }
}

/** A lab grows out of its note's box as it opens, and shrinks back into it as it closes: one thing
    changing size. Its clip moves, not its box, so the lab lays itself out at its own size meanwhile. */
export function morphLab(el: Element | null | undefined, note: { w: number; h: number }, lab: { w: number; h: number }, open: boolean): Promise<void> {
  if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  const small = `inset(0px ${Math.max(0, lab.w - note.w)}px ${Math.max(0, lab.h - note.h)}px 0px round 12px)`;
  const full = "inset(0px 0px 0px 0px round 12px)";
  const a = el.animate([{ clipPath: open ? small : full }, { clipPath: open ? full : small }], {
    duration: open ? 260 : 180,
    easing: open ? "cubic-bezier(0.2, 0.8, 0.2, 1)" : "cubic-bezier(0.4, 0, 0.9, 0.5)",
    fill: open ? "none" : "forwards",
  });
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

// ---- per-clip weight (slice 3): each clip the lab keeps to is a dial on the main knob's fan, swung to its weight ----

/** A clip's label for its dial in the fan: where it came from, or its first words, kept short. */
function clipLabel(c: Clip): string {
  return (c.where || c.quote).replace(/\s+/g, " ").trim().slice(0, 48);
}

function LabView({ shape: s }: { shape: LabShape }) {
  const editor = useEditor();
  const host = useHost();
  const live = useLive();
  const mine = useMine();
  const active = useValue(
    "lab active",
    () => {
      const labs = editor.getCurrentPageShapes().filter((l) => l.type === LAB);
      const chosen = activeLab(editor).get();
      return (labs.some((l) => l.id === chosen) ? chosen : labs.at(-1)?.id) === s.id;
    },
    [editor, s.id],
  );
  // what it picks up from, read as it opens (the lab reads it once)
  const [resume] = useState(() => host.labResume(s.id));
  // The passages the lab keeps to: its note's clips, read live, so one clipped or taken out while the lab is open reaches it
  // (Lab pushes the new list in). Falls back to the launch seed when the note is gone.
  const sources = useValue(
    "lab sources",
    () => {
      const note = editor.getShape<NoteShape>(shapeId(String(s.meta.note ?? "")) as TLShapeId);
      return note?.type === NOTE ? docClips(note.props.doc).map(({ quote, where, around, weight, use }) => ({ quote, where, around, weight, use })) : s.props.sources;
    },
    [editor, s.id],
  );
  // The clips the dial offers through the "Clips" gateway: id, a short label, the passage and the text around it (to ask the
  // model for ways to use it), and the steer now (weight, or a picked use). Read live, like the sources.
  const clips = useValue(
    "lab clips",
    () => {
      const note = editor.getShape<NoteShape>(shapeId(String(s.meta.note ?? "")) as TLShapeId);
      return note?.type === NOTE
        ? docClips(note.props.doc).map((c) => ({ id: c.id, label: clipLabel(c), quote: c.quote, around: c.around, weight: clipWeightOf(c), use: c.use }))
        : [];
    },
    [editor, s.id],
  );
  // it opens out of its note
  useEffect(() => {
    const note = editor.getShapePageBounds(shapeId(String(s.meta.note ?? "")) as TLShapeId);
    const el = editor.getContainer().querySelector(`.tl-shape[data-shape-id="${s.id}"] .cv-lab`);
    if (note) morphLab(el, note, { w: s.props.w, h: BAR_H + s.props.h }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as it opens
  }, []);
  // a lab opened now is the one that runs
  useEffect(() => {
    activeLab(editor).set(s.id);
  }, [editor, s.id]);

  // The grips, as on a card: the right edge sets the width, the bottom edge the height, the corner both. The lab lays itself out again.
  const [sizing, setSizing] = useState(false);
  const resize = (e: ReactPointerEvent, sides: { w?: boolean; h?: boolean }) => {
    editor.markEventAsHandled(e);
    if (e.button !== 0) return;
    e.preventDefault();
    const cur = editor.getShape<LabShape>(s.id);
    if (!cur) return;
    const { w: w0, h: h0 } = cur.props;
    editor.markHistoryStoppingPoint("resize lab");
    setSizing(true);
    follow(
      editor,
      e,
      (dx, dy) =>
        editor.updateShape<LabShape>({
          id: s.id,
          type: LAB,
          props: { ...(sides.w ? { w: Math.round(Math.max(LAB_MIN_W, w0 + dx)) } : {}), ...(sides.h ? { h: Math.round(Math.max(LAB_MIN_H, h0 + dy)) } : {}) },
        }),
      () => setSizing(false),
    );
  };

  return (
    <HTMLContainer className={`cv-lab${sizing ? " cv-grab-size" : ""}`}>
      {live && (
        <>
          <span className="cv-grip cv-grip-r" onPointerDown={(e) => resize(e, { w: true })} title="Drag to widen" />
          <span className="cv-grip cv-grip-b" onPointerDown={(e) => resize(e, { h: true })} title="Drag to set the height" />
          <span className="cv-grip cv-grip-c" onPointerDown={(e) => resize(e, { w: true, h: true })} title="Drag to resize" />
        </>
      )}
      <FrameBar kind="lab" title={s.props.topic} mine={mine} live={live} onClose={() => host.closeLab(s.id)} closeLabel={`Close the live lab on ${s.props.topic}: back to its note`} />
      <div
        className="cv-lab-body"
        style={{ top: BAR_H, height: s.props.h, pointerEvents: live ? "all" : "none" }}
        onPointerDown={(e) => {
          mine(e);
          activeLab(editor).set(s.id);
          host.touch(s.id);
        }}
      >
        {/* laid out at the card's own size (the lab works at any width): widening the card gives the text more room and it
            reflows, instead of magnifying a fixed-width layout. The lab measures positions through the board's zoom (space.ts). */}
        <Lab
          start={s.props.start || headingOf(s.props.topic)}
          sources={sources}
          clips={clips}
          onClipSteer={(clipId, steer) => host.steerClip(shapeId(String(s.meta.note ?? "")) as TLShapeId, clipId, steer)}
          active={active}
          resume={resume}
          onText={(text) => host.labText(s.id, text)}
          onState={(state) => host.labState(String(s.meta.note ?? ""), String(s.meta.run ?? ""), s.props.start, state)}
          className="h-full w-full"
          onEscape={host.goBack}
          completeUrl={host.labRoute()}
          onEvent={(event, envelope) => host.logSteer(s.props.section, event, envelope)}
        />
      </div>
    </HTMLContainer>
  );
}

// ---- tldraw's arrows: a click travels along one ----

export type Ends = { start: Pt; end: Pt };
export type Attached = { start?: TLShapeId; end?: TLShapeId };
const travels = new WeakMap<Editor, (ends: Ends, attached: Attached) => void>();
/** What a click on an arrow does on this board (LessonCanvas: glide to its far end). */
export function onTravel(editor: Editor, fn: (ends: Ends, attached: Attached) => void) {
  travels.set(editor, fn);
  return () => travels.delete(editor);
}

/** tldraw's arrow, plus a click that travels along it. It still selects, so its bend can be dragged. */
export class LinkArrowUtil extends ArrowShapeUtil {
  override onClick(arrow: TLArrowShape) {
    const info = getArrowInfo(this.editor, arrow);
    if (!info) return;
    const tf = this.editor.getShapePageTransform(arrow.id);
    const bound: Attached = {};
    for (const b of this.editor.getBindingsFromShape(arrow.id, "arrow")) bound[(b.props as { terminal: "start" | "end" }).terminal] = b.toId;
    travels.get(this.editor)?.({ start: tf.applyToPoint(info.start.point), end: tf.applyToPoint(info.end.point) }, bound);
  }
}

// ---- the narrated video ("Watch") ----

export class VideoShapeUtil extends ShapeUtil<VideoShape> {
  static override type = VIDEO;
  static override props = {
    w: T.number, h: T.number, term: T.string, context: T.string, parent: T.string, page: T.string, relX: T.number, relY: T.number,
    course: T.string, video: T.string, createdAt: T.number,
  };
  getDefaultProps(): VideoProps {
    return { w: VIDEO_W, h: VIDEO_H, term: "", context: "", parent: "", page: "", relX: 0, relY: 0, course: "", video: "", createdAt: 0 };
  }
  getGeometry(s: VideoShape) {
    return new Rectangle2d({ width: s.props.w, height: s.props.h, isFilled: true });
  }
  override canResize() {
    return false;
  }
  override hideRotateHandle() {
    return true;
  }
  // always mounted: scrolled off screen, it keeps playing (you hear it as you read on)
  override canCull() {
    return false;
  }
  /** Double-click its bar: bring it into view, fitted to the screen. */
  override onDoubleClick(s: VideoShape) {
    frameHooks.focus?.(s.id);
  }
  component(s: VideoShape) {
    return <VideoView shape={s} />;
  }
  getIndicatorPath(s: VideoShape) {
    const p = new Path2D();
    p.rect(0, 0, s.props.w, s.props.h);
    return p;
  }
}

/** A model-written frame as a drawing on the page, or null if it isn't one. */
function parseFrame(raw: string): SVGSVGElement | null {
  const box = document.createElement("div");
  box.innerHTML = sanitizeSvg(raw);
  return box.querySelector("svg");
}

/** A video on the board. It plays scene by scene, each as soon as it exists (so the first plays
    within seconds, and the rest are made ahead of it): the scene's frame as a drawing that moves
    (lib/motion.ts: parts glide from the frame before, new ones build in as they are spoken of), set
    from its voice's clock at every screen frame, so the two can't drift. It is drawn live, sharp at
    any zoom, the same while it is being made and on every later visit. The narration is listed
    under the picture with the scene being spoken lit; a click on a line goes to that scene. */
function VideoView({ shape: s }: { shape: VideoShape }) {
  const editor = useEditor();
  const host = useHost();
  const live = useLive();
  const mine = useMine();
  const { course, video, term, w, h } = s.props;
  const frameH = Math.round(w * VIDEO_RATIO); // the picture scales with the card's width, keeping its aspect
  const q = `course=${encodeURIComponent(course)}&id=${encodeURIComponent(video)}`;
  const file = (name: string) => `/api/watch/file?${q}&name=${name}`;

  const [got, setGot] = useState<{ job: WatchJob; scenes: Scene[] } | null>(null);
  const [gone, setGone] = useState(false);
  const [at, setAt] = useState(0); // the scene being spoken
  const [playing, setPlaying] = useState(false);
  const fresh = useRef<boolean | null>(null); // made just now (not a video from an earlier visit): it starts itself
  const atRef = useRef(at);
  useEffect(() => {
    atRef.current = at;
  }, [at]);
  /** The end: back to the first scene, stopped. */
  const finish = () => {
    setPlaying(false);
    setAt(0);
  };
  useEffect(() => {
    let stop = false;
    let timer = 0;
    const tick = async () => {
      const res = await fetch(`/api/watch?${q}`).catch(() => null);
      if (stop) return;
      if (res?.status === 404) return setGone(true);
      const r = res?.ok ? ((await res.json()) as { job: WatchJob; scenes: Scene[] }) : null;
      if (stop) return;
      const making = !r || r.job.status === "queued" || r.job.status === "running";
      if (r) {
        if (fresh.current === null) fresh.current = making;
        setGot(r);
        if (fresh.current && r.scenes.length) {
          // made just now: it starts as soon as its first scene can play
          fresh.current = false;
          setPlaying(true);
        }
        if (!making && atRef.current >= r.scenes.length) finish(); // it was waiting for a scene that will not come
      }
      if (making) timer = window.setTimeout(tick, 300);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [q]);

  const job = got?.job;
  const scenes = got?.scenes ?? [];
  const making = !job || job.status === "queued" || job.status === "running";
  const first = scenes.length > 0;
  const have = at < scenes.length; // false: waiting for the scene we are at to be made
  const audio = useRef<HTMLAudioElement>(null);
  const lines = useRef<HTMLOListElement>(null);

  // each scene's frame, fetched once as it appears
  const [frames, setFrames] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const names = scenes.map((x) => x.visual).join(" ");
  useEffect(() => {
    for (const name of names ? names.split(" ") : []) {
      if (asked.current.has(name)) continue;
      asked.current.add(name);
      fetch(`/api/watch/file?${q}&name=${name}`)
        .then((r) => (r.ok ? r.text() : ""))
        .then((text) => setFrames((f) => ({ ...f, [name]: text })), () => asked.current.delete(name));
    }
  }, [names, q]);

  // The scene on screen (the last one made, while waiting for the next), as a drawing that moves from the frame before it.
  const shownAt = Math.min(at, scenes.length - 1);
  const cur = scenes[shownAt];
  const curFrame = cur ? frames[cur.visual] : undefined;
  const prevFrame = shownAt > 0 ? frames[scenes[shownAt - 1].visual] : "";
  const narration = cur?.narration ?? "";
  const dur = cur?.dur ?? 0;
  const stageEl = useRef<HTMLSpanElement>(null);
  const moving = useRef<{ seek: (t: number) => void } | null>(null);
  useEffect(() => {
    const el = stageEl.current;
    const next = curFrame ? parseFrame(curFrame) : null;
    if (!el || !next || prevFrame === undefined) return;
    const made = stage(prevFrame ? parseFrame(prevFrame) : null, next, narration, dur);
    el.replaceChildren(made.svg);
    moving.current = made;
    return () => {
      moving.current = null;
    };
  }, [curFrame, prevFrame, narration, dur]);
  // The voice of the scene we are at, and the drawing set from its clock. Stopped before it ever ran, or waiting for the
  // next scene, the drawing is whole.
  useEffect(() => {
    const a = audio.current;
    if (a) {
      if (playing && have) a.play().catch(() => setPlaying(false)); // the browser refused to start sound: press play
      else a.pause();
    }
    const set = () => moving.current?.seek(a && have && (playing || a.currentTime > 0) ? a.currentTime : dur);
    set();
    if (!playing || !have) return;
    let raf = requestAnimationFrame(function loop() {
      set();
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, have, at, dur, curFrame, prevFrame]);
  // the line being spoken stays in view
  useEffect(() => {
    const list = lines.current;
    const line = list?.children[at] as HTMLElement | undefined;
    if (list && line) list.scrollTop = line.offsetTop - list.offsetTop - 8;
  }, [at]);

  const goTo = (i: number) => {
    if (i === at && audio.current) audio.current.currentTime = 0;
    setAt(i);
    setPlaying(true);
  };
  const cancel = () => fetch("/api/watch/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ course, id: video }) }).catch(() => {});

  // The grips, as on a card: the right edge sets the width (the picture scales to it), the bottom edge
  // the height (the narration list under the picture grows or shrinks), the corner both. The card keeps a
  // minimum size so the picture never crowds out the narration.
  const [sizing, setSizing] = useState(false);
  const resize = (e: ReactPointerEvent, sides: { w?: boolean; h?: boolean }) => {
    editor.markEventAsHandled(e);
    if (e.button !== 0) return;
    e.preventDefault();
    const cur = editor.getShape<VideoShape>(s.id);
    if (!cur) return;
    const { w: w0, h: h0 } = cur.props;
    editor.markHistoryStoppingPoint("resize video");
    setSizing(true);
    follow(
      editor,
      e,
      (dx, dy) => {
        const nw = sides.w ? Math.max(VIDEO_MIN_W, Math.round(w0 + dx)) : w0;
        const minH = BAR_H + Math.round(nw * VIDEO_RATIO) + VIDEO_LINES_MIN;
        const nh = Math.max(minH, Math.round((sides.h ? h0 + dy : h0)));
        editor.updateShape<VideoShape>({ id: s.id, type: VIDEO, props: { ...(sides.w ? { w: nw } : {}), h: nh } });
      },
      () => setSizing(false),
    );
  };

  const on = live ? "all" : "none";
  return (
    <HTMLContainer className={sizing ? "cv-grab-size" : undefined}>
      {live && (
        <>
          <span className="cv-grip cv-grip-r" onPointerDown={(e) => resize(e, { w: true })} title="Drag to widen" />
          <span className="cv-grip cv-grip-b" onPointerDown={(e) => resize(e, { h: true })} title="Drag to set the height" />
          <span className="cv-grip cv-grip-c" onPointerDown={(e) => resize(e, { w: true, h: true })} title="Drag to resize" />
        </>
      )}
      <article className="cv-card cv-video" style={{ width: w, height: h }} onPointerDown={() => host.touch(s.id)}>
        <FrameBar kind="video" title={term} mine={mine} live={live} onClose={() => host.frameAct(s.id, "close")} closeLabel={`Remove the video about ${term}`} />
        <div className="cv-vid-frame" style={{ height: frameH }}>
          {curFrame ? (
            <button className="cv-vid-still" style={{ pointerEvents: on }} onPointerDown={mine} onClick={() => setPlaying((x) => !x)} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"}>
              <span className="cv-vid-stage" ref={stageEl} />
              {!playing && <span className="cv-vid-play">▶</span>}
            </button>
          ) : (
            <div className="cv-vid-wait" aria-busy={(making || first) && !gone}>
              {gone ? "This video's files are gone." : job?.status === "failed" ? "The video couldn't be made." : job?.status === "cancelled" ? "Cancelled." : (job?.progress ?? "starting")}
            </div>
          )}
          {have && <audio ref={audio} src={file(scenes[at].audio)} onEnded={() => (at + 1 >= scenes.length && !making ? finish() : setAt(at + 1))} />}
        </div>
        {(making || job?.status === "failed" || (job?.status === "cancelled" && first)) && !gone && (
          <p className="cv-vid-status" role="status">
            {making ? (
              <>
                <span>{job?.progress ?? "starting"}…</span>
                <button style={{ pointerEvents: on }} onPointerDown={mine} onClick={cancel}>
                  Cancel
                </button>
              </>
            ) : job?.status === "failed" ? (
              <span>{job.error ?? "It failed."}</span>
            ) : (
              <span>Cancelled: this is as far as it got.</span>
            )}
          </p>
        )}
        <ol className="cv-vid-lines" ref={lines}>
          {scenes.map((x, i) => (
            <li key={i} className={i === at && playing ? "on" : undefined} style={{ pointerEvents: on }} onPointerDown={mine} onClick={() => goTo(i)}>
              {x.narration}
            </li>
          ))}
        </ol>
      </article>
    </HTMLContainer>
  );
}

/** The lines earlier versions drew from a highlight to its card, which the marks replaced. Kept only
    so a board saved with them still loads; LessonCanvas deletes them as it opens. */
export class LeaderShapeUtil extends ShapeUtil<LeaderShape> {
  static override type = LEADER;
  static override props = {
    from: T.string, to: T.string, ax: T.number, ay: T.number, ey: T.number, dx: T.number, dy: T.number,
    bends: T.arrayOf(T.object({ t: T.number, n: T.number })), lab: T.boolean, shaped: T.boolean.optional(), axL: T.number.optional(), side: T.number.optional(),
  };
  getDefaultProps(): LeaderProps {
    return { from: "", to: "", ax: 0, ay: 0, ey: 0, dx: 0, dy: 0, bends: [], lab: false };
  }
  getGeometry() {
    return new Rectangle2d({ width: 1, height: 1, isFilled: false });
  }
  component() {
    return null;
  }
  getIndicatorPath() {
    return undefined;
  }
}

export const shapeUtils = [DocShapeUtil, CardShapeUtil, NoteShapeUtil, LabShapeUtil, LeaderShapeUtil, VideoShapeUtil, LinkArrowUtil];
export { shapeId, bareId };
