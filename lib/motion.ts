// Motion for a "watch it" video (lib/watch.ts): the model draws one still SVG frame per scene, and
// this turns the cut from frame to frame into movement, as a function of time.
//   - A part (a direct child of the <svg>) with the same id in the next frame glides and morphs to
//     its new place, size, colour and text.
//   - A part that is new builds itself in when the narration reaches it (its data-on word): a line
//     draws on, a shape or a group grows in, text rises in.
//   - A part the next frame leaves out fades away.
// `stage` returns the drawing and a `seek(t)` that sets it to how it looks t seconds into the scene.
// The card drives seek from the voice's clock, so picture and voice can't drift, and the same call
// can draw any frame for a rendered file. The model only has to draw stills with steady ids: the
// easing and the timing are here, the same for every video.
//
// mix, cueTimes and the easings are pure (tested in lib/motion.test.mjs); stage works on the DOM.

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const hex = (c: string): number[] | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

/** An attribute's value part of the way (k: 0..1) from a to b: colours and the numbers in anything
    with the same shape (a length, a point list, a path, a transform) blend; anything else switches halfway. */
export function mix(a: string, b: string, k: number): string {
  if (k <= 0 || a === b) return a;
  if (k >= 1) return b;
  const ca = hex(a);
  const cb = hex(b);
  if (ca && cb) return `#${ca.map((x, i) => Math.round(x + (cb[i] - x) * k).toString(16).padStart(2, "0")).join("")}`;
  const na = a.match(NUM);
  const nb = b.match(NUM);
  if (!ca && !cb && na && nb && na.length === nb.length && a.replace(NUM, "#") === b.replace(NUM, "#")) {
    let i = 0;
    return a.replace(NUM, () => {
      const x = Number(na[i]);
      const y = Number(nb[i++]);
      return String(Math.round((x + (y - x) * k) * 100) / 100);
    });
  }
  return k < 0.5 ? a : b;
}

const PLAIN_NUMBER = /^\s*-?\d+(\.\d+)?\s*$/;
/** A number on its way from a to b, written with as many decimals as the one it is going to. */
export function count(a: string, b: string, k: number): string {
  if (k >= 1) return b;
  const places = (b.split(".")[1] ?? "").trim().length;
  return (Number(a) + (Number(b) - Number(a)) * k).toFixed(places);
}

export const BUILD = 0.55; // seconds a new part takes to build in
const MOVE = 0.9; // seconds the parts that stay take to reach their new state
const LEAVE = 0.35; // seconds a part that goes takes to fade

/** When each new part starts to build in, in seconds from the scene's start. A part with a cue (a
    word of the narration) comes in just before that word is spoken, taking speech as even over the
    text; one without takes its turn in drawing order. All have finished before the scene ends. */
export function cueTimes(narration: string, cues: (string | null)[], dur: number): number[] {
  const text = narration.toLowerCase();
  const last = Math.max(0.15, dur - BUILD - 0.3);
  return cues.map((cue, i) => {
    const at = cue ? text.indexOf(cue.trim().toLowerCase()) : -1;
    const frac = at >= 0 && text.length ? at / text.length : ((i + 1) / (cues.length + 1)) * 0.8;
    return Math.min(last, Math.max(0.15, frac * dur - 0.2));
  });
}

// ---- the DOM part ----

type Track = (t: number) => void;
const DEFAULTS: Record<string, string> = { opacity: "1", "fill-opacity": "1", "stroke-opacity": "1" };
const isBackdrop = (el: Element) => el.tagName.toLowerCase() === "rect" && Number(el.getAttribute("width")) >= 600 && Number(el.getAttribute("height")) >= 380;
/** The parts of a frame: the svg's direct children, but for its definitions and its backdrop. */
const partsOf = (svg: Element) => [...svg.children].filter((el) => el.tagName.toLowerCase() !== "defs" && !isBackdrop(el)) as SVGElement[];

/** The changes that take `a` to `b` (the same part in two frames), as functions of k: 0..1, each
    setting `b`. False if the two aren't built alike (then one fades into the other instead). */
