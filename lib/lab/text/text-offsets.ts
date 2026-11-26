/** The text node and offset within it at character `offset` of `element`'s text, so ranges can span its child elements. A boundary between nodes resolves to the start of the later node. */
export function domPointAt(element: Node, offset: number): [Node, number] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let last: Text | undefined
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (offset < node.length) return [node, offset]
    offset -= node.length
    last = node
  }
  return last ? [last, last.length] : [element, 0]
}

/** Character offset of a DOM point within `element`'s text, clamped when the point lies outside it. */
export function textOffsetOf(element: Node, node: Node, offset: number) {
  const range = document.createRange()
  range.selectNodeContents(element)
  const position = range.comparePoint(node, offset)
  if (position !== 0) return position < 0 ? 0 : (element.textContent?.length ?? 0)
  range.setEnd(node, offset)
  return range.toString().length
}
