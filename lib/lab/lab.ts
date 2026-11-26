// The steer-live lab ("Steer live" on the lesson canvas, and /steer): an explanation a model writes live, which the learner reads by
// dragging a knob through it and steers as it goes. Vendored from chuanqisun/spaceship and patched (see SOURCE.md).
// Upstream's main.ts ran once and owned its window. Here `createLab` runs one inside any element, so a page can hold several, each
// paused or running, at any size and inside a board that zooms it. Its markup is built here, its styles are lab.css (all under
// `.steer-lab`), and every position is in lab units (see space.ts).

import { layoutNextLine, prepareWithSegments, type PreparedTextWithSegments } from "@chenglou/pretext"
import type { SteerEnvelope, SteerEvent } from "../spaceship"
import { createHighlights } from "./highlights"
import { API_URL } from "./llm/cerebras"
import { centeredAt, type Point } from "./point"
import { createSpace } from "./space"
import { LAB_BUILD, PROMPT_STAMP } from "./stamp"
import { headingOf, sameSources, type ClipSteer, type LabClip, type Source } from "./story/prompt"
import { createAttentionKnobs } from "./text/attention-knobs"
import { caretAt, isAhead, pointAt, type Caret, type TextMetrics } from "./text/caret"
import { createConnections } from "./text/connections"
import type { AttentionBox } from "./text/attention"
import type { DimensionContext } from "./text/dimension"
import { makeDraggable } from "./text/drag"
import { createFutureKnobs, type SavedDial } from "./text/future-knobs"
import { onPressAndHold } from "./text/hold"
import { createKeywordRelevance } from "./text/keyword-relevance"
import { layoutLines } from "./text/layout"
import { createLeftRail } from "./text/left-rail"
import { liveAttention } from "./text/live-attention"
import { liveSource } from "./text/live-completion"
import { liveClipWays } from "./text/live-clip-ways"
import { liveDimension } from "./text/live-dimension"
import { liveInfluence } from "./text/live-influence"
import { liveRealization } from "./text/live-realization"
import { liveRelevance } from "./text/live-relevance"
import { createPointer, type Aim, type PointerTarget, type SelectionPreview, type Zone } from "./text/pointer"
import { wordSpans, type Span } from "./text/segments"
import { isSoundOn, openOutput, setSoundOn, type Sound } from "./text/sound/engine"
import { createSounds } from "./text/sound/sounds"
import { showStatus } from "./text/status-line"
import { storyLayoutOf, type StoryLayout } from "./text/story-layout"
import { domPointAt, textOffsetOf } from "./text/text-offsets"
import { createTextStream, type Steering } from "./text/text-stream"
import { countWords, firstWords, shownPrefix } from "./text/words"

export type { Source } from "./story/prompt"
export type { SavedDial } from "./text/future-knobs"

/**
 * Attention app patch: what a lab shows, to pick up from where it stopped (`resume`). `text`: all it has, past the knob too, starting with its `start`;
 * `words`: shown up to the knob; `boxes` and `dials` as they were.
 */
export type LabState = { text: string; words: number; boxes: AttentionBox[]; dials: SavedDial[] }

export type LabOptions = {
  /** What the explanation continues straight after: a topic line, then maybe the learner's draft and a bridge. Shown from the start, the knob after it, and never taken back: the knob can't be dragged into it. Blank: a heading on a default topic. */
  start: string
  /** Passages the learner clipped: every continuation is asked to keep to them. */
  sources?: Source[]
  /** Attention app patch: the clips the lab keeps to, read live, each offered in the dial through the "Clips" gateway. */
  clips?: () => LabClip[]
  /** Attention app patch: a clip's dial was set: write the steer (a weight, or a picked `use`) onto the note (which updates the sources and re-asks the text). */
  onClipSteer?: (id: string, steer: ClipSteer) => void
  /** The text shown up to the knob (see `text`), whenever it changes. */
  onText?: (text: string) => void
  /** What the learner did, for the study log; `envelope` says which lab session and prompts it came from. */
  onEvent?: (event: SteerEvent, envelope: SteerEnvelope) => void
  /** Escape pressed while the lab has focus. Its keys never reach the page around it, so this is how a host hears it. */
  onEscape?: () => void
  /** The route its text calls go to (the continuation, the keyword highlights, the dial menus): an OpenAI-style chat body in, an
      SSE stream of deltas back. Default: /api/spaceship/complete. */
  completeUrl?: string
  /**
   * Attention app patch: what a lab on the same `start` showed when it stopped, to pick up from there: the text past the start (the knob can go
   * back into it, as into anything it wrote), the knob where it was, the boxes and the dials. Without `text` (the start changed), only the
   * dials that still steered come back, and the text starts over.
   */
  resume?: Partial<LabState>
  /** Attention app patch: what it shows (see `resume`), once it settles after a change, and as it pauses or goes. */
  onState?: (state: LabState) => void
}

