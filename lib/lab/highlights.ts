/**
 * The lab's CSS highlights (the shaded attention boxes, underlined keywords, a hovered pin's sentence). A page has one registry of
 * highlights, keyed by name, so labs share each named highlight and every lab keeps its own ranges in it: setting one lab's ranges
 * leaves the other labs' alone. Names are prefixed with `lab-`, as the `::highlight()` rules in lab.css are.
 */
export function createHighlights() {
  const mine = new Map<string, Range[]>()

  return {
    /** Replaces this lab's ranges under `name`. */
    set(name: string, ranges: Range[]) {
      const shared = sharedHighlight(name)
      for (const range of mine.get(name) ?? []) shared.delete(range)
      for (const range of ranges) shared.add(range)
      mine.set(name, ranges)
    },
    /** Takes all of this lab's ranges out, when it goes. */
    clear() {
      for (const [name, ranges] of mine) {
        const shared = CSS.highlights.get(`lab-${name}`)
        for (const range of ranges) shared?.delete(range)
      }
      mine.clear()
    },
  }
}

export type Highlights = ReturnType<typeof createHighlights>

function sharedHighlight(name: string) {
  const key = `lab-${name}`
  let highlight = CSS.highlights.get(key)
  if (!highlight) {
    highlight = new Highlight()
    CSS.highlights.set(key, highlight)
  }
  return highlight
}
