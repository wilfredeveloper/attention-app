import type { Lead } from "./attention"
import type { Control } from "./dimension"
import { countWords, firstWords } from "./words"

export type GenerationTrigger = "buffer low" | "steering changed"

/** How a call to `generate` ended: `busy` if another generation was running, `aborted` if cut short by `truncate` or `regenerate`. */
export type GenerationOutcome = "busy" | "aborted" | "done"

/** What leads a continuation: key phrases from the text, and dimensions tuned for what comes next. Either may be empty. */
export type Steering = { leads: Lead[]; controls: Control[] }

export type TextSource = {
  /** May rewrite the text before completion starts, e.g. to the opening again once it was all cut. */
  expand?(text: string): string
  /**
   * Streams text that continues `prefix`, led by `steering`.
   * Must stop (by throwing or returning) once `signal` aborts.
   */
  complete(prefix: string, steering: Steering, signal: AbortSignal): AsyncIterable<string>
}

/** How the latest generation went: whether it is still running, how long its first chunk took, and how fast words arrived after that. */
export type StreamActivity = { isGenerating: boolean; firstChunkMs?: number; wordsPerSecond?: number }

/** Times of the latest generation; `words` counts those after the first chunk, so the rate measures streaming, not latency. */
type Timing = { startedAt: number; firstChunkAt?: number; lastChunkAt?: number; words: number }

/**
 * `onChange` is called whenever the text changes and once a generation finishes. The text starts as `opening`, which is never cut but by cutting all of it,
 * or as `resumed`, which carries on from `opening` (attention app patch: a lab picking up where it stopped).
 */
export function createTextStream({ expand, complete }: TextSource, onChange: () => void, opening = "", resumed = opening) {
  let text = resumed
  let active: AbortController | undefined
  let id = 0
  let openingWords = countWords(opening)
  let timing: Timing | undefined
  /** Waiting for the current generation to start streaming. */
  const waiters = new Set<() => void>()

  return {
    get text() {
      return text
    },
    generate,
    truncate,
    regenerate,
    activity,
    streaming,
    stop,
  }

  /** Cancels the generation under way, keeping what it wrote; the next `generate` continues from there. */
  function stop() {
    if (!active) return
    active.abort()
    active = undefined
    console.log(`generation ${id} stop`)
    release()
    onChange()
  }

  /**
   * Resolves once the current generation has its first chunk, or ends without one; at once if none is running.
   * Lesser requests to the same API wait for this, so they never compete with the continuation for the server's rate limit or its time to first chunk.
   * A generation cancelled to start another hands its waiters on to the new one.
   */
  function streaming() {
    if (!active || timing?.firstChunkAt !== undefined) return Promise.resolve()
    return new Promise<void>((resolve) => waiters.add(resolve))
  }

  function release() {
    for (const resolve of waiters) resolve()
    waiters.clear()
  }

  function activity(): StreamActivity {
    if (!timing) return { isGenerating: false }
    const { startedAt, firstChunkAt, lastChunkAt, words } = timing
    const streamingMs = firstChunkAt === undefined || lastChunkAt === undefined ? 0 : lastChunkAt - firstChunkAt
    return {
      isGenerating: active !== undefined,
      firstChunkMs: firstChunkAt === undefined ? undefined : firstChunkAt - startedAt,
      wordsPerSecond: streamingMs > 0 ? (words * 1000) / streamingMs : undefined,
    }
  }

  /** Continues the text from its end, appending; never rewrites it. Rejects if the source fails. */
  async function generate(trigger: GenerationTrigger, steering: Steering): Promise<GenerationOutcome> {
    if (active) return "busy"

    const controller = (active = new AbortController())
    const { signal } = controller
    const generationId = ++id
    const expanded = expand?.(text) ?? text
    if (expanded !== text) {
      text = expanded
      openingWords = countWords(text)
      onChange()
    }
    const prefix = text
    const started: Timing = { startedAt: performance.now(), words: 0 }
    timing = started
    console.log(`generation ${generationId} start by ${trigger} after ${countWords(prefix)} words`)

    try {
      for await (const chunk of complete(prefix, steering, signal)) {
        if (signal.aborted) return "aborted"
        const now = performance.now()
        if (started.firstChunkAt === undefined) {
          started.firstChunkAt = now
          release()
        } else started.words += countWords(chunk)
        started.lastChunkAt = now
        text += chunk
        onChange()
      }
      if (signal.aborted) return "aborted"
      console.log(`generation ${generationId} done with ${countWords(text) - countWords(prefix)} words`)
      return "done"
    } catch (error) {
      if (!signal.aborted) throw error
      return "aborted"
    } finally {
      if (active === controller) {
        active = undefined
        release()
        onChange()
      }
    }
  }

  /** Cutting inside the expanded opening is a no-op unless `count` is zero. */
  function truncate(count: number) {
    if (count > 0 && count <= openingWords) return
    cutAfter(count)
  }

  /** Keeps at least the expanded opening, then generates again. */
  function regenerate(count: number, trigger: GenerationTrigger, steering: Steering) {
    cutAfter(Math.max(count, openingWords))
    return generate(trigger, steering)
  }

  function cutAfter(count: number) {
    if (active) {
      active.abort()
      active = undefined
      console.log(`generation ${id} cancel`)
    }
    text = firstWords(text, count)
    if (count === 0) openingWords = 0
  }
}