function morph(a: Element, b: Element, out: ((k: number) => void)[]): boolean {
  if (a.tagName !== b.tagName || a.children.length !== b.children.length) return false;
  for (const name of new Set([...a.getAttributeNames(), ...b.getAttributeNames()])) {
    if (name === "id" || name === "style" || name.startsWith("data-")) continue;
    const va = a.getAttribute(name) ?? DEFAULTS[name];
    const vb = b.getAttribute(name) ?? DEFAULTS[name];
    if (va === undefined || vb === undefined || va === vb) continue;
    out.push((k) => b.setAttribute(name, mix(va, vb, k)));
  }
  if (!a.children.length) {
    const ta = a.textContent ?? "";
    const tb = b.textContent ?? "";
    // a number counts to its new value
    if (ta !== tb && PLAIN_NUMBER.test(ta) && PLAIN_NUMBER.test(tb)) out.push((k) => (b.textContent = count(ta, tb, k)));
    // changed words: the old ones fade out, then the new ones fade in
    else if (ta !== tb)
      out.push((k) => {
        b.textContent = k < 0.5 ? ta : tb;
        (b as SVGElement).style.opacity = String(Math.abs(2 * k - 1));
      });
    return true;
  }
  for (let i = 0; i < a.children.length; i++) if (!morph(a.children[i], b.children[i], out)) return false;
  return true;
}

const STROKES = new Set(["line", "path", "polyline"]);
/** A bare stroke (a line, an arrow, a curve): it can draw itself on. */
const isStroke = (el: Element) => {
  const tag = el.tagName.toLowerCase();
  const fill = el.getAttribute("fill");
  return STROKES.has(tag) && (tag === "line" || !fill || fill === "none") && !el.hasAttribute("stroke-dasharray");
};

/** A new part's way in, from `at` seconds. */
function build(el: SVGElement, at: number): Track {
  const tag = el.tagName.toLowerCase();
  if (isStroke(el)) {
    el.setAttribute("pathLength", "1");
    el.setAttribute("stroke-dasharray", "1");
    return (t) => {
      const k = easeInOut(clamp01((t - at) / (BUILD + 0.15)));
      el.setAttribute("stroke-dashoffset", String(1 - k));
      el.style.opacity = String(clamp01(k * 5)); // an arrowhead isn't shown before its line starts
    };
  }
  if (tag === "text")
    return (t) => {
      const k = easeOut(clamp01((t - at) / BUILD));
      el.style.opacity = String(k);
      el.style.translate = `0 ${(1 - k) * 8}px`;
    };
  el.style.transformBox = "fill-box";
  el.style.transformOrigin = "center";
  return (t) => {
    const k = easeOut(clamp01((t - at) / BUILD));
    el.style.opacity = String(k);
    el.style.scale = String(0.9 + 0.1 * k);
  };
}

/** A scene as a drawing that moves: from how the frame before it ended (prev; null for the first
    scene) to its own frame, over `dur` seconds of narration. The frames are not changed. */
export function stage(prev: SVGSVGElement | null, next: SVGSVGElement, narration: string, dur: number): { svg: SVGSVGElement; seek: (t: number) => void } {
  const svg = next.cloneNode(true) as SVGSVGElement;
  const tracks: Track[] = [];
  const move = (t: number) => easeInOut(clamp01(t / Math.min(MOVE, dur * 0.5)));
  const before = new Map<string, SVGElement>();
  for (const el of prev ? partsOf(prev) : []) if (el.id) before.set(el.id, el);
  const fresh: SVGElement[] = [];
  const first = partsOf(svg)[0] ?? null;

  /** A part of the frame before, fading away where it was. */
  const ghost = (old: SVGElement, beforeEl: Element | null, secs: number) => {
    const g = old.cloneNode(true) as SVGElement;
    g.removeAttribute("id");
    svg.insertBefore(g, beforeEl);
    tracks.push((t) => {
      const k = clamp01(t / secs);
      g.style.opacity = String(1 - k);
      g.style.display = k >= 1 ? "none" : "";
    });
  };

  for (const el of partsOf(svg)) {
    const old = el.id ? before.get(el.id) : undefined;
    if (!old) {
      fresh.push(el);
      continue;
    }
    before.delete(el.id);
    const steps: ((k: number) => void)[] = [];
    if (morph(old, el, steps)) tracks.push((t) => steps.forEach((f) => f(move(t))));
    else {
      // the same part, built differently: one fades into the other
      ghost(old, el, MOVE);
      tracks.push((t) => (el.style.opacity = String(move(t))));
    }
  }
  for (const old of before.values()) ghost(old, first, LEAVE);
  const at = cueTimes(narration, fresh.map((el) => el.getAttribute("data-on")), dur);
  fresh.forEach((el, i) => tracks.push(build(el, at[i])));

  return { svg, seek: (t) => tracks.forEach((f) => f(t)) };
}
