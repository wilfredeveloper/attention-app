import type { Point } from "../point"
import { pathOf } from "./links"
import { optionIndexAt, type Dimension } from "./dimension"

export const SWING_RADIANS = Math.PI / 3
export const STRENGTH_RANGE_PX = 200
const MARK_LENGTH_PX = 12
const MINOR_MARK_PX = 4
const LABEL_GAP_PX = 12
/** Must match the line height of `.future-hud text` in lab.css. */
const LABEL_LINE_HEIGHT_PX = 14
const LABEL_PADDING_PX = 3
const DOT_RADIUS_PX = 3
const CENTERED_RADIANS = Math.PI / 18
/** A scale's rim is graduated in this many steps, every `NUMBERED_EVERY`th one longer and numbered. */
export const GRADUATIONS = 40
export const NUMBERED_EVERY = 10
const NUMERAL_INSET_PX = 18
/** Strengths at which a faint arc is drawn inside the rim while tuning. */
const STRENGTH_RINGS = [0.25, 0.5, 0.75]
/** The link to the tuned knob is a ruler marked in this many steps of strength, every `RULER_MAJOR_EVERY`th one longer. */
export const RULER_STEPS = 10
const RULER_MAJOR_EVERY = 5
const RULER_MARK_PX = 2
/** How far the backdrop reaches past the fan: beyond the rim, and to each side. Inside the rim it only covers the numerals and marks, so the text in the fan stays readable. */
const BACKDROP_REACH_PX = 110
const BACKDROP_INSIDE_PX = NUMERAL_INSET_PX + 10
const BACKDROP_REACH_RADIANS = Math.PI / 7
const SVG_NS = "http://www.w3.org/2000/svg"

let context: CanvasRenderingContext2D | undefined

type HudView =
  /** Tier 1: the menu's dimension names, none while it loads. */
  | { phase: "choosing"; names: string[]; candidate?: number }
  /** Tier 2: `swing` is the knob's angle from the axis, clamped to the fan. */
  | { phase: "tuning"; dimension: Dimension; swing: number }

/** One run of the readout: `dim` for context such as the dimension's name, `live` for the value the pointer is changing right now. */
export type ReadoutPart = { text: string; tone?: "dim" | "live" }

type HudOptions = {
  center: Point
  /** While tuning, where strength reaches 100%; while choosing, the gate that chooses the candidate carried through it. */
  rimRadius: number
  /** The fan's direction as an angle of deviation from straight down. */
  axis: number
  view: HudView
  /** The active knob's state, written on the axis beyond the values. */
  readout: ReadoutPart[]
  /** The active knob, unclamped: its angle from the axis, distance from `center` and radius. While tuning, its link is marked as a ruler of strength. */
  knob: { swing: number; distance: number; radius: number }
  /** The font the HUD's labels are drawn in, as a canvas font, to measure them. */
  font: string
}

/**
 * A page-colored band behind the rim that hides whatever lies under its marks, numerals and labels (leaving the text inside the fan readable), then the rim, the names or values written beside it, and the selected value marked, as SVG nodes.
 * While tuning, faint arcs mark strength inside the rim, a scale's rim is graduated and numbered, and the link to the knob is marked in steps of strength.
 */
