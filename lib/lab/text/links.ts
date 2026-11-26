import type { Point } from "../point"

type Circle = { center: Point; radius: number }
type Segment = [Point, Point]

/** SVG path data drawing each segment; skips missing ones. */
export function pathOf(segments: (Segment | undefined)[]) {
  return segments.map((segment) => (segment ? `M${segment[0].x},${segment[0].y}L${segment[1].x},${segment[1].y}` : "")).join("")
}

/** The straight line between the circumferences of `from` and `to`; undefined if they touch. A point is a circle of radius 0. */
export function linkBetween(from: Circle, to: Circle): Segment | undefined {
  const length = distance(from.center, to.center)
  if (length <= from.radius + to.radius) return
  const along = (reach: number) => ({
    x: from.center.x + ((to.center.x - from.center.x) * reach) / length,
    y: from.center.y + ((to.center.y - from.center.y) * reach) / length,
  })
  return [along(from.radius), along(length - to.radius)]
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