export type Lab = {
  /** Stops every model call and every timer that would start one, and silences the lab. What is shown stays, and can still be read. */
  pause(): void
  /** Picks up where the lab stopped. A lab runs from the start unless paused first. */
  resume(): void
  /** Attention app patch: replace the clipped passages the continuation keeps to. A real change re-asks the text past the knob at once. */
  setSources(sources: Source[]): void
  /** The text shown up to the knob, line breaks as written. Still answers after `destroy`, with the last text. */
  text(): string
  /** Attention app patch: what it shows, to resume from. */
  state(): LabState
  /** Removes the lab: its listeners, model calls, timers, sound and markup. Reports the session's close. */
  destroy(): void
}

const DWELL_MS = 100
/** Generated words kept ready past the knob: whenever fewer remain, the stream continues the text, appending, never rewriting. */
const BUFFER_WORDS = 300
/** A top-up that adds no words (the source failed or said nothing) is retried after this long, doubling each time up to `MAX_RETRY_MS`. */
const RETRY_MS = 1000
const MAX_RETRY_MS = 16000
/** Double click and hold: the second press, if it starts within `DOUBLE_PRESS_MS` of the first and is held still, opens the fan menu after 100 ms plus this sweep (500 ms in all). */
const HOLD_MS = 400
const DOUBLE_PRESS_MS = 400
/** Between the rail and the text column. */
const RAIL_GAP_PX = 12
/** Drag speed, in px per ms, at which the word tick is softest. */
const DRAG_SPEED_FULL = 1.2
/** Tray controls sit flush with each other and the lab's bottom edge, so their brackets are drawn just inside them. */
const TRAY_PAD_PX = -1
/** The launch event names the start's first line, at most this long. */
const MAX_PHRASE = 200
/** Attention app patch: `onState` waits this long after a change, so streaming and dragging don't report at every word. */
const STATE_MS = 800

/** The page the lab draws on, which scrolls in its box; the tray stays at the box's foot. */
const MARKUP = `
  <div class="lab-scroll">
    <div class="lab-page">
      <div class="rail" aria-hidden="true"></div>
      <div class="text"></div>
      <svg class="links" aria-hidden="true">
        <path class="attention-links" />
        <path class="attention-active-link" />
        <g class="future-hud"></g>
        <path class="future-links" />
        <path class="future-tuned-link" />
      </svg>
      <button
        class="knob main-knob"
        type="button"
        aria-label="drag to scrub the text forward or back, double click to expand attention highlights or remove everything attached, double click and hold to open the fan menu"
      ></button>
      <div class="cursor" aria-hidden="true"></div>
      <footer class="tray">
        <output class="status" aria-live="off"></output>
        <button class="sound-toggle" type="button" aria-pressed="true" aria-label="sound">♪<b>on</b></button>
      </footer>
    </div>
  </div>`

