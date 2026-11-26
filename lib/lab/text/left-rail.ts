import type { Connection } from "./connections"
import type { LeadRelevance } from "./keyword-relevance"
import type { Span } from "./segments"

/** Each line's meter has this many steps of connection strength, like the ruler on a future knob's link. */
const SEGMENTS = 10
const NUMBERED_EVERY = 5
/** Must match `--settle` in lab.css: how long a value takes to land, and stays live (orange) while it does. */
const SETTLE_MS = 300
/** A meter moves one segment per step toward its value, so ten segments take `SETTLE_MS`. */
const STEP_MS = SETTLE_MS / SEGMENTS
/** A segment that turns on or off stays orange this long, then fades (see lab.css) to its new state. */
const TRACE_MS = 60
/** Closer scores are too likely noise to stretch apart. */
const MIN_STRETCHED_RANGE = 0.1
const CONTRAST = 2.5
/** The bracket stops short of its first and last lines by this much, so neighbouring boxes stay apart. */
const BRACKET_INSET_PX = 3

/** An attention box as the rail shows it: its phrase and keyword as spans of the shown text, and its keyword's relevance to the tip. */
export type RailBox = { phrase: Span; keyword: Span; isActive: boolean } & LeadRelevance

/** `lines` are the spans of the shown text's lines, the last one holding the main knob. */
export type RailState = { lines: Span[]; boxes: RailBox[]; connection?: Connection }

/** `shown` segments are lit now; the meter steps toward `target`, one segment per `STEP_MS`, the last step at `steppedAt`. */
type Row = { element: HTMLElement; rank: HTMLElement; score: HTMLElement; cells: HTMLElement[]; shown: number; target: number; steppedAt: number }

/**
 * A ruler beside the text, one row per line, every fifth numbered. On each line it shows:
 * a bracket for each attention box spanning its lines, notched at its keyword; the rank and relevance of the keyword on the line (the most relevant if several);
 * and a 10-step meter of how strongly the line connects to the focus, its sentences' strengths weighted by how much of the line each takes up.
 * Every change shows its diff at once in orange: the segments a meter gains or loses, and relevance numerals counting to a new value; then it settles.
 */
