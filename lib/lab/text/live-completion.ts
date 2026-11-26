import { storedApiKey, streamCompletion } from "../llm/cerebras"
import { STEERED_REQUEST, STORY_REQUEST, steeredUserMessage, storyUserMessage, type Source } from "../story/prompt"
import { strengthLevelOf, valueOf, type Control } from "./dimension"
import { plainMathStream } from "./plain-math"
import type { Steering, TextSource } from "./text-stream"
import { countWords } from "./words"

const MAX_ECHO_WORDS = 6

/**
 * Attention app patch: one lab's text. It starts from `start` (upstream read a `topic` URL parameter), and starts from it again once
 * all of it was cut; every continuation is asked to keep to the clipped passages `getSources` returns then (read live, so a passage
 * clipped mid-session leads the next continuation), and goes to the route at `url`.
 */
export function liveSource(start: string, getSources: () => Source[], url: string): TextSource {
  return {
    expand: (text) => (text.trim() ? text : start),
    complete: (prefix, steering, signal) => completeStory(prefix, steering, getSources(), url, signal),
  }
}

async function* completeStory(prefix: string, steering: Steering, sources: Source[], url: string, signal: AbortSignal) {
  const apiKey = storedApiKey()
  if (!apiKey) throw new Error("save an API key first")

  const isSteered = steering.leads.length > 0 || steering.controls.length > 0
  const request = isSteered
    ? { ...STEERED_REQUEST, user: steeredUserMessage(prefix, steeringLines(steering), sources) }
    : { ...STORY_REQUEST, user: storyUserMessage(prefix, sources) }
  let head: string | undefined = ""
  for await (const delta of plainMathStream(streamCompletion({ ...request, url, apiKey, signal }))) {
    if (head === undefined) {
      yield delta
      continue
    }
    head += delta
    if (countWords(head) <= MAX_ECHO_WORDS) continue
    yield ` ${withoutEcho(prefix, head)}`
    head = undefined
  }
  const rest = head && withoutEcho(prefix, head)
  if (rest) yield ` ${rest}`
}

/** Drops the leading words of `head` that repeat the last words of `prefix`, which the model sometimes echoes before it continues. */
function withoutEcho(prefix: string, head: string) {
  const start = head.trimStart()
  const tail = (prefix.match(/\S+/g) ?? []).slice(-MAX_ECHO_WORDS).map(bareWord)
  const words = [...start.matchAll(/\S+/g)]
  for (let count = Math.min(tail.length, words.length); count > 0; count--) {
    const isEcho = tail.slice(-count).every((word, i) => word !== "" && word === bareWord(words[i][0]))
    if (isEcho) return start.slice(words[count - 1].index + words[count - 1][0].length).trimStart()
  }
  return start
}

function bareWord(word: string) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
}

/** The steering as the steered message lists it: each lead's phrase with its keyword [bracketed], and a line per control. */
function steeringLines({ leads, controls }: Steering) {
  return { phrases: leads.map(({ before, keyword, after }) => `${before}[${keyword}]${after}`), controls: controls.map(controlLine) }
}

function controlLine({ dimension, position, strength }: Control) {
  const options = dimension.kind === "choice" ? ` (options: ${dimension.options.join(", ")})` : ""
  return `${dimension.name}: ${valueOf({ dimension, position })}${options} (${strengthLevelOf(strength)})`
}
