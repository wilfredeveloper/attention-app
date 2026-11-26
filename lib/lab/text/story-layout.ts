import { sentenceSpans, type Span } from "./segments"
import { countWords, firstWords } from "./words"

const SENTENCE_END = /[.!?…]["'”’)\]]*$/

/**
 * The text as laid out up to the main knob, and what is generated past it.
 * `text` is the shown text with line breaks as spaces, `content` the same with line breaks; `combined` continues `text` with the generated text past the knob, its whitespace collapsed.
 * `sentences` tile `combined`, trailing whitespace included.
 */
export type StoryLayout = { content: string; text: string; combined: string; sentences: Span[] }

/** `lines` are the lines shown up to the knob; `fullText` is everything generated so far, which may reach past the knob. */
export function storyLayoutOf(lines: string[], fullText: string): StoryLayout {
  const text = lines.join(" ")
  const upcoming = fullText.slice(firstWords(fullText, countWords(text)).length).replace(/\s+/g, " ")
  const combined = text + upcoming
  return { content: lines.join("\n"), text, combined, sentences: sentenceSpans(combined) }
}

/** A sentence is complete once another one follows it, or when it ends in sentence punctuation. */
export function isComplete({ combined, sentences }: StoryLayout, index: number) {
  return index < sentences.length - 1 || SENTENCE_END.test(sentenceAt(combined, sentences[index]))
}

/** Index of the sentence the main knob is in, counting one it has just finished, or -1 before any text. */
export function sentenceUnderKnob({ text, combined, sentences }: StoryLayout) {
  const knobAt = text.trimEnd().length
  return sentences.findIndex((sentence) => endOf(combined, sentence) >= knobAt)
}

/** Where the sentence's last character ends, before its trailing whitespace. */
export function endOf(text: string, { start, end }: Span) {
  return start + text.slice(start, end).trimEnd().length
}

/** The sentence's text, its whitespace collapsed, so it reads the same however the lines break. */
export function sentenceAt(text: string, { start, end }: Span) {
  return text.slice(start, end).trim().replace(/\s+/g, " ")
}