export function createLeftRail(element: HTMLElement) {
  const rows: Row[] = []
  const brackets = Object.assign(document.createElement("div"), { className: "brackets" })
  element.append(brackets)
  const markTimers = new WeakMap<Element, number>()
  /** Rows whose meter is still stepping toward its target, all driven by one animation frame loop. */
  const moving = new Set<Row>()
  let frame: number | undefined

  return { show }

  function show({ lines, boxes, connection }: RailState) {
    const added = fit(Math.max(1, lines.length))
    element.dataset.focus = connection?.kind ?? ""
    const lineHeight = rows[0].element.offsetHeight
    const lineOf = (offset: number) =>
      Math.max(
        0,
        lines.findIndex(({ end }) => offset <= end),
      )
    const strengths = connection && lineStrengths(lines, connection)
    const focusLines = connection ? lines.flatMap((line, i) => (overlap(line, connection.focus) > 0 ? [i] : [])) : []
    const ranked = boxes.filter(({ relevance }) => relevance !== undefined).sort((a, b) => b.relevance! - a.relevance!)

    rows.forEach((row, i) => {
      const { element } = row
      element.toggleAttribute("data-tip", i === lines.length - 1)
      element.toggleAttribute("data-focus", focusLines.includes(i))
      const lit = litOf(strengths?.[i])
      meter(row, lit, !added.includes(row))

      const [best] = boxes.filter(({ keyword }) => lineOf(keyword.start) === i).sort((a, b) => (b.relevance ?? -1) - (a.relevance ?? -1))
      element.toggleAttribute("data-active", best?.isActive ?? false)
      row.score.classList.toggle("measuring", best?.isMeasuring ?? false)
      if (!best || (best.relevance === undefined && !best.isMeasuring)) {
        row.rank.textContent = row.score.textContent = ""
        delete row.score.dataset.value
      } else if (best.isMeasuring) {
        row.rank.textContent = ""
        row.score.textContent = "··"
      } else {
        row.rank.textContent = `${ranked.indexOf(best) + 1}`
        countTo(row.score, best.relevance!)
      }
    })

    brackets.replaceChildren(
      ...boxes.map(({ phrase, keyword, isActive }) => {
        const first = lineOf(phrase.start)
        const last = lineOf(phrase.end - 1)
        const bracket = Object.assign(document.createElement("span"), { className: "bracket" })
        const notch = document.createElement("i")
        bracket.append(notch)
        bracket.style.top = `${first * lineHeight + BRACKET_INSET_PX}px`
        bracket.style.height = `${(last - first + 1) * lineHeight - 2 * BRACKET_INSET_PX}px`
        notch.style.top = `${(lineOf(keyword.start) - first) * lineHeight + lineHeight / 2 - BRACKET_INSET_PX}px`
        bracket.toggleAttribute("data-active", isActive)
        return bracket
      }),
    )
  }

  /** Keeps one row per line; returns the rows added. */
  function fit(count: number) {
    const added: Row[] = []
    while (rows.length < count) {
      const i = rows.length
      const element = Object.assign(document.createElement("div"), { className: "row" })
      const number = span("num", i === 0 || (i + 1) % NUMBERED_EVERY === 0 ? `${i + 1}` : "")
      const keyword = span("kw")
      const rank = document.createElement("i")
      const score = document.createElement("b")
      keyword.append(rank, score)
      const meter = span("meter")
      const cells = Array.from({ length: SEGMENTS }, () => document.createElement("i"))
      meter.append(...cells)
      element.append(number, span("brk"), keyword, meter, span("tick"))
      element.toggleAttribute("data-major", (i + 1) % NUMBERED_EVERY === 0)
      brackets.before(element)
      const row: Row = { element, rank, score, cells, shown: 0, target: 0, steppedAt: -Infinity }
      rows.push(row)
      added.push(row)
    }
    while (rows.length > count) {
      const row = rows.pop()!
      moving.delete(row)
      row.element.remove()
    }
    return added
  }

  /** Lights the first `lit` segments, from the text outward, at once; unless the row is new, the segments it gains or loses are orange until they settle. */
  function meter(row: Row, lit: number, isAnimated: boolean) {
    row.target = lit
    if (!isAnimated) {
      row.cells.forEach((cell, j) => cell.toggleAttribute("data-on", j < lit))
      row.shown = lit
      return moving.delete(row)
    }
    if (row.shown !== lit) moving.add(row)
    frame ??= requestAnimationFrame(step)
  }

  /**
   * Moves each meter one segment toward its target per `STEP_MS`: growing away from the text, a segment lights orange and fades to gray;
   * shrinking back toward it, a segment goes dark, leaving an orange trace that fades out. A new target, even in the other direction,
   * carries on from the segment the meter has reached, at the same pace.
   */
  function step(now: number) {
    frame = undefined
    for (const row of moving) {
      if (now - row.steppedAt < STEP_MS) continue
      row.steppedAt = now
      const isGrowing = row.target > row.shown
      const cell = row.cells[isGrowing ? row.shown : row.shown - 1]
      row.shown += isGrowing ? 1 : -1
      cell.toggleAttribute("data-on", isGrowing)
      mark(cell, isGrowing ? "data-gained" : "data-lost", TRACE_MS)
      if (row.shown === row.target) {
        moving.delete(row)
        row.steppedAt = -Infinity
      }
    }
    if (moving.size) frame = requestAnimationFrame(step)
  }

  /** Sets `attribute` on `node` for `ms`, restarting if marked again. */
  function mark(node: Element, attribute: string, ms: number) {
    for (const other of ["data-live", "data-gained", "data-lost"]) node.removeAttribute(other)
    node.setAttribute(attribute, "")
    clearTimeout(markTimers.get(node))
    markTimers.set(
      node,
      window.setTimeout(() => node.removeAttribute(attribute), ms),
    )
  }

  /** Counts the numeral from the value it shows to `value`, live while it moves. */
  function countTo(node: HTMLElement, value: number) {
    const from = node.dataset.value === undefined ? value : Number(node.dataset.value)
    node.dataset.value = `${value}`
    if (Math.abs(from - value) < 0.005) return void (node.textContent = numeral(value))
    mark(node, "data-live", SETTLE_MS)
    const start = performance.now()
    const step = (now: number) => {
      if (node.dataset.value !== `${value}`) return
      const progress = Math.min(1, (now - start) / SETTLE_MS)
      node.textContent = numeral(from + (value - from) * (1 - (1 - progress) ** 3))
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }
}

/** A scored line lights at least one segment, so the weakest line still reads as measured, unlike a line nothing was scored on. */
function litOf(strength: number | undefined) {
  return strength === undefined ? 0 : 1 + Math.round(strength * (SEGMENTS - 1))
}

/** Each line's strength: the contrasted strengths of the sentences on it, weighted by how many of its characters each covers; undefined where none is scored. */
function lineStrengths(lines: Span[], { strengths }: Connection) {
  const contrasted = withContrast(strengths.map(({ strength }) => strength))
  return lines.map((line) => {
    let sum = 0
    let covered = 0
    strengths.forEach(({ span }, i) => {
      const chars = overlap(line, span)
      sum += contrasted[i] * chars
      covered += chars
    })
    return covered ? sum / covered : undefined
  })
}

/** Stretches the scores to fill 0 to 1, then pushes them toward the ends, so the strongest and weakest lines stand apart even when the model scores them closely. */
function withContrast(strengths: number[]) {
  const min = Math.min(...strengths)
  const range = Math.max(...strengths) - min
  return strengths.map((strength) => sCurve(range > MIN_STRETCHED_RANGE ? (strength - min) / range : strength))
}

function sCurve(x: number) {
  return x ** CONTRAST / (x ** CONTRAST + (1 - x) ** CONTRAST)
}

function overlap(a: Span, b: Span) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

function numeral(value: number) {
  return value >= 1 ? "1.0" : value.toFixed(2).replace(/^0/, "")
}

function span(className: string, text = "") {
  return Object.assign(document.createElement("span"), { className, textContent: text })
}
