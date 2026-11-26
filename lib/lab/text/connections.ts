import type { Focus, InfluenceSource } from "./influence"
import type { Span } from "./segments"
import { endOf, isComplete, sentenceAt, type StoryLayout } from "./story-layout"

/** A hovered box is scored soon; the tip waits for the text to hold still, as it changes with every move of the knob. */
const BOX_DELAY_MS = 150
const TIP_DELAY_MS = 400
/** Only this many sentences, nearest the focus, are scored, to keep requests small. */
const MAX_SENTENCES = 20
const MAX_CACHED = 50

/**
 * How strongly each scored sentence connects to the focus: the sentence under the main knob (`tip`), or a hovered attention box's phrase (`box`).
 * Strengths are raw scores from 0 to 1, each with its sentence's span of the combined text; showing them (contrast, mapping onto lines) is up to the reader.
 */
export type Connection = { kind: "tip" | "box"; focus: Span; strengths: { span: Span; strength: number }[] }

type ConnectionsOptions = {
  source: InfluenceSource
  /** Called when `current()` changes. */
  onChange: () => void
}

/** What to score: `sentences` (the texts at `spans`) against `question`, which is the text at `focus`. */
type Target = { key: string; kind: Connection["kind"]; focus: Span; spans: Span[]; sentences: string[]; question: Focus }

/**
 * Scores how the shown sentences connect to what the hand is on. By default the complete sentences before the main knob are scored against the sentence
 * at the knob, once that one is fully generated; while an attention box is hovered (see `focusPhrase`), the sentences around it are scored against its phrase.
 * When the focus moves, the last connection stays until the new one arrives.
 */
export function createConnections({ source, onChange }: ConnectionsOptions) {
  const cache = new Map<string, Connection>()
  let layout: StoryLayout = { content: "", text: "", combined: "", sentences: [] }
  let phrase: Span | undefined
  let target: Target | undefined
  let shown: Connection | undefined
  let pending: { key: string; controller: AbortController } | undefined
  let timer: number | undefined

  return { update, focusPhrase, current: () => shown, pause, resume: refresh }

  /** Cancels the scoring under way or waiting; `resume` (a refresh) asks again for what is in focus then. */
  function pause() {
    clearTimeout(timer)
    pending?.controller.abort()
    pending = undefined
  }

  function update(story: StoryLayout) {
    layout = story
    refresh()
  }

  /** Focuses the phrase at `span` of the shown text, or nothing. */
  function focusPhrase(span: Span | undefined) {
    if (span?.start === phrase?.start && span?.end === phrase?.end) return
    phrase = span
    refresh()
  }

  function refresh() {
    target = phrase ? boxTarget(layout, phrase) : tipTarget(layout)
    show()
    schedule()
  }

  function show() {
    const next = (target && cache.get(target.key)) ?? shown
    if (next === shown) return
    shown = next
    onChange()
  }

  function schedule() {
    clearTimeout(timer)
    if (!target || cache.has(target.key) || pending?.key === target.key) return
    const scheduled = target
    timer = window.setTimeout(() => score(scheduled), scheduled.kind === "box" ? BOX_DELAY_MS : TIP_DELAY_MS)
  }

  async function score({ key, kind, focus, spans, sentences, question }: Target) {
    pending?.controller.abort()
    const controller = new AbortController()
    pending = { key, controller }
    const strengths: number[] = []
    try {
      for await (const { index, strength } of source(sentences, question, controller.signal)) strengths[index] = strength
      if (controller.signal.aborted) return
      remember(key, { kind, focus, strengths: spans.flatMap((span, i) => (strengths[i] === undefined ? [] : [{ span, strength: strengths[i] }])) })
      show()
    } catch (error) {
      if (!controller.signal.aborted) console.error(error)
    } finally {
      if (pending?.controller === controller) pending = undefined
    }
  }

  function remember(key: string, connection: Connection) {
    cache.set(key, connection)
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!)
  }
}

/** The complete sentences ending before the knob, scored against the complete sentence after them, if it is generated yet. */
function tipTarget(layout: StoryLayout): Target | undefined {
  const { combined, sentences, text } = layout
  const count = sentences.findIndex((sentence, i) => endOf(combined, sentence) > text.length || !isComplete(layout, i))
  const previousCount = count === -1 ? sentences.length : count
  if (previousCount === 0 || previousCount === sentences.length || !isComplete(layout, previousCount)) return

  const focus = sentences[previousCount]
  const spans = sentences.slice(Math.max(0, previousCount - MAX_SENTENCES), previousCount)
  return targetOf(combined, "tip", focus, spans, { kind: "next sentence", text: sentenceAt(combined, focus) })
}

/** The shown sentences around `phrase`, scored against it. */
function boxTarget({ combined, sentences, text }: StoryLayout, phrase: Span): Target | undefined {
  const shownLength = text.length
  if (phrase.end > shownLength) return
  const shown = sentences.filter(({ start }) => start < shownLength).map(({ start, end }) => ({ start, end: Math.min(end, shownLength) }))
  const containing = shown.findIndex(({ end }) => end > phrase.start)
  const first = Math.max(0, Math.min(containing - Math.floor(MAX_SENTENCES / 2), shown.length - MAX_SENTENCES))
  return targetOf(combined, "box", phrase, shown.slice(first, first + MAX_SENTENCES), { kind: "key phrase", text: sentenceAt(combined, phrase) })
}

function targetOf(text: string, kind: Connection["kind"], focus: Span, spans: Span[], question: Focus): Target {
  const sentences = spans.map((span) => sentenceAt(text, span))
  return { key: JSON.stringify([question, sentences, spans.map(({ start }) => start)]), kind, focus, spans, sentences, question }
}
