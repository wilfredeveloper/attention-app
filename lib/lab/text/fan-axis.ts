import type { Point } from "../point"
import { SWING_RADIANS } from "./future-hud"

const AXIS_STEP_RADIANS = Math.PI / 12
const SAMPLE_STEP_RADIANS = Math.PI / 18
const SAMPLE_REACH_PX = 48
const MARGIN_X_PX = 96
const MARGIN_Y_PX = 16

/** The part of the lab on screen, in lab units (see ../space). */
type Viewport = { left: number; top: number; right: number; bottom: number }

/**
 * The fan's direction as an angle of deviation from straight down: the one nearest to straight down whose whole fan,
 * sampled along its arc just beyond `rimRadius`, fits in the viewport with room for labels; else the one that overflows least.
 */
export function axisFor(center: Point, rimRadius: number, viewport: Viewport) {
  const steps = Math.round(Math.PI / AXIS_STEP_RADIANS)
  const candidates = [0, ...Array.from({ length: steps * 2 }, (_, i) => (i % 2 === 0 ? 1 : -1) * (Math.floor(i / 2) + 1) * AXIS_STEP_RADIANS)]
  const limits = {
    left: viewport.left + MARGIN_X_PX,
    right: viewport.right - MARGIN_X_PX,
    top: viewport.top + MARGIN_Y_PX,
    bottom: viewport.bottom - MARGIN_Y_PX,
  }
  const overflows = candidates.map((axis) => overflowOf(center, rimRadius + SAMPLE_REACH_PX, axis, limits))
  return candidates[overflows.indexOf(Math.min(...overflows))]
}

function overflowOf(center: Point, radius: number, axis: number, limits: Viewport) {
  const count = Math.round((2 * SWING_RADIANS) / SAMPLE_STEP_RADIANS)
  let total = 0
  for (let i = 0; i <= count; i++) {
    const angle = axis - SWING_RADIANS + i * SAMPLE_STEP_RADIANS
    const x = center.x + Math.sin(angle) * radius
    const y = center.y + Math.cos(angle) * radius
    total += Math.max(0, limits.left - x, x - limits.right) + Math.max(0, limits.top - y, y - limits.bottom)
  }
  return total
}
