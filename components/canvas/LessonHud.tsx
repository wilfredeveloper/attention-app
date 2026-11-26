"use client";

// The lesson's HUD on the canvas: what is highlighted in the lesson is defined at once, in the margin beside it, and a knob stands
// in for the Explore / Ask / Steer live / → Note bar (which a highlight in a card or a linked page still gets).
//
//   - Brackets lock onto the highlighted words (onto the term itself, when the highlight is part of one), a hairline tethers them
//     to a readout in the margin with the definition, and the words keep a faint tint. While a definition is being written for
//     words the glossary lacks, the lock hunts and dashes run down the tether.
//   - Let go and the definition is kept: two quiet corners on the words, a readout in the margin, a tick on the rail at the
//     screen's edge (press it to go there). The pointer on either the words or the readout lights the pair up again.
//   - The knob at the lock's foot: pull it out, or click it, for a fan of handles, as the lab's dial menu opens. A handle with a
//     setting (Ask's depth, which note) opens a second fan past the rim; letting go before the rim takes its default.
//
// The state is components/canvas/lessonGloss.ts, the rule for what counts as a term lib/gloss.ts, the looks app/reader.css.

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { useValue, type Editor, type TLShapeId } from "tldraw";
import { BAR_H } from "@/lib/board";
import { optionIndexAt } from "@/lib/lab/text/dimension";
import { axisFor } from "@/lib/lab/text/fan-axis";
import { SWING_RADIANS } from "@/lib/lab/text/future-hud";
import { docPlain, docTopic } from "@/lib/note";
import { LEVEL_LABEL, type TutorLevel } from "@/lib/tutor";
import { askAgain, clearKept, gloss, hudSounds, setHover, soundOn, sourceOf, subscribe, toggleSound, type Shown } from "@/components/canvas/lessonGloss";
import { CARD, DOC, LAB, LESSON_ID, NOTE, type NoteShape } from "@/components/canvas/shapes";
import { liquidTouch, startLiquid } from "@/components/canvas/liquid";

/** The highlight the canvas is offering actions on: what the bar's buttons would do with it. */
export type HudPick = {
  term: string;
  explore: () => void;
  ask: (level: TutorLevel) => void;
  watch?: () => void; // a short narrated video about it, beside it
  // a highlight in a note only explores and asks: it is already in a note, and a note's words aren't a passage to steer from
  steer?: () => void;
  toNote?: (into?: NoteShape) => void; // none: the note last used
  newNote?: () => void;
};

/** Whether the HUD's knob stands in for the bar under a highlight: the HUD is showing a highlight made in that same place (the
    lesson, a linked page or a card: `source`, its shape's id). */
export function useHudTakesPick(source: string | null) {
  // the answer itself is the snapshot, so the canvas renders again only when it changes, not at every move of the highlight
  const showing = useSyncExternalStore(subscribe, () => gloss().shown?.source ?? null, () => null);
  return !!source && showing === source;
}

const READ_W = 280; // a readout's width, in the lesson's px
const isPending = (n: object) => !!(n as Partial<Shown>).pending;
const hasFailed = (n: object) => !!(n as Partial<Shown>).failed;

const blockIds = new WeakMap<Element, number>();
let blockCount = 0;
const idOf = (n: { term: string; block: Element | null }) => {
  if (n.block && !blockIds.has(n.block)) blockIds.set(n.block, ++blockCount);
  return `${n.term}|${n.block ? blockIds.get(n.block) : 0}`;
};
const same = (a: { term: string; block: Element | null } | null, b: { term: string; block: Element | null }) => !!a && a.term === b.term && a.block === b.block;

/** A handle on the knob's fan. options: its setting, a second fan past the rim; run(null) is its default (let go before the rim). */
type Handle = { label: string; options?: string[]; run: (option: number | null) => void };
const LONG_WORDS = 8; // a highlight longer than this is a passage: keeping and steering it come before looking it up
const MAX_NOTES = 4;

/** The handles for a highlight, in the order they fan out. They follow what is highlighted: one whose live definition failed
    can ask again; a passage leads with Note and Steer live, a term with Explore and Ask; Note's setting is the notes there are. */
