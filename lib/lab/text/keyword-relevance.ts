import type { Lead } from "./attention"
import { sentenceAt, sentenceUnderKnob, type StoryLayout } from "./story-layout"

const REQUEST_DELAY_MS = 300
const MAX_CACHED = 500

/** Asks how relevant each attention box's keyword is to the `tip`, the sentence under the main knob; `story` is the text before it, as context. */
export type RelevanceRequest = { story: string; tip: string; leads: Lead[] }

/** How relevant the keyword of the lead at `index` is to the tip, from 0 to 1. */
export type Relevance = { index: number; relevance: number }

/** Streams a relevance per lead. Must stop (by throwing or returning) once `signal` aborts. */
export type RelevanceSource = (request: RelevanceRequest, signal: AbortSignal) => AsyncIterable<Relevance>

/** A lead's relevance to the current tip, or the one it had for an earlier tip while the current one is measured. */
export type LeadRelevance = { relevance?: number; isMeasuring: boolean }

/**
 * Keeps each attention box's keyword scored against the sentence under the main knob. Scores are cached by tip and lead, so moving the knob back
 * or forth only asks about what is new; a request waits until the tip and leads have held still for `REQUEST_DELAY_MS`.
 */
export function createKeywordRelevance(source: RelevanceSource, onChange: () => void) {
  const scores = new Map<string, number>()
  /** The latest score of each lead under any tip, shown while its score for the current tip is measured. */
  const lastScores = new Map<string, number>()
  const asking = new Set<string>()
  let tip = ""
  let story = ""
  let leads: Lead[] = []
  let timer: number | undefined
  let controller: AbortController | undefined

  return { update, relevanceOf, pause, resume }

  /** Cancels the request under way or waiting. */
  function pause() {
    clearTimeout(timer)
    controller?.abort()
  }

  /** Asks again about the leads not scored for the current tip, as `update` would have. */
  function resume() {
    clearTimeout(timer)
    if (tip && leads.some((lead) => !scores.has(keyOf(tip, lead)))) timer = window.setTimeout(request, REQUEST_DELAY_MS)
  }

  function update(layout: StoryLayout, next: Lead[]) {
    const index = sentenceUnderKnob(layout)
    const nextTip = index === -1 ? "" : sentenceAt(layout.combined, layout.sentences[index])
    if (nextTip === tip && sameLeads(next, leads)) return
    tip = nextTip
    story = index === -1 ? "" : layout.combined.slice(0, layout.sentences[index].start).trim()
    leads = next
    clearTimeout(timer)
    if (tip && leads.some((lead) => !scores.has(keyOf(tip, lead)))) timer = window.setTimeout(request, REQUEST_DELAY_MS)
    onChange()
  }

  function relevanceOf(lead: Lead): LeadRelevance {
    const key = keyOf(tip, lead)
    const relevance = scores.get(key)
    if (relevance !== undefined) return { relevance, isMeasuring: false }
    return { relevance: lastScores.get(leadKeyOf(lead)), isMeasuring: tip !== "" }
  }

  async function request() {
    controller?.abort()
    controller = new AbortController()
    const { signal } = controller
    const asked = leads.filter((lead) => !scores.has(keyOf(tip, lead)) && !asking.has(keyOf(tip, lead)))
    if (!asked.length) return
    const askedTip = tip
    const keys = asked.map((lead) => keyOf(askedTip, lead))
    keys.forEach((key) => asking.add(key))
    try {
      for await (const { index, relevance } of source({ story, tip: askedTip, leads: asked }, signal)) {
        remember(keys[index], relevance)
        lastScores.set(leadKeyOf(asked[index]), relevance)
        onChange()
      }
    } catch (error) {
      if (!signal.aborted) console.error(error)
    } finally {
      keys.forEach((key) => asking.delete(key))
    }
  }

  function remember(key: string, relevance: number) {
    scores.set(key, relevance)
    if (scores.size > MAX_CACHED) scores.delete(scores.keys().next().value!)
  }
}

function keyOf(tip: string, lead: Lead) {
  return JSON.stringify([tip, lead.before, lead.keyword, lead.after])
}

function leadKeyOf(lead: Lead) {
  return JSON.stringify([lead.before, lead.keyword, lead.after])
}

function sameLeads(a: Lead[], b: Lead[]) {
  return a.length === b.length && a.every((lead, i) => leadKeyOf(lead) === leadKeyOf(b[i]))
}
