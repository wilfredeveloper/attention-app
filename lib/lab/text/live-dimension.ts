import { storedApiKey, streamCompletion } from "../llm/cerebras"
import type { Dimension, DimensionContext } from "./dimension"

const MENU_SIZE = 5
const MAX_WORDS_PER_LABEL = 3
/** Stands for the options of `focus` in the list of axes; the model replaces it with the sub-concepts the text has raised. */
const CHARACTERS_SLOT = "<concepts>"

/** Independent axes of a short teaching passage, most consequential first. `focus` has no generic options: its options are the text's own sub-concepts. */
export const CATALOG: Dimension[] = [
  { name: "depth", kind: "scale", low: "overview", high: "mechanism" },
  { name: "grounding", kind: "scale", low: "abstract", high: "concrete example" },
  { name: "audience", kind: "scale", low: "beginner", high: "expert" },
  { name: "mode", kind: "choice", options: ["analogy", "worked example", "definition", "step by step"] },
  { name: "focus", kind: "choice", options: [] },
  { name: "language", kind: "scale", low: "plain words", high: "technical terms" },
  { name: "angle", kind: "scale", low: "how it works", high: "why it matters" },
  { name: "pace", kind: "scale", low: "compressed", high: "expanded" },
  { name: "pitfalls", kind: "scale", low: "skip", high: "warn about" },
]

export const SYSTEM_PROMPT = `
The user message has the start of an explanation of a topic, cut off where the learner is, sometimes the learner's key phrases (keyword in brackets), and a list of axes. Each axis is one way the next 100 words of teaching could vary, written as "name: label | label".

Pick the axes that matter most for what could be explained next at this point, as many as asked, most important first. With key phrases, favor the axes that act on them. Output the picked lines unchanged, one per line, and nothing else.

The one exception is focus, which is the sub-concept the passage follows: replace <concepts> with 2 or 3 sub-concepts the text has raised, each in at most 3 words. Leave focus out when the text has raised none yet.

EXAMPLE
User:
Text: How a hash table finds things fast: instead of searching every item, it turns the key into a number, and that number says which slot to check. When two keys land in the same slot,
Axes:
depth: overview | mechanism
grounding: abstract | concrete example
mode: analogy | worked example | definition | step by step
focus: <concepts> | big picture
pitfalls: skip | warn about
Pick 3.
Assistant:
focus: hash function | collisions | big picture
grounding: abstract | concrete example
pitfalls: skip | warn about
`.trim()

/** One call offers the menu: the free catalog axes that matter most here, with the text's sub-concepts as the options of `focus`. Axes the model leaves out or garbles are filled in from the catalog. */
/** Attention app patch: `url` is the route the lab's text calls go to. lab.ts binds it, which makes this a DimensionSource. */
export async function* liveDimension(url: string, context: DimensionContext, signal: AbortSignal) {
  const apiKey = storedApiKey()
  if (!apiKey) throw new Error("save an API key first")

  const takenNames = context.taken.map(({ name }) => name.toLowerCase())
  const free = CATALOG.filter(({ name }) => !takenNames.includes(name))
  const generic = free.filter((axis) => axis.kind === "scale" || axis.options.length)
  const size = Math.min(MENU_SIZE, generic.length)
  if (!size) return

  const offered: string[] = []
  const deltas = streamCompletion({
    url,
    apiKey,
    system: SYSTEM_PROMPT,
    user: userMessageOf(context, free, size),
    temperature: 0.3,
    maxCompletionTokens: 1500,
    signal,
  })
  for await (const line of linesOf(deltas)) {
    const dimension = dimensionOf(line, free)
    if (!dimension || offered.includes(dimension.name)) continue
    offered.push(dimension.name)
    yield dimension
    if (offered.length === size) return
  }
  yield* generic.filter(({ name }) => !offered.includes(name)).slice(0, size - offered.length)
}

async function* linesOf(deltas: AsyncIterable<string>) {
  let buffer = ""
  for await (const delta of deltas) {
    const lines = (buffer + delta).split("\n")
    buffer = lines.pop()!
    yield* lines
  }
  yield buffer
}

function userMessageOf({ text, leads }: DimensionContext, free: Dimension[], size: number) {
  const keyPhrases = leads.length ? `Key phrases:\n${leads.map(({ before, keyword, after }) => `- ${before}[${keyword}]${after}`).join("\n")}\n` : ""
  return `Text: ${text}\n${keyPhrases}Axes:\n${free.map(axisLine).join("\n")}\nPick ${size}.`
}

function axisLine(axis: Dimension) {
  if (axis.kind === "scale") return `${axis.name}: ${axis.low} | ${axis.high}`
  return `${axis.name}: ${axis.options.length ? axis.options.join(" | ") : `${CHARACTERS_SLOT} | big picture`}`
}

/** Reads a "name: label | label" line as one of `axes`, keeping that axis's kind; undefined when it is not one of them or its labels do not fit the kind. */
function dimensionOf(line: string, axes: Dimension[]): Dimension | undefined {
  const [name, rest] = line.split(":", 2).map((part) => part.trim())
  const axis = axes.find((axis) => axis.name === name.toLowerCase())
  const labels = (rest ?? "").split("|").map(plainLabel)
  if (!axis || !labels.every(isValidLabel)) return

  if (axis.kind === "scale") return labels.length === 2 ? { name: axis.name, kind: "scale", low: labels[0], high: labels[1] } : undefined
  return labels.length >= 2 && labels.length <= 4 ? { name: axis.name, kind: "choice", options: labels } : undefined
}

/** Drops a parenthesised aside, which the model sometimes adds to a concept. */
function plainLabel(label: string) {
  return label
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isValidLabel(label: string) {
  return label !== "" && label !== CHARACTERS_SLOT && label.split(" ").length <= MAX_WORDS_PER_LABEL
}
