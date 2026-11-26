/** A shaded run of words around an underlined keyword, extending `before` and `after` words from it. Indices count the word-like segments of the text, as given by `wordSpans`. */
export type AttentionBox = { keyword: number; before: number; after: number }

/** A box as the text it covers: `before + keyword + after` is its phrase, copied from the text. */
export type Lead = { before: string; keyword: string; after: string }

/** Streams boxes over `text`. Must stop (by throwing or returning) once `signal` aborts. */
export type AttentionSource = (text: string, signal: AbortSignal) => AsyncIterable<AttentionBox>

export type AttentionGeneration = AsyncIterable<AttentionBox> & { text: string; abort(): void }

/** Starts generating right away and buffers boxes, so a later reader replays what already arrived and then follows the rest. */
export function startAttention(source: AttentionSource, text: string): AttentionGeneration {
  const controller = new AbortController()
  const boxes: AttentionBox[] = []
  const waiters = new Set<() => void>()
  let isDone = false

  consume()

  return {
    text,
    abort: () => controller.abort(),
    async *[Symbol.asyncIterator]() {
      for (let i = 0; ; i++) {
        while (i >= boxes.length) {
          if (isDone) return
          await new Promise<void>((resolve) => waiters.add(resolve))
        }
        yield boxes[i]
      }
    },
  }

  async function consume() {
    try {
      for await (const box of source(text, controller.signal)) {
        if (controller.signal.aborted) break
        boxes.push(box)
        notify()
      }
    } catch (error) {
      if (!controller.signal.aborted) console.error(error)
    } finally {
      isDone = true
      notify()
    }
  }

  function notify() {
    for (const resolve of waiters) resolve()
    waiters.clear()
  }
}
