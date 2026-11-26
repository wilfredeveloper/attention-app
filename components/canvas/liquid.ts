// The board's frames (cards, notes, the docked note, linked pages, the lab) and the HUD's readouts overlap as liquid, not as
// rectangles crossing. Whatever was touched last is on top, and:
//
//   - it presses into everything under it: their edge flows round it with a meniscus (a smooth subtraction of signed distance
//     fields), their contents are cut to that edge, and the dent trails it on a spring, overshoots, and springs back when it leaves;
//   - every border is a liquid surface (a damped wave along it): dragging a frame sloshes its edges, something sliding along
//     another sends waves down both, and what comes to the top rings once.
//
// "Touched" is a press on a frame, or a readout appearing for a new highlight; a readout is not a board shape, so this keeps the
// order itself rather than reading tldraw's. Layering is done by clipping, so it holds across the board and the HUD's layer.
// Anything off the board joins by carrying data-lq (its key) like a readout: data-lq-radius gives its corner, and data-lq-top keeps
// it above everything whatever is touched (the chat sheet, which the board's frames flow round as it rises and leaves).
// A frame with nothing near it and a still surface is left exactly as its own CSS draws it.
//
// Everything is in screen px. Each frame's contour is applied in its shape's own coordinates (its scale read off the page).

import type { Editor } from "tldraw";

type Box = { x: number; y: number; w: number; h: number };
type Body = {
  key: string;
  el: HTMLElement; // what is clipped: a shape's html container, or a readout
  frame: boolean;
  box: Box;
  r: number; // corner radius
  rank: number;
  gx: number; gy: number; gvx: number; gvy: number; // the ghost: where it presses from, trailing it on a spring
  px: number; py: number; vx: number; vy: number; // last position and velocity
  u: Float32Array; v: Float32Array; // the surface wave, round the perimeter
  fill: string; stroke: string; width: number; // a frame's own looks, read before its border is hidden
  under?: SVGPathElement; over?: SVGPathElement;
  on: boolean;
  seen: number;
};

const R_FRAME = 14, R_READ = 4;
const GAP = 12, KNEE = 26; // how far a dent stands off what makes it, and how round its meniscus is
const CELL = 4; // contour grid, px
const STEP = 6; // surface samples, px apart
const GHOST_K = 170, GHOST_D = 14; // underdamped: the dent overshoots a little, then settles
const WAVE_C2 = 240 * 240, WAVE_K = 40, WAVE_D = 4.5, MAX_U = 7;
const SLOSH = 0.0035, CONTACT = 2.4, BAND = 10, RING = 120, QUIET = 0.08;
const FRAMES = ".cv-card, .cv-note, .cv-doc-frame, .cv-lab-body";
const PARTS = ".cv-card, .cv-note, .cv-doc-frame, .fr-bar.fr-page, .cv-lab-bar, .cv-lab-body";
const SVG = "http://www.w3.org/2000/svg";

const bodies = new Map<string, Body>();
let rank = 0;

/** Bring something to the top: a frame by its shape id, a readout as "r:" + its id (LessonHud). */
export function liquidTouch(key: string) {
  const b = bodies.get(key);
  if (b && b.rank === rank) return;
  rank++;
  if (b) {
    b.rank = rank;
    ring(b);
  }
  ranks.set(key, rank);
}
/** Where each thing stands in the order, kept apart from its body: a readout that drops out for a moment (its highlight let go,
    then kept) comes back where it stood, not on top. */
const ranks = new Map<string, number>();

