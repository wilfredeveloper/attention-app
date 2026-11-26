export function countWords(text: string) {
  return text.match(/\S+/g)?.length ?? 0
}

export function firstWords(text: string, count: number) {
  return text.match(new RegExp(`^(?:\\s*\\S+){${count}}`))?.[0] ?? ""
}

/**
 * The start of `text` that `lines` (laid out from it, in order) show, character for character. Counting the lines' words instead
 * miscounts when a line breaks inside a word (at a dash: "satisfied—" | "output"), which would add a word past the knob. Undefined
 * if a line isn't where it should be (only whitespace may come between lines).
 */
export function shownPrefix(text: string, lines: string[]) {
  let at = 0
  for (const line of lines) {
    const part = line.trim()
    if (!part) continue
    const i = text.indexOf(part, at)
    if (i < 0 || text.slice(at, i).trim()) return undefined
    at = i + part.length
  }
  return text.slice(0, at)
}
