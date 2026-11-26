import { layoutNextLine, type PreparedTextWithSegments } from "@chenglou/pretext"
import type { Caret } from "./caret"

/**
 * Pretext fits a line within `maxWidth` plus a small engine tolerance (its unexported `lineFitEpsilon`, at most 1/64 px), so a line that fills the column exactly can measure a hair wider than it.
 * Only a word that fits nowhere overflows by more: pretext still places it alone on the line, and the caret's line must not show it.
 */
const FIT_TOLERANCE_PX = 1 / 64

export function layoutLines(layout: PreparedTextWithSegments, caret: Caret, fullWidth: number) {
  const lines: string[] = []
  let cursor
  for (let i = 0; i <= caret.line; i++) {
    const width = i === caret.line ? caret.x : fullWidth
    const line = layoutNextLine(layout, width, cursor)
    if (!line || line.width > width + FIT_TOLERANCE_PX) break
    lines.push(line.text)
    cursor = line.end
  }
  return lines
}
