import type { Point } from "./point"

/**
 * Where things are in a lab, in lab units: CSS pixels from the top-left corner of its page (the scrolling sheet that holds the text,
 * the knobs and the cursor), before any scaling by its ancestors. Upstream used page coordinates (pageX, scrollX) because the lab
 * owned the window; here it is a box anywhere on a page, often inside a board that zooms its shapes with a CSS transform.
 * Everything the lab measures from the screen (pointer events, client rects) is read through this, so its maths holds at any
 * zoom, box size or scroll.
 */
export type Space = ReturnType<typeof createSpace>

/** `root` is the box the lab fills; `scroller` scrolls `page`, which everything is positioned in. */
export function createSpace(root: HTMLElement, scroller: HTMLElement, page: HTMLElement) {
  const rootStyle = getComputedStyle(root)

  /** Screen pixels per lab unit: the zoom of every transform above the lab. The used width, unrounded, unlike offsetWidth. */
  function scale() {
    const width = parseFloat(rootStyle.width)
    const onScreen = root.getBoundingClientRect().width
    return width > 0 && onScreen > 0 ? onScreen / width : 1
  }

  /** The lab point at viewport point `x`, `y`. */
  function point(x: number, y: number): Point {
    const { left, top } = page.getBoundingClientRect()
    const s = scale()
    return { x: (x - left) / s, y: (y - top) / s }
  }

  /** A viewport box (a client rect) in lab units. */
  function rect({ x, y, width, height }: DOMRect) {
    const { left, top } = page.getBoundingClientRect()
    const s = scale()
    return new DOMRect((x - left) / s, (y - top) / s, width / s, height / s)
  }

  /** The viewport point of lab point `p`, for the browser's hit tests (elementFromPoint, caretPositionFromPoint). */
  function client(p: Point): Point {
    const { left, top } = page.getBoundingClientRect()
    const s = scale()
    return { x: left + p.x * s, y: top + p.y * s }
  }

  /** The element's center and radius (half its width), as a knob's circle. */
  function circle(element: Element) {
    const { x, y, width, height } = rect(element.getBoundingClientRect())
    return { center: { x: x + width / 2, y: y + height / 2 }, radius: width / 2 }
  }

  /** The part of the page on screen: what the scroller shows, cut to the browser window when the lab reaches past it. */
  function visible() {
    const box = scroller.getBoundingClientRect()
    const left = Math.max(box.left, 0)
    const top = Math.max(box.top, 0)
    const right = Math.min(box.right, document.documentElement.clientWidth)
    const bottom = Math.min(box.bottom, innerHeight)
    const shown = right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : box
    const { x, y, width, height } = rect(shown)
    return { left: x, top: y, right: x + width, bottom: y + height }
  }

  return { scale, point, rect, client, circle, visible }
}