/** Runs a lab in `root`, which it fills: the lab lays itself out for whatever size `root` is, and keeps up as it changes. */
export function createLab(
  root: HTMLElement,
  { start: given, sources = [], clips = () => [], onClipSteer = () => {}, onText, onEvent, onEscape, completeUrl = API_URL, resume, onState }: LabOptions,
): Lab {
  const start = given.trim() ? given : headingOf("")
  const startWords = countWords(start)
  // Attention app patch: the clipped passages the continuation keeps to, replaced live as the learner clips or unclips (setSources).
  let liveSources = sources
  /** Attention app patch: the text a lab on this start had, which this one carries on with. */
  const resumed = resume?.text?.startsWith(start) ? resume.text : undefined
  const lifetime = new AbortController()
  const { signal } = lifetime
  root.classList.add("steer-lab")
  root.tabIndex = -1
  root.innerHTML = MARKUP
  const part = <T extends Element = HTMLElement>(name: string) => root.querySelector<T>(`.${name}`)!

  const scroller = part("lab-scroll")
  const page = part("lab-page")
  const element = part("text")
  const handle = part<HTMLButtonElement>("main-knob")
  const statusElement = part("status")
  const soundToggle = part<HTMLButtonElement>("sound-toggle")
  const railElement = part("rail")
  const style = getComputedStyle(element)
  /** Measures where the first hidden word on the caret's line starts, in the text's font. */
  const measure = document.createElement("canvas").getContext("2d")!
  const space = createSpace(root, scroller, page)
  const highlights = createHighlights()
  const output = openOutput()
  const sounds = createSounds(output, (x) => (x / Math.max(1, page.clientWidth)) * 2 - 1)

  // Attention app patch: what the learner does here goes to the host (onEvent), which files it in the study log.
  const session = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const envelope: SteerEnvelope = { session, schema: 1, build: LAB_BUILD, prompt: PROMPT_STAMP }
  let startedAt = 0
  let mostWords = 0
  let dialsSet = 0
  let isClosed = false

  /** Whether the fonts have loaded and the text is laid out: until then the hand moves nothing. */
  let isStarted = false
  /** Whether the host wants the lab running (`resume`) or not (`pause`). */
  let wantsToRun = true
  /** Whether it is running now: model calls go ahead and it sounds. */
  let isRunning = false
  let isDestroyed = false
  /** Model calls asked for while the lab is not running wait here. */
  const waiting = new Set<() => void>()

  let caret: Caret = { line: 0, x: 0 }
  let shownText = ""
  /** What `text()` answers. */
  let visibleText = start
  let story: StoryLayout = { content: "", text: "", combined: "", sentences: [] }
  let railFrame: number | undefined
  let shownCount: number | undefined
  /** Words shown where the knob last rested, or where a drag back last discarded the text past it. */
  let restCount = 0
  let restTimer: number | undefined
  /** A drag back discarded the text past the knob; it is generated again only once the knob rests, not at every word on the way. */
  let isRegenerationHeld = false
  let dwellTimer: number | undefined
  /** Counts dwells, so requests deferred by an older one are dropped. */
  let dwellCount = 0
  let topUpTimer: number | undefined
  let retryTimer: number | undefined
  let retryAt = 0
  let retryMs = RETRY_MS
  let isFutureStale = false
  let prepared: { text: string; font: string; layout: PreparedTextWithSegments } | undefined
  let holdSound: Sound | undefined
  /** The text, and words shown, before a drag back started discarding it; reported once the knob rests. */
  let dragBack: { text: string; count: number } | undefined
  /** Whether the current press opened the fan menu, so its double click does not also expand or collapse. */
  let didHold = false
  /** The previous drag point, for how fast the knob moves. */
  let lastDrag: { point: Point; at: number } | undefined
  let stateTimer: number | undefined

  const reportSteer = (event: SteerEvent) => {
    if (event.type === "dial" && event.on) dialsSet++
    try {
      onEvent?.(event, envelope)
    } catch (error) {
      console.error(error) // reporting must never break the lab
    }
  }
  const stream = createTextStream(gatedText(liveSource(start, () => liveSources, completeUrl)), render, start, resumed)
  const rail = createLeftRail(railElement)
  const connections = createConnections({ source: gated(liveInfluence), onChange: refreshRail })
  const relevance = createKeywordRelevance(gated(liveRelevance), refreshRail)
  const attention = createAttentionKnobs({
    source: gated((text: string, signal: AbortSignal) => liveAttention(completeUrl, text, signal)),
    space,
    sounds,
    highlights,
    signal,
    textElement: element,
    knob: handle,
    linkPath: part<SVGPathElement>("attention-links"),
    activeLinkPath: part<SVGPathElement>("attention-active-link"),
    isPastEnd: (point) => isAhead(caretAt(point, metricsOf()), caret),
    onChange: invalidateFuture,
    onHover: (phrase) => {
      connections.focusPhrase(phrase)
      refreshRail()
    },
    onPaint: refreshRail,
  })
  const futureKnobs = createFutureKnobs({
    page,
    space,
    sounds,
    highlights,
    mainKnob: handle,
    linkPath: part<SVGPathElement>("future-links"),
    tunedLinkPath: part<SVGPathElement>("future-tuned-link"),
    hud: part<SVGGElement>("future-hud"),
    source: gated((context: DimensionContext, signal: AbortSignal) => liveDimension(completeUrl, context, signal)),
    clips,
    clipWays: async (clip: { quote: string; around: string }, signal: AbortSignal) => {
      await whenRunning(signal) // a paused lab makes no model calls, even if the fan is open over it
      return liveClipWays(completeUrl, clip, signal)
    },
    onClipSteer,
    realization: gated(liveRealization),
    textElement: element,
    context: () => ({ text: shownText, leads: attention.leads() }),
    onChange: invalidateFuture,
    report: reportSteer,
  })

  soundToggle.addEventListener("click", () => {
    setSoundOn(!isSoundOn())
    showSoundToggle()
  })
  // Keys pressed in the lab stay in it, as they did in its frame: a board around it must not take them for its shortcuts.
  root.addEventListener(
    "keydown",
    (event) => {
      event.stopPropagation()
      if (event.key === "Escape") onEscape?.()
    },
    { signal },
  )
  // The page scrolls itself until it reaches an end; past that the wheel goes on to what holds the lab (on the board, it moves the board).
  scroller.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.deltaY === 0) return
      const room = event.deltaY < 0 ? scroller.scrollTop > 0 : scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1
      if (room) event.stopPropagation()
    },
    { passive: true, signal },
  )

  // A quick double click expands or collapses; one whose second press was held opened the fan menu instead.
  handle.addEventListener("dblclick", () => (didHold ? (didHold = false) : detachAllOrExpand()))
  handle.addEventListener("pointerenter", (event) => event.buttons || sounds.knobHover(pointOf(event).x))
  handle.addEventListener("pointerdown", (event) => {
    didHold = false
    sounds.knobGrab(pointOf(event).x)
  })
  onPressAndHold(
    handle,
    space,
    HOLD_MS,
    (press) => {
      didHold = true
      futureKnobs.spawn(pointOf(press), press.pointerId)
    },
    {
      onSweep: () => (holdSound = sounds.holdSweep(space.circle(handle).center.x, HOLD_MS / 1000)),
      onSweepEnd: (completed) => completed || holdSound?.stop(),
      secondPressWithin: DOUBLE_PRESS_MS,
    },
  )
  // Dragging scrubs at once, forward or back.
  makeDraggable(handle, space, {
    onDrag: (point) => {
      handle.toggleAttribute("data-dragging", true)
      const before = shownCount
      moveTo(point)
      discardIfBehindRest()
      soundWordsCrossed(before, point)
    },
    onDrop: () => {
      if (handle.hasAttribute("data-dragging")) sounds.knobRelease(space.circle(handle).center.x)
      handle.removeAttribute("data-dragging")
      lastDrag = undefined
    },
  })

  const pointer = createPointer({
    root,
    scroller,
    layer: part("cursor"),
    space,
    signal,
    targets: pointerTargets,
    isDragging: () => handle.hasAttribute("data-dragging") || page.querySelector(".future[data-dragging]") !== null || attention.isDragging(),
    zoneAt,
    caretAt: caretBoxAt,
    selection: selectionPreview,
    aim: aimAt,
    pull: pullToward,
  })

  const resizing = new ResizeObserver(relayout)
  resizing.observe(root)
  document.fonts
    .load(style.font)
    .catch(() => undefined)
    .then(begin)

  return { pause, resume: carryOn, setSources, text: () => visibleText, state, destroy }

  /** Once the font is in: lays the start out with the knob after it, reports the launch, and runs unless paused already. */
  function begin() {
    if (isDestroyed) return
    isStarted = true
    startedAt = performance.now()
    measure.font = style.font
    reportSteer({ type: "launch", phrase: phraseOf(start) })
    addEventListener("pagehide", reportClose, { signal })
    showSoundToggle()
    const knobWords = resumed ? Math.min(Math.max(resume?.words ?? 0, startWords), countWords(resumed)) : countWords(stream.text)
    moveTo(pointAt(caretAfterWords(knobWords) ?? caret, metricsOf()))
    restCount = shownCount ?? 0
    // Attention app patch: what it had when it stopped. Pinned dials and boxes only over the same text.
    if (resumed) attention.restore(resume?.boxes ?? [])
    futureKnobs.restore((resume?.dials ?? []).filter((dial) => resumed || !dial.pinned))
    report()
    // a long start would leave the knob below the box: bring it into view, near the top
    const knobTop = space.circle(handle).center.y
    if (knobTop > scroller.clientHeight * 0.7) scroller.scrollTop = knobTop - scroller.clientHeight / 3
    if (wantsToRun) go()
  }

  function pause() {
    wantsToRun = false
    halt()
  }

  function carryOn() {
    wantsToRun = true
    if (isStarted) go()
  }

  /** Runs: waiting model calls go ahead, sound plays, and the text, its highlights and dials pick up where they stopped. */
  function go() {
    if (isRunning || isDestroyed) return
    isRunning = true
    for (const release of waiting) release()
    waiting.clear()
    output.setAudible(true)
    showSoundToggle()
    connections.resume()
    relevance.resume()
    futureKnobs.resume()
    restartDwell()
    scheduleTopUp() // text it didn't ask for while paused (or that a pause cut short), asked for now
    report()
  }

  /** Stops every model call under way and the timers that would start more, and goes quiet. Whatever the hand does meanwhile asks nothing. */
  function halt() {
    if (!isRunning) return
    isRunning = false
    cancelAll()
    output.setAudible(false)
    report()
    tellState()
  }

  /** Attention app patch: what it shows, to resume from. Before it has started, what it was given. */
  function state(): LabState {
    if (!isStarted) return { text: stream.text, words: resume?.words ?? countWords(stream.text), boxes: resume?.boxes ?? [], dials: resume?.dials ?? [] }
    return { text: stream.text, words: shownCount ?? startWords, boxes: attention.saved(), dials: futureKnobs.saved() }
  }

  function scheduleState() {
    if (!onState || !isStarted) return
    clearTimeout(stateTimer)
    stateTimer = window.setTimeout(tellState, STATE_MS)
  }

  function tellState() {
    clearTimeout(stateTimer)
    stateTimer = undefined
    if (!onState || !isStarted) return
    try {
      onState(state())
    } catch (error) {
      console.error(error) // the host's trouble must never break the lab
    }
  }

  /** Cancels the model calls under way or waiting to run, and the timers that would ask for more. */
  function cancelAll() {
    for (const timer of [dwellTimer, topUpTimer, retryTimer]) clearTimeout(timer)
    dwellTimer = topUpTimer = retryTimer = undefined
    stream.stop()
    attention.pause()
    futureKnobs.pause()
    connections.pause()
    relevance.pause()
  }

  /** May come after the host took the lab out of the page (React does that before its cleanups run), so nothing here lays it out. */
  function destroy() {
    if (isDestroyed) return
    tellState()
    reportClose()
    isDestroyed = true
    isRunning = false
    cancelAll()
    lifetime.abort()
    resizing.disconnect()
    clearTimeout(restTimer)
    if (railFrame !== undefined) cancelAnimationFrame(railFrame)
    pointer.destroy()
    highlights.clear()
    output.close()
    root.replaceChildren()
    root.classList.remove("steer-lab")
    root.removeAttribute("tabindex")
  }

  /** Once per session: when the lab goes, or the page with it (lib/events.ts sends what is logged as the page goes at once). */
  function reportClose() {
    if (!isStarted || isClosed) return
    isClosed = true
    reportSteer({ type: "close", secs: Math.round((performance.now() - startedAt) / 1000), words: mostWords, dials: dialsSet })
  }

  /**
   * `source` (a model call that streams, its signal last), held while the lab is not running: it starts once the lab runs, or never if
   * its signal aborts first.
   */
  function gated<A extends unknown[], T>(source: (...args: [...A, AbortSignal]) => AsyncIterable<T>) {
    return async function* (...args: [...A, AbortSignal]): AsyncGenerator<T> {
      await whenRunning(args[args.length - 1] as AbortSignal)
      yield* source(...args)
    }
  }

  function gatedText(source: ReturnType<typeof liveSource>): ReturnType<typeof liveSource> {
    return { expand: source.expand, complete: gated(source.complete) }
  }

  function whenRunning(signal: AbortSignal) {
    if (isRunning) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener("abort", cancel)
        resolve()
      }
      const cancel = () => {
        waiting.delete(ready)
        reject(signal.reason)
      }
      if (signal.aborted) return cancel()
      waiting.add(ready)
      signal.addEventListener("abort", cancel, { once: true })
    })
  }

  /** The box changed size, and the column with it: the same words are laid out again, the knob after the last one. Not while out of the page. */
  function relayout() {
    if (!isStarted || isDestroyed || !root.isConnected) return
    attention.relayout()
    moveTo(pointAt(caretAfterWords(shownCount ?? 0) ?? caret, metricsOf()))
  }

  /** The knob stops at the column's right edge, as no line reaches past it. */
  function moveTo({ x, y }: Point) {
    if (!isStarted) return
    const { left } = space.rect(element.getBoundingClientRect())
    let point = { x: Math.min(x, left + columnWidth()), y }
    caret = caretAt(point, metricsOf())
    // The start is the floor: the knob never goes back into it, so the learner's own words are never cut.
    const floor = caretAfterWords(startWords)
    if (floor && isAhead(floor, caret)) {
      caret = floor
      point = pointAt(floor, metricsOf())
    }
    handle.style.translate = centeredAt(point, handle.offsetWidth)
    render()
    restartRest()
  }

  /** The knob rests once it has not moved for `DWELL_MS`; the text past it is then generated again if a drag back discarded it. */
  function restartRest() {
    clearTimeout(restTimer)
    restTimer = window.setTimeout(() => {
      reportDragBack()
      restCount = shownCount ?? 0
      isRegenerationHeld = false
      topUp()
    }, DWELL_MS)
  }

  /** Dragging back far enough to hide the word the knob rested on means the reader wants another continuation, so the text past the knob is discarded at once. */
  function discardIfBehindRest() {
    const count = shownCount ?? 0
    if (count >= restCount) return
    dragBack ??= { text: stream.text, count: restCount }
    stream.truncate(count)
    restCount = count
    isRegenerationHeld = true
  }

  /** One report per drag back, where the knob came to rest, not one per word on the way. */
  function reportDragBack() {
    if (!dragBack) return
    const at = shownCount ?? 0
    const { text, count } = dragBack
    dragBack = undefined
    if (count <= at) return
    const discarded = firstWords(text, count).slice(firstWords(text, at).length).trim()
    reportSteer({ type: "dragback", words: count - at, discarded: discarded.slice(0, 600) })
  }

  function detachAllOrExpand() {
    if (!attention.isExpanded() && !futureKnobs.count()) return revealAttention()
    sounds.collapse(space.circle(handle).center.x)
    attention.collapse()
    futureKnobs.clear()
  }

  /** The continuation generated alongside the prefetched boxes was not led by them, so it is replaced as soon as they are all shown. */
  async function revealAttention() {
    await attention.expand()
    regenerateFuture()
    afterStreaming(futureKnobs.preload)
  }

  /** Lays out the text up to the knob. Not once the lab is gone: out of the page, its text has no font to measure. */
  function render() {
    if (!isStarted || isDestroyed) return
    const lines = layoutLines(prepareWords(), caret, columnWidth())
    const text = lines.join(" ")
    const count = countWords(text)

    if (count !== shownCount) restartDwell()
    shownCount = count
    mostWords = Math.max(mostWords, count)
    scheduleTopUp()
    story = storyLayoutOf(lines, stream.text)
    if (element.textContent !== story.content) element.textContent = story.content
    connections.update(story)
    shownText = text
    attention.update(text)
    futureKnobs.follow(story)
    report()
    showText(shownPrefix(stream.text, lines) ?? firstWords(stream.text, count))
    scheduleState()
  }

  /** The text up to the knob as written (line breaks and all), unlike `shownText`, which is laid out. */
  function showText(text: string) {
    if (text === visibleText) return
    visibleText = text
    try {
      onText?.(text)
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * Attention app patch: the learner clipped or unclipped a passage while the lab is open. The new list leads every continuation from now on,
   * and the text past the knob is written again from it, the same way a steering change is. A list equal to the one in force changes nothing.
   */
  function setSources(next: Source[]) {
    if (sameSources(next, liveSources)) return
    liveSources = next
    invalidateFuture()
  }

  /** The text after the knob was steered by the previous boxes and future knobs, so it is regenerated once they settle. */
  function invalidateFuture() {
    refreshRail()
    isFutureStale = true
    restartDwell()
    report()
    scheduleState()
  }

  /** Shows whether the model is generating and how full the buffer past the knob is, on the knob and in the status line, with what the text holds and is steered by. */
  function report() {
    const activity = stream.activity()
    const buffer = Math.max(0, countWords(stream.text) - (shownCount ?? 0))
    handle.toggleAttribute("data-generating", activity.isGenerating)
    handle.style.setProperty("--lab-buffer", `${Math.min(1, buffer / BUFFER_WORDS)}`)
    showStatus(statusElement, {
      ...activity,
      words: shownCount ?? 0,
      buffer,
      boxes: attention.leads().length,
      steering: futureKnobs.controls().length,
      pinned: futureKnobs.pinnedCount(),
    })
  }

  function restartDwell() {
    clearTimeout(dwellTimer)
    const dwell = ++dwellCount
    if (!isRunning) return
    dwellTimer = window.setTimeout(() => {
      if (isFutureStale) regenerateFuture()
      else topUp()
      afterStreaming(() => {
        if (dwell !== dwellCount) return
        attention.prefetch()
        futureKnobs.preload()
      })
    }, DWELL_MS)
  }

  /**
   * Runs `request` once the continuation is streaming, if the lab still runs. Keyword highlights and future knob menus share the text API's rate limit,
   * and the continuation is what the reader waits for, so it is always asked first.
   */
  function afterStreaming(request: () => void) {
    stream.streaming().then(() => isRunning && request())
  }

  function regenerateFuture() {
    isFutureStale = false
    restCount = shownCount ?? 0
    stream.regenerate(shownCount ?? 0, "steering changed", steering())
  }

  function steering(): Steering {
    return { leads: attention.leads(), controls: futureKnobs.controls() }
  }

  /**
   * Keeps at least `BUFFER_WORDS` generated words past the knob, continuing the text from its end whenever fewer remain.
   * Asked after every change, but run on the next task, after a finished generation has reported how it went.
   */
  function scheduleTopUp() {
    if (!isRunning) return
    topUpTimer ??= window.setTimeout(() => {
      topUpTimer = undefined
      topUp()
    })
  }

  function topUp() {
    if (!isRunning || isRegenerationHeld || stream.activity().isGenerating || performance.now() < retryAt) return
    const words = countWords(stream.text)
    if (words - (shownCount ?? 0) >= BUFFER_WORDS) return
    stream.generate("buffer low", steering()).then(
      (outcome) => outcome === "done" && settleTopUp(words),
      (error) => (console.error(error), settleTopUp(words)),
    )
  }

  /** A top-up that added words resets the retry delay; one that added none waits before trying again, longer each time. */
  function settleTopUp(wordsBefore: number) {
    if (isDestroyed) return
    if (countWords(stream.text) > wordsBefore) {
      retryMs = RETRY_MS
      retryAt = 0
      return scheduleTopUp()
    }
    retryAt = performance.now() + retryMs
    clearTimeout(retryTimer)
    retryTimer = window.setTimeout(scheduleTopUp, retryMs)
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
  }

  function prepareWords() {
    const text = stream.text
    const font = style.font
    if (prepared?.text !== text || prepared.font !== font) prepared = { text, font, layout: prepareWithSegments(text, font) }
    return prepared.layout
  }

  /** The column's width in lab units, unrounded unlike `clientWidth`: a line that fills the column exactly measures a hair wider than the rounded width. */
  function columnWidth() {
    return parseFloat(style.width)
  }

  /** What the pointer frames as the hand nears it: the main knob (labelled with its word count), each future knob, each attention box line by line (labelled with its relevance), and the tray's sound toggle. */
  function pointerTargets(): PointerTarget[] {
    const leads = attention.leads()
    return [
      { rects: [space.rect(handle.getBoundingClientRect())], pad: 5, wake: handle, label: () => `<b>${shownCount ?? 0}</b> words` },
      ...[...page.querySelectorAll<HTMLElement>(".future")].map((knob) => ({ rects: [space.rect(knob.getBoundingClientRect())], pad: 5 })),
      ...attention.spans().map(({ phrase }, i) => ({
        rects: rectsOf(phrase),
        pad: 3,
        label: () => {
          const { relevance: value, isMeasuring } = relevance.relevanceOf(leads[i])
          return isMeasuring ? "box <b>··</b>" : value === undefined ? "box" : `box <b>${value >= 1 ? "1.0" : value.toFixed(2).replace(/^0/, "")}</b>`
        },
      })),
      { rects: [space.rect(soundToggle.getBoundingClientRect())], pad: TRAY_PAD_PX, isHotOnHover: true, wake: soundToggle },
    ]
  }

  /** The lab boxes of a span of the shown text, one per line it covers. */
  function rectsOf({ start, end }: Span) {
    const range = document.createRange()
    range.setStart(...domPointAt(element, start))
    range.setEnd(...domPointAt(element, end))
    return [...range.getClientRects()].filter(({ width }) => width > 0).map(space.rect)
  }

  /**
   * What lies under the lab point: knobs, controls and the tray have gestures of their own; past the main knob there is no text yet,
   * so the page there is where a press steers; before it, the shown text selects, except an attention box, which drags.
   */
  function zoneAt(target: Element, point: Point): Zone {
    if (attention.isDragging()) return "box"
    if (!root.contains(target) || target.closest(".knob, button, a, .tray")) return "other"
    if (isAhead(caretAt(point, metricsOf()), caret)) return "ahead"
    if (!element.contains(target)) return "other"
    return attention.isOverBox(point) ? "box" : "text"
  }

  /** The caret between characters nearest the lab point, line-high, while over the shown text. */
  function caretBoxAt(point: Point) {
    const { x, y } = space.client(point)
    const position = document.caretPositionFromPoint(x, y)
    if (!position || !element.contains(position.offsetNode)) return
    return caretBoxOf(position.offsetNode, position.offset)
  }

  /** A line-high box at zero width where the caret before character `offset` of `node` sits, in lab units. */
  function caretBoxOf(node: Node, offset: number) {
    const range = document.createRange()
    range.setStart(node, offset)
    const rect = space.rect(range.getClientRects()[0] ?? range.getBoundingClientRect())
    const { top, lineHeight } = metricsOf()
    const line = Math.floor((rect.top + rect.height / 2 - top) / lineHeight)
    return new DOMRect(rect.left, top + line * lineHeight, 0, lineHeight)
  }

  /** While a selection is made in the text: carets at its ends, and the whole words it will become as a box (as the attention box from a selection rounds it). */
  function selectionPreview(): SelectionPreview | undefined {
    const selection = getSelection()
    if (!selection?.rangeCount || selection.isCollapsed || !selection.anchorNode || !selection.focusNode || !element.contains(selection.anchorNode)) return
    const range = selection.getRangeAt(0)
    const start = textOffsetOf(element, range.startContainer, range.startOffset)
    const end = textOffsetOf(element, range.endContainer, range.endOffset)
    const words = wordSpans(shownText)
    const first = words.findIndex((word) => word.end > start)
    const last = words.findLastIndex((word) => word.start < end)
    return {
      anchor: caretBoxOf(selection.anchorNode, selection.anchorOffset),
      focus: caretBoxOf(selection.focusNode, selection.focusOffset),
      words: first === -1 || last < first ? [] : rectsOf({ start: words[first].start, end: words[last].end }),
    }
  }

  /** Where the main knob would stop for the lab point: how many words ahead (or behind) that is, and the box of the last word it shows now. */
  function aimAt(point: Point): Aim | undefined {
    if (!isStarted) return
    const width = columnWidth()
    const target = caretAt(point, metricsOf())
    const lines = layoutLines(prepareWords(), { line: target.line, x: Math.min(target.x, width) }, width)
    return {
      gap: countWords(lines.join(" ")) - (shownCount ?? 0),
      tip: tipRect(),
      knob: space.circle(handle).center,
    }
  }

  /** The lab box of the last word the main knob shows. */
  function tipRect() {
    const caret = caretAfterWords(shownCount ?? 0)
    return caret && lastWordRect(layoutLines(prepareWords(), caret, columnWidth()))
  }

  /** The lab box of the last word of `lines`, laid out in the column. */
  function lastWordRect(lines: string[]) {
    const index = lines.findLastIndex((line) => line.trim())
    if (index === -1) return
    const line = lines[index].trimEnd()
    const word = line.slice(line.lastIndexOf(" ") + 1)
    const { left, top, lineHeight } = metricsOf()
    const x = left + measure.measureText(line.slice(0, line.length - word.length)).width
    return new DOMRect(x, top + index * lineHeight, measure.measureText(word).width, lineHeight)
  }

  /** Steering: moves the main knob `words` further along the reading order, as if dragged there, ticking once per word. */
  function pullToward(_point: Point, words: number) {
    const next = caretAfterWords((shownCount ?? 0) + words)
    if (!next) return
    const before = shownCount
    const point = pointAt(next, metricsOf())
    moveTo(point)
    soundWordsCrossed(before, point)
  }

  /** The caret that shows exactly `count` words, or undefined while the text holds fewer. */
  function caretAfterWords(count: number): Caret | undefined {
    const width = columnWidth()
    const layout = prepareWords()
    let cursor
    let seen = 0
    for (let line = 0; ; line++) {
      const next = layoutNextLine(layout, width, cursor)
      if (!next) return
      const words = countWords(next.text)
      if (seen + words >= count) return { line, x: Math.min(width, measure.measureText(firstWords(next.text, count - seen)).width + 1) }
      seen += words
      cursor = next.end
    }
  }

  /** Redraws the rail beside the text once per frame, however many changes ask for it. */
  function refreshRail() {
    railFrame ??= requestAnimationFrame(() => {
      railFrame = undefined
      const leads = attention.leads()
      relevance.update(story, leads)
      const { left, top } = metricsOf()
      railElement.style.translate = `${left - railElement.offsetWidth - RAIL_GAP_PX}px ${top}px`
      rail.show({
        lines: lineSpansOf(story.content),
        boxes: attention.spans().map((spans, i) => ({ ...spans, ...relevance.relevanceOf(leads[i]) })),
        connection: connections.current(),
      })
    })
  }

  /** Each line's span of the text, where lines are joined by single spaces. */
  function lineSpansOf(content: string): Span[] {
    let start = 0
    return content.split("\n").map((line) => {
      const span = { start, end: start + line.length }
      start = span.end + 1
      return span
    })
  }

  /** Ticks once per word the dragged knob reveals or removes; words arriving from the generator are silent. */
  function soundWordsCrossed(before: number | undefined, point: Point) {
    const now = performance.now()
    const speed = lastDrag ? Math.hypot(point.x - lastDrag.point.x, point.y - lastDrag.point.y) / Math.max(1, now - lastDrag.at) / DRAG_SPEED_FULL : 0
    lastDrag = { point, at: now }
    if (before !== undefined && shownCount !== undefined && shownCount !== before)
      sounds.word(Math.sign(shownCount - before), Math.abs(shownCount - before), speed, point.x)
  }

  function showSoundToggle() {
    const isOn = isSoundOn()
    soundToggle.setAttribute("aria-pressed", `${isOn}`)
    soundToggle.querySelector("b")!.textContent = isOn ? "on" : "off"
  }

  /** Read on every use, since the column moves with the box, and its zoom changes how the screen sees it. In lab units. */
  function metricsOf(): TextMetrics {
    const { left, top } = space.rect(element.getBoundingClientRect())
    return { left, top: top + parseFloat(style.paddingTop), lineHeight: parseFloat(style.lineHeight) }
  }

  function pointOf({ clientX, clientY }: { clientX: number; clientY: number }) {
    return space.point(clientX, clientY)
  }
}

/** The launch event's phrase: the start's first line, without the colon a heading ends in. */
function phraseOf(start: string) {
  return (start.trim().split("\n")[0] ?? "").trim().replace(/:$/, "").slice(0, MAX_PHRASE)
}