function handlesFor(pick: HudPick, shown: Shown, notes: NoteShape[]): Handle[] {
  const levels = Object.keys(LEVEL_LABEL) as TutorLevel[];
  const recent = notes.slice(-MAX_NOTES);
  const nameOf = (n: NoteShape) => (docTopic(n.props.doc) || docPlain(n.props.doc).trim().split(/\s+/).slice(0, 4).join(" ") || "Empty note").slice(0, 24);
  const explore: Handle = { label: "Explore", run: pick.explore };
  const ask: Handle = { label: "Ask", options: levels.map((l) => LEVEL_LABEL[l]), run: (i) => pick.ask(levels[i ?? 0]) };
  const { toNote, newNote, steer: steerLive } = pick;
  const note: Handle | null = !toNote
    ? null
    : recent.length && newNote
      ? { label: "Note", options: [...recent.map(nameOf), "New note"], run: (i) => (i === null ? toNote() : i < recent.length ? toNote(recent[i]) : newNote()) }
      : { label: "Note", run: () => toNote() };
  const steer: Handle | null = steerLive ? { label: "Steer live", run: steerLive } : null;
  const watch: Handle | null = pick.watch ? { label: "▶ Watch", run: pick.watch } : null;
  const isPassage = pick.term.trim().split(/\s+/).length > LONG_WORDS;
  const retry: Handle = { label: "Define", run: () => askAgain() };
  const order = isPassage ? [note, steer, watch, ask, explore] : [explore, ask, watch, note, steer];
  return [...(shown.failed ? [retry] : []), ...order.filter((h): h is Handle => !!h)];
}

const DEAD = 24; // px from the knob: nearer, nothing is chosen
const GATE = 96; // the rim: past it, a handle with a setting opens its second fan
const CLICK_PX = 4;
type Fan = { axis: number; x: number; y: number; chosen: number | null; sticky: boolean };

/** The knob at the lock's foot, and its fan. Pull it out and let go on a handle (a press that doesn't move opens the fan to click
    instead). The fan points down unless there is no room (the lab's axisFor), and spans the lab's swing. */
