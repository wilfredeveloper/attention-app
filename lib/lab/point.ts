export type Point = { x: number; y: number }

export const lerp = (from: Point, to: Point, t: number) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })

export const subtract = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y })

export const distanceBetween = (a: Point, b: Point, aspectRatio: number) => Math.hypot(a.x - b.x, (a.y - b.y) / aspectRatio)

export const centeredAt = ({ x, y }: Point, size: number) => `${x - size / 2}px ${y - size / 2}px`
