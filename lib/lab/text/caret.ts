import type { Point } from "../point"

export type Caret = { line: number; x: number }

/** Page position of the text's first line box, left edge and top, and its line height. */
export type TextMetrics = { left: number; top: number; lineHeight: number }

export function caretAt({ x, y }: Point, { left, top, lineHeight }: TextMetrics): Caret {
  return { line: Math.floor((y - top) / lineHeight), x: x - left }
}

/** The page point of `caret`, at its line's middle. */
export function pointAt({ line, x }: Caret, { left, top, lineHeight }: TextMetrics): Point {
  return { x: left + x, y: top + (line + 0.5) * lineHeight }
}

export function isAhead(next: Caret, previous: Caret) {
  return next.line > previous.line || (next.line === previous.line && next.x > previous.x)
}