function Knob({ cx, cy, handles, wrap }: { cx: number; cy: number; handles: Handle[]; wrap: RefObject<HTMLDivElement | null> }) {
  const [fan, setFan] = useState<Fan | null>(null);
  const moved = useRef(false);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  /** How far the pointer is from the knob, and which sector of the current fan it is in (none inside the dead zone). */
  const read = (f: Fan) => {
    const d = Math.hypot(f.x - cx, f.y - cy);
    const turn = Math.atan2(f.x - cx, f.y - cy) - f.axis;
    const swing = Math.atan2(Math.sin(turn), Math.cos(turn));
    const count = f.chosen === null ? handles.length : handles[f.chosen].options!.length;
    return { d, sector: d >= DEAD ? optionIndexAt(count, Math.min(1, Math.max(0, (swing + SWING_RADIANS) / (2 * SWING_RADIANS)))) : null };
  };
  /** The pointer moved: past the rim on a handle with a setting opens its fan; back at the knob closes it again. */
  const track = (f: Fan, p: { x: number; y: number }): Fan => {
    const next = { ...f, ...p };
    const { d, sector } = read(next);
    if (next.chosen === null && sector !== null && d >= GATE && handles[sector].options) next.chosen = sector;
    else if (next.chosen !== null && d < DEAD) next.chosen = null;
    return next;
  };
  const pan = () => (cx / (wrap.current?.clientWidth || 1)) * 2 - 1;
  /** The lab's own sounds for the same moves: entering a sector, carrying the knob through the rim. */
  const move = (f: Fan, p: { x: number; y: number }) => {
    const next = track(f, p);
    const [was, is] = [read(f).sector, read(next).sector];
    if (next.chosen !== f.chosen) {
      if (next.chosen !== null) hudSounds()?.take(pan());
    } else if (is !== null && is !== was) {
      if (next.chosen === null) hudSounds()?.candidate(is, pan());
      else hudSounds()?.sector(is, pan());
    }
    setFan(next);
    return next;
  };
  const fire = (f: Fan) => {
    const { sector } = read(f);
    setFan(null);
    if (sector === null) return void hudSounds()?.knobRelease(pan());
    hudSounds()?.handOff(pan());
    if (f.chosen !== null) handles[f.chosen].run(sector);
    else handles[sector].run(null);
  };
  useEffect(() => {
    if (!fan) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFan(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fan]);

  const at = (a: number, r: number) => `${cx + Math.sin(a) * r} ${cy + Math.cos(a) * r}`;
  const view = fan && read(fan);
  const labels = fan ? (fan.chosen === null ? handles.map((h) => h.label) : handles[fan.chosen].options!) : [];
  const step = (2 * SWING_RADIANS) / Math.max(1, labels.length);
  return (
    <>
      {/* open to click: the whole board is the fan's, so a click anywhere lands on it (or closes it) */}
      {fan?.sticky && (
        <div
          className="hud-knob hud-catch"
          onPointerMove={(e) => move(fan, local(e))}
          onClick={(e) => {
            const f = track(fan, local(e));
            const { sector } = read(f);
            // a handle with a setting, clicked before the rim: open its fan rather than take its default
            if (f.chosen === null && sector !== null && handles[sector].options) setFan({ ...f, chosen: sector });
            else fire(f);
          }}
        />
      )}
      <button
        className="hud-knob hud-dot"
        style={{ left: cx, top: cy }}
        data-open={fan ? "" : undefined}
        aria-label="What to do with this highlight: pull out, or click, for Explore, Ask, Note and Steer live"
        onMouseDown={(e) => e.preventDefault()} // the highlight keeps its selection
        onPointerEnter={(e) => e.buttons || hudSounds()?.knobHover(pan())}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (fan?.sticky) return setFan(null);
          e.currentTarget.setPointerCapture(e.pointerId);
          hudSounds()?.knobGrab(pan());
          moved.current = false;
          const r = wrap.current!.getBoundingClientRect();
          setFan({ axis: axisFor({ x: cx, y: cy }, GATE, { left: 0, top: 0, right: r.width, bottom: r.height }), ...local(e), chosen: null, sticky: false });
        }}
        onPointerMove={(e) => {
          if (!fan || fan.sticky || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const p = local(e);
          if (Math.hypot(p.x - cx, p.y - cy) > CLICK_PX) moved.current = true;
          move(fan, p);
        }}
        onPointerUp={(e) => {
          if (!fan || fan.sticky || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          if (moved.current) fire(track(fan, local(e)));
          else setFan({ ...fan, sticky: true });
        }}
      />
      {fan && view && (
        <svg className="hud-fan" aria-hidden="true">
          <path className="hud-wedge" d={`M${cx} ${cy}L${at(fan.axis - SWING_RADIANS - 0.3, GATE + 84)}A${GATE + 84} ${GATE + 84} 0 0 0 ${at(fan.axis + SWING_RADIANS + 0.3, GATE + 84)}Z`} />
          <circle className="hud-dead" cx={cx} cy={cy} r={DEAD} />
          <path className="hud-rim" d={`M${at(fan.axis - SWING_RADIANS, GATE)}A${GATE} ${GATE} 0 0 0 ${at(fan.axis + SWING_RADIANS, GATE)}`} />
          {labels.slice(1).map((_, i) => {
            const a = fan.axis - SWING_RADIANS + (i + 1) * step;
            return <path key={i} className="hud-rim" d={`M${at(a, GATE - 5)}L${at(a, GATE + 5)}`} />;
          })}
          {view.d >= DEAD && (
            <>
              <line className="hud-link" x1={cx} y1={cy} x2={fan.x} y2={fan.y} />
              <circle className="hud-end" cx={fan.x} cy={fan.y} r={3} />
            </>
          )}
          {fan.chosen !== null && (
            <text className="hud-dim" x={cx + Math.sin(fan.axis) * 46} y={cy + Math.cos(fan.axis) * 46} textAnchor="middle" dominantBaseline="middle">
              {handles[fan.chosen].label}
            </text>
          )}
          {labels.map((label, i) => {
            const a = fan.axis - SWING_RADIANS + (i + 0.5) * step;
            const [sx, sy] = [Math.sin(a), Math.cos(a)];
            const on = view.sector === i;
            const more = fan.chosen === null && on ? handles[i].options : undefined;
            const x = cx + sx * (GATE + 14);
            return (
              <text
                key={label + i}
                className={on ? "hud-on" : undefined}
                x={x}
                y={cy + sy * (GATE + 14)}
                textAnchor={sx > 0.25 ? "start" : sx < -0.25 ? "end" : "middle"}
                dominantBaseline={sy > 0.25 ? "hanging" : sy < -0.25 ? "auto" : "middle"}
              >
                {label}
                {more && (
                  <tspan className="hud-dim" x={x} dy={sy < -0.25 ? -15 : 15}>
                    pull further: {more.join(" / ")}
                  </tspan>
                )}
              </text>
            );
          })}
        </svg>
      )}
    </>
  );
}

/** The HUD over the board. pick: the highlight the canvas is offering actions on, when it is in the lesson (the knob needs it). */
/** One thing on the board, as the rail maps it (the rail is the board's map). */
type Mapped = { id: TLShapeId; kind: string; title: string; y: number; h: number };

/** onGo: bring a thing on the board into view (a tick on the rail). */
export function LessonHud({ editor, pick, notes, onGo }: { editor: Editor; pick: HudPick | null; notes: NoteShape[]; onGo: (id: TLShapeId) => void }) {
  // everything on the board, for the rail: cards, notes, linked pages and labs, by where they stand
  const mapped = useValue(
    "hud map",
    () =>
      editor
        .getCurrentPageShapes()
        .filter((sh) => (sh.type === CARD || sh.type === NOTE || sh.type === LAB || (sh.type === DOC && sh.id !== LESSON_ID)) && !editor.isShapeHidden(sh) && !sh.meta.dock)
        .map((sh): Mapped => {
          const b = editor.getShapePageBounds(sh.id)!;
          const p = sh.props as { term?: string; title?: string; topic?: string; doc?: Parameters<typeof docPlain>[0] };
          const title = p.term ?? p.title ?? p.topic ?? (p.doc ? docTopic(p.doc) || docPlain(p.doc).trim().slice(0, 40) || "Note" : "");
          return { id: sh.id, kind: sh.type === CARD ? "card" : sh.type === NOTE ? "note" : sh.type === LAB ? "lab" : "page", title, y: b.y, h: b.h };
        }),
    [editor],
  );
  const g = useSyncExternalStore(subscribe, gloss, gloss);
  const zoom = useValue("hud camera", () => editor.getCamera(), [editor]).z; // every move of the board draws it again, where things now are
  const wrap = useRef<HTMLDivElement>(null);
  // a readout under the pointer lights its lock up again (the readouts take no pointer events: the board keeps its wheel and drags)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return;
      // one cut away under a frame is pointed at by its words, not through the frame over it
      const el = Array.from(document.querySelectorAll<HTMLElement>(".hud-read[data-k]")).find((el) => {
        if (el.style.clipPath) return false;
        const r = el.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      const k = (el && gloss().kept.find((k) => idOf(k) === el.dataset.k)) ?? null;
      setHover(k);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // the frames and readouts overlap as liquid (components/canvas/liquid.ts); a readout for a new highlight comes to the top
  useEffect(() => {
    const root = wrap.current?.parentElement;
    return root ? startLiquid(editor, root) : undefined;
  }, [editor]);
  // the same for a kept one when its words or its readout are pointed at: what you are reading comes up from under a frame
  const shownKey = g.shown ? idOf(g.shown) : "";
  const hoverKey = g.hover ? idOf(g.hover) : "";
  useEffect(() => void (shownKey && liquidTouch(`r:${shownKey}`)), [shownKey]);
  useEffect(() => void (hoverKey && liquidTouch(`r:${hoverKey}`)), [hoverKey]);

  const lesson = editor.getShape(LESSON_ID);
  const bounds = editor.getShapePageBounds(LESSON_ID);
  if (!lesson || !bounds) return null;
  const shown = g.shown;
  const pad = 3 * zoom;
  const arm = Math.max(4, 6 * zoom);

  // Each definition, where its words stand on the board: in the lesson, a linked page (both frames: their own coordinates, the
  // frame's top-left on the board) or a card (the board's own page: its screen position).
  const notesNow = [...g.kept.map((k) => ({ ...k, none: false })), ...(shown && !g.kept.some((k) => same(shown, k)) ? [shown] : [])].flatMap((n) => {
    const src = editor.getShape(n.source as TLShapeId);
    const sb = src && editor.getShapePageBounds(src.id);
    if (!src || !sb || editor.isShapeHidden(src) || (src.type === DOC && (src.props as { collapsed?: boolean }).collapsed) || !n.lock.startContainer.isConnected) return [];
    const r = n.lock.getBoundingClientRect();
    if (!r.width && !r.height) return [];
    let at: { x: number; y: number; w: number; h: number };
    const kind = sourceOf(n.source)?.kind;
    if (kind === "card" || kind === "note") {
      const p0 = editor.screenToPage({ x: r.left, y: r.top });
      const p1 = editor.screenToPage({ x: r.right, y: r.bottom });
      at = { x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y };
    } else at = { x: src.x + r.left, y: src.y + ((src.props as { role?: string }).role === "page" ? BAR_H : 0) + r.top, w: r.width, h: r.height };
    const a = editor.pageToViewport(at);
    const box = [a.x - pad, a.y - pad, a.x + at.w * zoom + pad, a.y + at.h * zoom + pad];
    return [{ ...n, id: idOf(n), on: same(shown, n) || same(g.hover, n), at, sb, box }];
  }).sort((a, b) => a.at.y - b.at.y);

  // Where each readout goes: in the margin right of its source if nothing stands there, else in its left margin, else in the right
  // margin all the same, over whatever stands there: the liquid layering (components/canvas/liquid.ts) shows the one touched last
  // and dents the other round it, so a readout is never hidden for want of room. Readouts on a side stack down it, never over each
  // other. Cards and notes beside the lesson open past its right margin (LANE_GUTTER), so the lesson's definitions stand there.
  const taken = editor
    .getCurrentPageShapes()
    .filter((sh) => [CARD, NOTE, DOC, LAB].includes(sh.type) && !editor.isShapeHidden(sh))
    .map((sh) => ({ id: sh.id, b: editor.getShapePageBounds(sh.id)! }));
  const vp = editor.getViewportPageBounds();
  const placedBoxes: { x: number; y: number; w: number; h: number }[] = [];
  const floors = new Map<string, number>();
  const placed = notesNow.map((n) => {
    const h = 22 + (n.none ? 18 : 18 * Math.ceil(n.def.length / 38));
    const free = (x: number, y: number, w: number) =>
      !taken.some(({ id, b }) => id !== n.source && b.minX < x + w && b.maxX > x && b.minY < y + h && b.maxY > y) &&
      !placedBoxes.some((q) => q.x < x + w && q.x + q.w > x && q.y < y + h && q.y + q.h > y);
    const spot = (s: "right" | "left") => ({
      x: s === "right" ? n.sb.maxX + 26 : n.sb.minX - 26 - READ_W,
      top: Math.max(n.at.y - 2, floors.get(`${n.source}:${s}`) ?? -Infinity),
    });
    // a margin off the screen is no room: the readout would be lost there
    const side = (["right", "left"] as const).find((s) => { const { x, top } = spot(s); return x >= vp.minX && x + READ_W <= vp.maxX && free(x, top, READ_W); }) ?? "right";
    const { x, top } = spot(side);
    floors.set(`${n.source}:${side}`, top + h + 10);
    // no readout: a miss that hasn't rested yet (nothing to say)
    const covered = n.none && !isPending(n) && !hasFailed(n);
    if (!covered) placedBoxes.push({ x, y: top, w: READ_W, h });
    return { ...n, side, x, top, w: READ_W, covered };
  });

  // the rail maps the board top to bottom: the lesson and everything on the board
  const railTop = Math.min(bounds.y, ...mapped.map((m) => m.y));
  const railBottom = Math.max(bounds.maxY, ...mapped.map((m) => m.y + m.h));
  const rel = (y: number) => Math.min(1, Math.max(0, (y - railTop) / Math.max(1, railBottom - railTop)));
  const defined = new Set(g.kept.map((k) => k.term)).size;
  const live = shown && placed.find((n) => same(shown, n));

  return (
    <div className="hud-layer" ref={wrap}>
      <svg aria-hidden="true">
        {placed.map((n) => {
          const [x0, y0, x1, y1] = n.box;
          const tl = `M${x0} ${y0 + arm}V${y0}H${x0 + arm}`;
          const br = `M${x1} ${y1 - arm}V${y1}H${x1 - arm}`;
          const rest = `M${x1 - arm} ${y0}H${x1}V${y0 + arm}M${x0 + arm} ${y1}H${x0}V${y1 - arm}`;
          // the tether leaves the lock's foot on the readout's side and runs under the line to the margin, never through its words
          const ry = editor.pageToViewport({ x: 0, y: n.top }).y + 10 * zoom;
          const tether =
            n.side === "right"
              ? `M${x1} ${y1}H${editor.pageToViewport({ x: n.sb.maxX + 12, y: 0 }).x}V${ry}H${editor.pageToViewport({ x: n.x, y: 0 }).x}`
              : `M${x0} ${y1}H${editor.pageToViewport({ x: n.sb.minX - 12, y: 0 }).x}V${ry}H${editor.pageToViewport({ x: n.x + n.w, y: 0 }).x}`;
          return (
            <g key={n.id}>
              {/* the live lock closes all four corners; a kept one holds its two defining corners */}
              <path className={`hud-lock${n.none ? (isPending(n) ? " hud-seek" : " hud-miss") : n.on ? " hud-on" : ""}`} d={n.on || n.none ? tl + br + rest : tl + br} />
              {tether && n.on && !n.none && !n.covered && <path className="hud-tether" pathLength={1} d={tether} />}
              {tether && isPending(n) && <path className="hud-flow" d={tether} />}
            </g>
          );
        })}
      </svg>
      {placed.filter((n) => !n.covered).map((n) => {
        const at = editor.pageToViewport({ x: n.x, y: n.top });
        return (
          <div
            key={n.id}
            data-k={n.none ? undefined : n.id}
            data-lq={n.id}
            className={`hud-read hud-${n.side}${n.none ? (isPending(n) ? " hud-on hud-wait" : " hud-miss") : n.on ? " hud-on" : ""}`}
            style={{ left: at.x, top: at.y, width: n.w, transform: `scale(${zoom})` }}
          >
            {n.none && isPending(n) ? (
              <>
                <div className="hud-head">
                  <span>{n.term}</span>
                </div>
                <div className="hud-scan" />
              </>
            ) : n.none ? (
              "No definition came back. Pull the knob to ask again."
            ) : (
              <>
                <div className="hud-head">
                  <span>{n.term}</span>
                  {same(shown, n) && !shown?.asked && <span className="hud-ms">{g.lookupMs.toFixed(2)} ms</span>}
                </div>
                <div className="hud-def">{n.def}</div>
              </>
            )}
          </div>
        );
      })}
      {/* the knob: once a highlight is let go, it stands where the bar's buttons would */}
      {pick && shown && live && <Knob cx={live.box[2]} cy={live.box[3]} handles={handlesFor(pick, shown, notes)} wrap={wrap} />}
      {/* the rail: the board top to bottom, where you are in it, a mark for each thing on it and a tick for each definition */}
      <div className="hud-rail">
        <i className="hud-win" style={{ top: `${rel(vp.y) * 100}%`, height: `${(rel(vp.maxY) - rel(vp.y)) * 100}%` }} />
        {mapped.map((m) => (
          <button
            key={m.id}
            className={`hud-thing hud-k-${m.kind}`}
            style={{ top: `${rel(m.y) * 100}%`, height: `max(4px, ${(rel(m.y + m.h) - rel(m.y)) * 100}%)` }}
            title={m.title}
            aria-label={`Go to ${m.title}`}
            onClick={() => onGo(m.id)}
          />
        ))}
        {placed
          .filter((n) => !n.none)
          .map((n) => (
            <button
              key={n.id}
              className={`hud-tick${n.on ? " hud-on" : ""}`}
              style={{ top: `${rel(n.at.y) * 100}%` }}
              title={n.term}
              aria-label={`Go to ${n.term}`}
              onClick={() => editor.centerOnPoint({ x: n.at.x + n.at.w / 2, y: n.at.y }, { animation: { duration: 350 } })}
            />
          ))}
        <div className="hud-foot">
          <span>{g.status === "ready" ? `${defined} of ${g.terms} terms` : g.status === "failed" ? "no glossary: defined live" : "writing this lesson's definitions…"}</span>
          <span>
            <button onClick={toggleSound} aria-pressed={soundOn()} title="The HUD's sounds">
              ♪ {soundOn() ? "on" : "off"}
            </button>
            {g.kept.length > 0 && (
              <button onClick={clearKept} title="Take the kept definitions off the page">
                clear
              </button>
            )}
          </span>
        </div>
      </div>
      {g.toast && <div className="hud-toast">{g.toast}</div>}
    </div>
  );
}
