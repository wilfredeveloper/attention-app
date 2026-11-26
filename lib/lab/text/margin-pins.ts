import type { Point } from "../point"

/** Space between the column, a knob, its label and the page edge; and between stacked pins. */
const GAP_PX = 8

/** A knob to pin beside the column, level with `anchor`: the lab point of its sentence's first character. */
export type MarginPin = { anchor: Point; element: HTMLElement; label: HTMLElement }

/**
 * Places each pin in the right gutter, the left one being the rail's, with its label wrapped to fit the gutter, and stacks pins downward so they never overlap.
 * `columnRight` is the lab x of the text column's right edge, `pageRight` the lab's. Returns each pin's knob center, in order.
 */
export function placeInRightMargin(pins: MarginPin[], columnRight: number, pageRight: number): Point[] {
  const room = pageRight - columnRight
  const points: Point[] = []
  let bottom = -Infinity
  const order = pins.map((_, i) => i).sort((a, b) => pins[a].anchor.y - pins[b].anchor.y)
  for (const i of order) {
    const { element, label, anchor } = pins[i]
    const size = element.offsetWidth
    label.style.maxWidth = `${Math.max(0, room - size - 4 * GAP_PX)}px`
    const height = Math.max(size, label.offsetHeight)
    const y = Math.max(anchor.y, bottom + GAP_PX + height / 2)
    bottom = y + height / 2
    points[i] = { x: columnRight + GAP_PX + size / 2, y }
  }
  return points
}
