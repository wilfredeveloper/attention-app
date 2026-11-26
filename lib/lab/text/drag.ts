import type { Point } from "../point"
import type { Space } from "../space"

type DragHandlers = {
  /** Return false to ignore this press. */
  onStart?: (point: Point) => boolean
  onDrag: (point: Point) => void
  onDrop?: () => void
}

/** Points are in lab units (see ../space). */
export function makeDraggable(element: HTMLElement, space: Space, { onStart, onDrag, onDrop }: DragHandlers) {
  element.addEventListener("pointerdown", ({ pointerId, clientX, clientY }) => {
    if (onStart?.(space.point(clientX, clientY)) === false) return
    element.setPointerCapture(pointerId)
  })
  element.addEventListener("pointermove", ({ pointerId, clientX, clientY }) => {
    if (element.hasPointerCapture(pointerId)) onDrag(space.point(clientX, clientY))
  })
  if (onDrop) element.addEventListener("lostpointercapture", onDrop)
}