export function hudNodesOf({ center, rimRadius, axis, view, readout, knob, font }: HudOptions): SVGElement[] {
  const widthOf = (content: string) => widthIn(font, content)
  const onFan = (swing: number, radius = rimRadius): Point => ({
    x: center.x + Math.sin(axis + swing) * radius,
    y: center.y + Math.cos(axis + swing) * radius,
  })
  const markAt = (swing: number, inside: number, outside: number): [Point, Point] => [onFan(swing, rimRadius - inside), onFan(swing, rimRadius + outside)]
  const textAt = (swing: number, radius: number, content: string, isLabel: boolean) => {
    const { x, y } = onFan(swing, radius)
    const across = Math.sin(axis + swing)
    const isCentered = Math.abs(across) < Math.sin(CENTERED_RADIANS)
    const anchor = isCentered ? "middle" : across < 0 ? "end" : "start"
    const baseline = isCentered && isLabel ? (Math.cos(axis + swing) > 0 ? "hanging" : "text-after-edge") : "middle"
    const text = svg("text", { x, y, "text-anchor": anchor, "dominant-baseline": baseline })
    text.textContent = content
    return { text, x, y, anchor, baseline }
  }
  /** A selected label sits on a filled plate, measured here since the nodes are not on the page yet. */
  const labelAt = (swing: number, content: string, isSelected = false): SVGElement[] => {
    const { text, x, y, anchor, baseline } = textAt(swing, rimRadius + LABEL_GAP_PX, content, true)
    if (!isSelected) return [text]
    text.dataset.selected = ""
    const width = widthOf(content) + 2 * LABEL_PADDING_PX
    const height = LABEL_LINE_HEIGHT_PX + LABEL_PADDING_PX
    const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width + LABEL_PADDING_PX : x - LABEL_PADDING_PX
    const top = baseline === "hanging" ? y - LABEL_PADDING_PX / 2 : baseline === "text-after-edge" ? y - height + LABEL_PADDING_PX / 2 : y - height / 2
    const plate = svg("rect", { x: left, y: top, width, height })
    plate.dataset.plate = ""
    return [plate, text]
  }
  const sectorStart = (count: number, i: number) => -SWING_RADIANS + sectorOf(count) * i
  const boundariesOf = (count: number) =>
    marked("boundary", pathOf(Array.from({ length: count + 1 }, (_, i) => markAt(sectorStart(count, i), MARK_LENGTH_PX / 2, MARK_LENGTH_PX / 2))))

  const backdropRadius = rimRadius + BACKDROP_REACH_PX
  const backdropSwing = SWING_RADIANS + BACKDROP_REACH_RADIANS
  const innerRadius = Math.max(0, rimRadius - BACKDROP_INSIDE_PX)
  const backdrop = marked(
    "backdrop",
    bandPath(
      [onFan(-backdropSwing, innerRadius), onFan(backdropSwing, innerRadius), innerRadius],
      [onFan(-backdropSwing, backdropRadius), onFan(backdropSwing, backdropRadius), backdropRadius],
    ),
  )
  const rim = marked("rim", arcPath(rimRadius, onFan(-SWING_RADIANS), onFan(SWING_RADIANS)))
  const readoutAt = (labels: string[]) => {
    const { text } = textAt(0, rimRadius + LABEL_GAP_PX + labelDepthOf(labels, axis, widthOf) + LABEL_GAP_PX, "", false)
    text.dataset.readout = ""
    text.replaceChildren(...readout.map(readoutSpan))
    return text
  }

  if (view.phase === "choosing") {
    rim.dataset.dashed = ""
    const { names, candidate } = view
    const labels = names.flatMap((name, i) => labelAt(sectorStart(names.length, i + 0.5), name, i === candidate))
    return [backdrop, rim, readoutAt(names), ...(names.length ? [boundariesOf(names.length)] : []), ...labels]
  }

  const { dimension, swing } = view
  const strengthNodes = [...ringsOf(rimRadius, onFan), rulerOf(center, axis, rimRadius, knob)]
  if (dimension.kind === "scale") {
    const graduations = Array.from({ length: GRADUATIONS + 1 }, (_, i) => -SWING_RADIANS + (i / GRADUATIONS) * 2 * SWING_RADIANS)
    const minor = marked("minor", pathOf(graduations.filter((_, i) => i % NUMBERED_EVERY).map((at) => markAt(at, MINOR_MARK_PX, 0))))
    const major = marked(
      "boundary",
      pathOf(graduations.filter((_, i) => i % NUMBERED_EVERY === 0).map((at) => markAt(at, MARK_LENGTH_PX * (2 / 3), MARK_LENGTH_PX / 3))),
    )
    const numerals = graduations.flatMap((at, i) => {
      if (i % NUMBERED_EVERY) return []
      const { text } = textAt(at, rimRadius - NUMERAL_INSET_PX, numeralOf(i / GRADUATIONS), false)
      text.setAttribute("text-anchor", "middle")
      text.dataset.numeral = ""
      return [text]
    })
    const { x, y } = onFan(swing)
    const marker = svg("circle", { cx: x, cy: y, r: DOT_RADIUS_PX })
    return [
      backdrop,
      ...strengthNodes,
      rim,
      minor,
      major,
      ...numerals,
      readoutAt([dimension.low, dimension.high]),
      marker,
      ...labelAt(-SWING_RADIANS, dimension.low),
      ...labelAt(SWING_RADIANS, dimension.high),
    ]
  }

  const { options } = dimension
  const selected = optionIndexAt(options.length, (swing + SWING_RADIANS) / (2 * SWING_RADIANS))
  const sector = marked("selected", arcPath(rimRadius, onFan(sectorStart(options.length, selected)), onFan(sectorStart(options.length, selected + 1))))
  const labels = options.flatMap((option, i) => labelAt(sectorStart(options.length, i + 0.5), option, i === selected))
  return [backdrop, ...strengthNodes, rim, sector, readoutAt(options), boundariesOf(options.length), ...labels]
}

