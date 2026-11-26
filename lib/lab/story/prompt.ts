// What the text model is told to write: the system prompts of the continuation, and the user messages that carry the text so far.
// Attention app patch: a lab may be given SOURCES, passages the learner clipped while reading; when it has some, every continuation
// is asked to keep to them. No imports, so the tests can load this file as it is (lib/lab-prompt.test.mjs).

export const STORY_MAX_WORDS = 400

/** How much a clipped source shapes the continuation: the lab's own control words, plus "ignore" (left out of the prompt
    entirely). "moderate" is the default and goes unmarked, so an old clip with no weight reads the same as before. */
export type ClipWeight = "ignore" | "slight" | "moderate" | "strong"
export const DEFAULT_WEIGHT: ClipWeight = "moderate"

/** The weights in dial order, low to high: the swing of a clip's dial picks one. Its label is the word capitalised. */
export const CLIP_WEIGHTS: ClipWeight[] = ["ignore", "slight", "moderate", "strong"]

/** A clip as the lab's dial sees it: its id (to write the steer back onto the note), a short label, the passage and the text
    around it (to ask the model for ways to use it), and its steer now (a weight, or a `use` the learner already picked). */
export type LabClip = { id: string; label: string; quote: string; around: string; weight: ClipWeight; use?: string }

/** What a clip's dial writes back: a weight on the scale, or a `use` the learner picked from the model's ways. Exactly one is set. */
export type ClipSteer = { weight?: ClipWeight; use?: string }

/** A passage the learner clipped: its words, where it is from (a lesson, a section, a page), the text around it, how much to
    lean on it, and a `use`: a short model-suggested instruction for how to use this passage, which the learner picked from the
    dial. A `use` is a contextual steer (e.g. "make it the running example"); it takes the place of the weight when set. */
export type Source = { quote: string; where: string; around: string; weight?: ClipWeight; use?: string }

/** The lab shows its text as it is, so math has to read right as plain text. */
const PLAIN_MATH = `Write math the way it reads as plain text: in words, in Unicode where it is natural (x₁, x², a · b, ≈, →, √64), or in plain ASCII like x1 and (0,1). Never LaTeX: no backslashes, no dollar signs, no braces after _ or ^.`

export const STORY_SYSTEM_PROMPT = `Continue the explanation. The user message is its start: the topic a learner asked about, sometimes followed by the explanation so far, which may stop mid-sentence. When the learner clipped SOURCES, they come first, and the start follows under TEXT SO FAR.

- Teach the topic to a curious learner: build from intuition to mechanism, one idea at a time, with a concrete example where it helps.
- Sources are passages the learner clipped while reading: ground the explanation in them and keep to their ideas and terms, but don't quote them back.
- A source may carry a weight: lean heavily on a strong one and only lightly on a slight one; the rest carry normal weight.
- A source may instead carry a use: a short instruction for how to use that passage (e.g. make it the running example, contrast it, define its term). Follow it for that source.
- Output only the words that come next. Do not repeat the start.
- Your first word directly follows the start's last word.
- Plain text only. No title, headings, lists, markdown or commentary.
- ${PLAIN_MATH}
- At most ${STORY_MAX_WORDS} words. End on a complete sentence.

EXAMPLE
User: How a hash table finds things fast:
Assistant:
instead of searching every item, it turns the key into a number, and that number says exactly which slot to look in.`

export const STEERED_SYSTEM_PROMPT = `Continue the explanation. It teaches a topic to a curious learner. The user message may list SOURCES, KEY PHRASES and CONTROLS, then the text so far, which starts with the topic and may stop mid-sentence.

- Output only the words that come next. Your first word directly follows the text's last word: if the text stops mid-sentence, finish that sentence first. Never repeat or restart any of the text so far, not even its last word.
- Sources are passages the learner clipped while reading: ground the explanation in them and keep to their ideas and terms, but don't quote them back. Key phrases and controls still lead what comes next.
- A source may carry a weight: lean heavily on a strong one and only lightly on a slight one; the rest carry normal weight.
- A source may instead carry a use: a short instruction for how to use that passage (e.g. make it the running example, contrast it, define its term). Follow it for that source.
- Key phrases lead what is explained next: build the continuation on them, most of all on the [bracketed] words.
- Controls set how the next passage teaches. Each is a dimension given only by its name and its poles or options, so infer from the labels what to change in the content, depth or style. A scale gives a position between two poles: at an extreme, push hard toward that pole so a learner notices it within two sentences; midway, balance both. A choice names the option to follow. Each control ends with a strength in parentheses that sets how much it shapes the passage. Strong: it dominates every sentence. Moderate: a clear influence throughout. Slight: show it in one or two touches only. Obey every control from the first sentence to the last, but never write a label itself as words of the text.
- With both, key phrases are the content and controls are the manner.
- Stay accurate. Never invent facts, numbers or sources to satisfy a control.
- Plain text only. No title, headings, lists, markdown or commentary.
- ${PLAIN_MATH} This holds under every control, technical or expert ones too.
- Write 120 to 300 words, never more than ${STORY_MAX_WORDS}. End on a complete sentence.

EXAMPLE
User:
KEY PHRASES
turns the key into a [number]

CONTROLS
grounding: concrete example

TEXT SO FAR
How a hash table finds things fast: instead of searching every item, it turns the key into a number, and that number
Assistant:
says which slot to check. Take the word "cat": add up its letters' codes, divide by 10 and keep the remainder, 2. The table looks in slot 2 and nowhere else.`

export const STORY_REQUEST = {
  system: STORY_SYSTEM_PROMPT,
  temperature: 0.9,
  maxCompletionTokens: 2000,
}