// ---- geometry ----
function sd(px: number, py: number, b: Box, r: number) {
  const qx = Math.abs(px - (b.x + b.w / 2)) - b.w / 2 + r;
  const qy = Math.abs(py - (b.y + b.h / 2)) - b.h / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function smax(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}
const near = (a: Box, b: Box, m: number) => a.x - m < b.x + b.w && b.x - m < a.x + a.w && a.y - m < b.y + b.h && b.y - m < a.y + a.h;

/** Where round the perimeter (0..1) a point is nearest: top, right, bottom, left, clockwise. */
function along(px: number, py: number, b: Box) {
  const lx = Math.min(b.w, Math.max(0, px - b.x)), ly = Math.min(b.h, Math.max(0, py - b.y));
  const L = 2 * (b.w + b.h);
  const m = Math.min(ly, b.w - lx, b.h - ly, lx);
  const t = m === ly ? lx : m === b.w - lx ? b.w + ly : m === b.h - ly ? b.w + b.h + (b.w - lx) : 2 * b.w + b.h + (b.h - ly);
  return t / L;
}
/** The point and outward normal at a place round the perimeter. */
function at(t: number, b: Box) {
  let s = (((t % 1) + 1) % 1) * 2 * (b.w + b.h);
  if (s < b.w) return { x: b.x + s, y: b.y, nx: 0, ny: -1 };
  s -= b.w;
  if (s < b.h) return { x: b.x + b.w, y: b.y + s, nx: 1, ny: 0 };
  s -= b.h;
  if (s < b.w) return { x: b.x + b.w - s, y: b.y + b.h, nx: 0, ny: 1 };
  s -= b.w;
  return { x: b.x, y: b.y + b.h - s, nx: -1, ny: 0 };
}

/** The zero contour of f over a box, as path data mapped by `map` (marching squares, loops chained). */
function contour(b: Box, f: (x: number, y: number) => number, map: (x: number, y: number) => string) {
  const cols = Math.ceil(b.w / CELL), rows = Math.ceil(b.h / CELL), W = cols + 1;
  const v = new Float32Array(W * (rows + 1));
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) v[j * W + i] = f(b.x + i * CELL, b.y + j * CELL);
  const V = (i: number, j: number) => v[j * W + i];
  const pos = new Map<number, [number, number]>();
  // an edge of the grid, by number: horizontal ones first, then vertical
  const H = (i: number, j: number) => j * cols + i, Vt = (i: number, j: number) => cols * (rows + 1) + j * W + i;
  const E = (k: number, i: number, j: number, horiz: boolean) => {
    if (!pos.has(k)) {
      const a = V(i, j), c = horiz ? V(i + 1, j) : V(i, j + 1), t = a / (a - c);
      pos.set(k, horiz ? [b.x + (i + t) * CELL, b.y + j * CELL] : [b.x + i * CELL, b.y + (j + t) * CELL]);
    }
    return k;
  };
  const adj = new Map<number, number[]>();
  const link = (p: number, q: number) => {
    (adj.get(p) ?? adj.set(p, []).get(p)!).push(q);
    (adj.get(q) ?? adj.set(q, []).get(q)!).push(p);
  };
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = V(i, j), bb = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
      const idx = (a < 0 ? 8 : 0) | (bb < 0 ? 4 : 0) | (c < 0 ? 2 : 0) | (d < 0 ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = () => E(H(i, j), i, j, true), Rt = () => E(Vt(i + 1, j), i + 1, j, false);
      const B = () => E(H(i, j + 1), i, j + 1, true), L = () => E(Vt(i, j), i, j, false);
      const mid = (a + bb + c + d) / 4 < 0;
      switch (idx) {
        case 1: case 14: link(L(), B()); break;
        case 2: case 13: link(B(), Rt()); break;
        case 3: case 12: link(L(), Rt()); break;
        case 4: case 11: link(T(), Rt()); break;
        case 6: case 9: link(T(), B()); break;
        case 7: case 8: link(T(), L()); break;
        case 5: if (mid) { link(T(), L()); link(B(), Rt()); } else { link(T(), Rt()); link(L(), B()); } break;
        case 10: if (mid) { link(T(), Rt()); link(L(), B()); } else { link(T(), L()); link(B(), Rt()); } break;
      }
    }
  const seen = new Set<number>();
  let path = "";
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    let prev = -1, cur = start;
    const loop: string[] = [];
    while (cur >= 0 && !seen.has(cur)) {
      seen.add(cur);
      const [x, y] = pos.get(cur)!;
      loop.push(map(x, y));
      const nx = (adj.get(cur) ?? []).find((n) => n !== prev && !seen.has(n));
      prev = cur;
      cur = nx ?? -1;
    }
    if (loop.length > 2) path += "M" + loop.join("L") + "Z";
  }
  return path;
}