/** Faint arcs inside the rim where strength reaches each of `STRENGTH_RINGS`, numbered at the fan's low end. */
function ringsOf(rimRadius: number, onFan: (swing: number, radius: number) => Point) {
  const zero = rimRadius - STRENGTH_RANGE_PX
  return STRENGTH_RINGS.flatMap((strength) => {
    const radius = zero + strength * STRENGTH_RANGE_PX
    const ring = marked("ring", arcPath(radius, onFan(-SWING_RADIANS, radius), onFan(SWING_RADIANS, radius)))
    const { x, y } = onFan(-SWING_RADIANS - CENTERED_RADIANS / 2, radius)
    const numeral = svg("text", { x, y, "text-anchor": "middle", "dominant-baseline": "middle" })
    numeral.textContent = `${strength * 100}`
    numeral.dataset.numeral = ""
    return [ring, numeral]
  })
}

/** Marks across the link to the knob, one per `1 / RULER_STEPS` of strength it has passed: each where the knob's edge would be at that strength. */
function rulerOf(center: Point, axis: number, rimRadius: number, knob: HudOptions["knob"]) {
  const zero = rimRadius - STRENGTH_RANGE_PX
  const direction = axis + knob.swing
  const across = direction + Math.PI / 2
  const along = (radius: number): Point => ({ x: center.x + Math.sin(direction) * radius, y: center.y + Math.cos(direction) * radius })
  const offset = ({ x, y }: Point, length: number): Point => ({ x: x + Math.sin(across) * length, y: y + Math.cos(across) * length })
  const marks = Array.from({ length: RULER_STEPS }, (_, i) => i + 1).flatMap((step) => {
    const reach = zero + (step / RULER_STEPS) * STRENGTH_RANGE_PX
    if (reach > knob.distance) return []
    const at = along(reach - knob.radius)
    const length = step % RULER_MAJOR_EVERY ? RULER_MARK_PX : RULER_MARK_PX * 2
    return [[offset(at, length), offset(at, -length)] as [Point, Point]]
  })
  return marked("ruler", pathOf(marks))
}

/** How far the labels reach beyond the rim along the axis: a line's height when it points up or down, the widest label's width when sideways. */
function labelDepthOf(labels: string[], axis: number, widthOf: (content: string) => number) {
  const widest = Math.max(0, ...labels.map(widthOf))
  return LABEL_LINE_HEIGHT_PX * Math.abs(Math.cos(axis)) + (widest + LABEL_GAP_PX) * Math.abs(Math.sin(axis))
}

/** Measured in the font the HUD's text is drawn in: the lab's family at `--hud-size`. */
function widthIn(font: string, content: string) {
  context ??= document.createElement("canvas").getContext("2d")!
  context.font = font
  return context.measureText(content).width
}

function readoutSpan({ text, tone }: ReadoutPart, index: number) {
  const span = svg("tspan", {})
  span.textContent = index ? ` ${text}` : text
  if (tone) span.dataset.tone = tone
  return span
}

function numeralOf(position: number) {
  return position.toFixed(2).replace(/^0(?=\.)/, "")
}

function sectorOf(count: number) {
  return (2 * SWING_RADIANS) / count
}

function marked(role: string, d: string) {
  const path = svg("path", { d })
  path.dataset.role = role
  return path
}

function svg(tag: string, attributes: Record<string, string | number>) {
  const element = document.createElementNS(SVG_NS, tag) as SVGElement
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, `${value}`)
  return element
}

/** The arc of `radius` from `from` to `to`, sweeping through the fan's middle. */
function arcPath(radius: number, from: Point, to: Point) {
  return `M${from.x},${from.y}A${radius},${radius} 0 0 0 ${to.x},${to.y}`
}

/** The band between two arcs swept the same way: out along the outer arc, back along the inner one. */
function bandPath([innerFrom, innerTo, inner]: [Point, Point, number], [outerFrom, outerTo, outer]: [Point, Point, number]) {
  return `M${outerFrom.x},${outerFrom.y}A${outer},${outer} 0 0 0 ${outerTo.x},${outerTo.y}L${innerTo.x},${innerTo.y}A${inner},${inner} 0 0 1 ${innerFrom.x},${innerFrom.y}Z`
}