export const STEERED_REQUEST = { ...STORY_REQUEST, system: STEERED_SYSTEM_PROMPT }

/** What a lab starts from when it is given no text, as upstream's live mode did when no topic was typed. */
export const DEFAULT_TOPIC = "How attention works in a language model"

/** A topic as the start of an explanation: a heading the text continues after (a colon unless it already ends a sentence or a heading). */
export function headingOf(topic: string) {
  const heading = topic.trim() || DEFAULT_TOPIC
  return /[.:?!]$/.test(heading) ? heading : `${heading}:`
}

/** The sources the model is told to keep to: all but the ones the learner set to ignore. */
const leaned = (sources: Source[]) => sources.filter((s) => s.weight !== "ignore")

/** The unsteered call's user message: the text so far, alone as upstream sent it, or under the sources when there are some. */
export function storyUserMessage(prefix: string, sources: Source[]) {
  const kept = leaned(sources)
  return kept.length
    ? blocksOf([
        ["SOURCES", sourceLines(kept)],
        ["TEXT SO FAR", [prefix]],
      ])
    : prefix
}

/** The steered call's user message: `phrases` are the key phrases with their keyword [bracketed], `controls` one line per control. */
export function steeredUserMessage(prefix: string, { phrases, controls }: { phrases: string[]; controls: string[] }, sources: Source[]) {
  return blocksOf([
    ["SOURCES", sourceLines(leaned(sources))],
    ["KEY PHRASES", phrases],
    ["CONTROLS", controls],
    ["TEXT SO FAR", [prefix]],
  ])
}

/** Each source numbered, with where it is from, then the text around it when known. A `use` the learner picked is spelled out on
    the first line; failing that, a weight other than the default. Whitespace is collapsed, so each part takes one line. (Ignored
    sources are dropped before this.) */
function sourceLines(sources: Source[]) {
  const flat = (text: string) => text.replace(/\s+/g, " ").trim()
  const tag = (weight?: ClipWeight, use?: string) =>
    use && flat(use) ? ` (use: ${flat(use)})` : weight && weight !== DEFAULT_WEIGHT && weight !== "ignore" ? ` (weight: ${weight})` : ""
  return sources.flatMap(({ quote, where, around, weight, use }, i) => [
    `[${i + 1}]${flat(where) ? ` From ${flat(where)}:` : ""} "${flat(quote)}"${tag(weight, use)}`,
    ...(flat(around) ? [`Around it: ${flat(around)}`] : []),
  ])
}

/** Whether two source lists hold the same passages, with the same weights and uses, in the same order, so a lab can ignore a change-free list. */
export function sameSources(a: Source[], b: Source[]) {
  return (
    a.length === b.length &&
    a.every((s, i) => s.quote === b[i].quote && s.where === b[i].where && s.around === b[i].around && s.weight === b[i].weight && (s.use ?? "") === (b[i].use ?? ""))
  )
}

/** How many model-suggested ways a clip's leaf offers, besides the always-first Ignore. */
export const MAX_CLIP_WAYS = 4
const MAX_WAY_WORDS = 8

/** Asks a cheap call for short, contextual ways to use one clipped passage. Each way is one option on that clip's dial (Ignore is
    added by the dial as the first option), so they must be short imperative phrases, each a different angle on the same passage. */
export const CLIP_WAYS_SYSTEM = `The user gives one passage a learner clipped while reading, and the explanation it sits in. Suggest ${MAX_CLIP_WAYS} short, concrete ways the explanation could use THIS passage — each a different angle (for example: make it the running example, contrast it with manual weights, define its term plainly, apply it to a concrete case, warn about a pitfall it hides, carry its notation through).

Write each as a plain-English instruction a reader would take in at a glance — a short imperative that sounds natural spoken aloud. Call the passage "it", not "passage", and keep the little words (the, a, its) that make it read smoothly; don't drop them to save room. At most ${MAX_WAY_WORDS} words, starting with a verb, no full stop, no numbering, no quotation marks. One per line, most useful first, and nothing else.`

/** The ways call's user message: the passage, the paragraph around it, and the topic being explained for context. */
export function clipWaysUser({ quote, around, topic }: { quote: string; around?: string; topic?: string }) {
  const flat = (text: string) => text.replace(/\s+/g, " ").trim()
  return [topic && `Topic: ${flat(topic)}`, `Passage: "${flat(quote)}"`, around && flat(around) && `Around it: ${flat(around)}`].filter(Boolean).join("\n")
}

/** The model's reply as a short list of ways: one per line, bullets and numbering stripped, each capped to ${MAX_WAY_WORDS} words,
    duplicates (case aside) dropped, at most ${MAX_CLIP_WAYS}. Undefined when none survive, so the dial falls back to the weight scale. */
export function parseWays(raw: string): string[] | undefined {
  const seen = new Set<string>()
  const ways: string[] = []
  for (const line of raw.split("\n")) {
    const way = line
      .replace(/^[\s*_>#]*(?:[-–—•]|\d+[.)])?\s*/, "")
      .replace(/^["“']+|["”']+$/g, "")
      .replace(/[.]+$/, "")
      .replace(/\s+/g, " ")
      .trim()
    if (!way || way.split(" ").length > MAX_WAY_WORDS) continue
    const key = way.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    ways.push(way)
    if (ways.length === MAX_CLIP_WAYS) break
  }
  return ways.length ? ways : undefined
}

/** Empty blocks are left out, header included. */
function blocksOf(blocks: [string, string[]][]) {
  return blocks
    .filter(([, lines]) => lines.length)
    .map(([header, lines]) => `${header}\n${lines.join("\n")}`)
    .join("\n\n")
}