// ---- the bodies ----
function union(els: Element[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
  }
  return x1 > x0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function bodyFor(key: string, el: HTMLElement, frame: boolean, box: Box, now: number): Body {
  let b = bodies.get(key);
  if (!b || b.el !== el) {
    if (b) release(b);
    const main = frame ? (el.querySelector(FRAMES) as HTMLElement | null) : null;
    const cs = main ? getComputedStyle(main) : null;
    b = {
      key, el, frame, box, r: frame ? R_FRAME : Number(el.dataset.lqRadius) || R_READ,
      rank: el.hasAttribute("data-lq-top") ? Infinity : ranks.get(key) ?? ++rank,
      gx: box.x, gy: box.y, gvx: 0, gvy: 0, px: box.x, py: box.y, vx: 0, vy: 0,
      u: new Float32Array(0), v: new Float32Array(0),
      fill: cs?.backgroundColor || "transparent", stroke: cs?.borderTopColor || "currentColor", width: parseFloat(cs?.borderTopWidth || "2") || 2,
      on: false, seen: now,
    };
    ranks.set(key, b.rank);
    bodies.set(key, b);
  }
  const n = Math.max(8, Math.round((2 * (box.w + box.h)) / STEP));
  if (b.u.length !== n) {
    b.u = new Float32Array(n);
    b.v = new Float32Array(n);
  }
  b.box = box;
  b.seen = now;
  return b;
}

function ring(b: Body) {
  for (const o of bodies.values()) {
    if (o === b || !near(b.box, o.box, BAND * 2)) continue;
    for (let i = 0; i < b.u.length; i++) {
      const p = at(i / b.u.length, b.box);
      if (Math.abs(sd(p.x, p.y, o.box, o.r)) < BAND * 2) b.v[i] += RING;
    }
  }
}

/** Back to its own CSS. */
function release(b: Body) {
  b.on = false;
  b.el.style.clipPath = "";
  b.el.removeAttribute("data-liquid");
  b.under?.parentElement?.remove();
  b.over?.parentElement?.remove();
  b.under = b.over = undefined;
}

function paths(b: Body) {
  if (!b.under) {
    const mk = (cls: string) => {
      const svg = document.createElementNS(SVG, "svg");
      svg.setAttribute("class", `lq-svg ${cls}`);
      const p = document.createElementNS(SVG, "path");
      p.setAttribute("fill-rule", "evenodd");
      svg.append(p);
      return { svg, p };
    };
    const u = mk("lq-under"), o = mk("lq-over");
    u.p.setAttribute("fill", b.fill);
    o.p.setAttribute("fill", "none");
    o.p.setAttribute("stroke", b.stroke);
    o.p.setAttribute("stroke-width", String(b.width * 2)); // half of it is cut off by the clip: the edge keeps its own width
    b.el.prepend(u.svg);
    b.el.append(o.svg);
    b.under = u.p;
    b.over = o.p;
  }
  return [b.under, b.over!] as const;
}

// ---- each frame ----
function step(dt: number, dragging: Set<string>) {
  const all = [...bodies.values()];
  for (const b of all) {
    const vx = (b.box.x - b.px) / dt, vy = (b.box.y - b.py) / dt;
    const ax = (vx - b.vx) / dt, ay = (vy - b.vy) / dt;
    b.vx = vx; b.vy = vy; b.px = b.box.x; b.py = b.box.y;
    for (let s = 0, h = dt / 4; s < 4; s++) {
      b.gvx += (GHOST_K * (b.box.x - b.gx) - GHOST_D * b.gvx) * h; b.gx += b.gvx * h;
      b.gvy += (GHOST_K * (b.box.y - b.gy) - GHOST_D * b.gvy) * h; b.gy += b.gvy * h;
    }
    if (!b.frame) continue; // a readout has no border of its own to ripple
    const n = b.u.length, ds = (2 * (b.box.w + b.box.h)) / n, force = new Float32Array(n);
    const slosh = dragging.has(b.key);
    const others = all.filter((o) => o !== b && near(b.box, o.box, BAND));
    if (slosh || others.length)
      for (let i = 0; i < n; i++) {
        const p = at(i / n, b.box);
        if (slosh) force[i] -= SLOSH * (ax * p.nx + ay * p.ny);
        for (const o of others) {
          const d = Math.abs(sd(p.x, p.y, o.box, o.r));
          if (d < BAND) force[i] += CONTACT * ((o.vx - b.vx) * p.nx + (o.vy - b.vy) * p.ny) * (1 - d / BAND);
        }
      }
    for (let s = 0, h = dt / 8; s < 8; s++) {
      for (let i = 0; i < n; i++) {
        const lap = b.u[(i + n - 1) % n] + b.u[(i + 1) % n] - 2 * b.u[i];
        b.v[i] += ((WAVE_C2 * lap) / (ds * ds) - WAVE_K * b.u[i] - WAVE_D * b.v[i] + force[i]) * h;
      }
      for (let i = 0; i < n; i++) b.u[i] = Math.max(-MAX_U, Math.min(MAX_U, b.u[i] + b.v[i] * h));
    }
  }
}

function draw(b: Body) {
  const above = [...bodies.values()].filter((o) => o.rank > b.rank && near(b.box, { x: o.gx, y: o.gy, w: o.box.w, h: o.box.h }, GAP + KNEE));
  let moving = false;
  for (let i = 0; i < b.u.length; i++) if (Math.abs(b.u[i]) > QUIET) { moving = true; break; }
  if (!above.length && !moving) return b.on && release(b);
  // the shape's own coordinates: its box on the screen, and how much the screen scales it
  const er = b.el.getBoundingClientRect();
  const s = b.el.offsetWidth ? er.width / b.el.offsetWidth : 1;
  if (!s) return;
  const n = b.u.length;
  const f = (x: number, y: number) => {
    const t = along(x, y, b.box) * n;
    const i = Math.floor(t), k = t - i;
    let d = sd(x, y, b.box, b.r) - (n ? b.u[i % n] * (1 - k) + b.u[(i + 1) % n] * k : 0);
    for (const o of above) d = smax(d, -(sd(x, y, { x: o.gx, y: o.gy, w: o.box.w, h: o.box.h }, o.r) - GAP), KNEE);
    return d;
  };
  const pad = MAX_U + CELL;
  const local = contour({ x: b.box.x - pad, y: b.box.y - pad, w: b.box.w + 2 * pad, h: b.box.h + 2 * pad }, f, (x, y) =>
    `${((x - er.left) / s).toFixed(1)} ${((y - er.top) / s).toFixed(1)}`,
  );
  b.on = true;
  b.el.style.clipPath = `path(evenodd, "${local || "M0 0Z"}")`;
  if (!b.frame) return;
  b.el.setAttribute("data-liquid", "");
  const [under, over] = paths(b);
  under.setAttribute("d", local);
  over.setAttribute("d", local);
}

/** Run the liquid over the board while the HUD is up. */
export function startLiquid(editor: Editor, root: HTMLElement) {
  let raf = 0, last = performance.now(), top = "";
  // a press on a frame brings it up. tldraw takes presses on its own canvas, not on the shapes, so the frame is found by where
  // the press is: the highest one there is the one showing there (those under it are cut away round it)
  const press = (e: PointerEvent) => {
    if ((e.target as Element | null)?.closest?.(".hud-layer")) return; // the HUD's knob and fan are not the frame under them
    let hit: Body | undefined;
    for (const b of bodies.values())
      if (b.frame && sd(e.clientX, e.clientY, b.box, b.r) <= 0 && (!hit || b.rank > hit.rank)) hit = b;
    if (hit) liquidTouch(hit.key);
  };
  root.ownerDocument.addEventListener("pointerdown", press, true);
  const frame = (t: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(1 / 30, Math.max(1 / 240, (t - last) / 1000));
    last = t;
    // the frames on the board (met in the board's own order, so one first seen ranks as it stands), and the readouts in the HUD's layer
    const sorted = editor.getCurrentPageShapesSorted();
    for (const sh of sorted) {
      const el = root.querySelector<HTMLElement>(`.tl-shape[data-shape-id="${sh.id}"]:not(.tl-shape-background) > .tl-html-container`);
      if (!el || el.classList.contains("cv-doc-lesson") || !el.querySelector(FRAMES)) continue;
      const box = union([...el.querySelectorAll(PARTS)]);
      if (box) bodyFor(sh.id, el, true, box, t);
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-lq]")) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) bodyFor(`r:${el.dataset.lq}`, el, false, { x: r.left, y: r.top, w: r.width, h: r.height }, t);
    }
    for (const b of [...bodies.values()])
      if (b.seen !== t || !b.el.isConnected) {
        release(b);
        bodies.delete(b.key);
      }
    // what the board brought to the front (a new frame, a frame sent there) is on top here too
    const now = sorted.filter((sh) => bodies.has(sh.id)).at(-1)?.id ?? "";
    if (now && now !== top) {
      if (top) liquidTouch(now);
      top = now;
    }
    const dragging = new Set<string>(editor.isIn("select.translating") ? editor.getSelectedShapeIds() : []);
    step(dt, dragging);
    for (const b of bodies.values()) draw(b);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    root.ownerDocument.removeEventListener("pointerdown", press, true);
    for (const b of bodies.values()) release(b);
    bodies.clear();
    ranks.clear();
  };
}
