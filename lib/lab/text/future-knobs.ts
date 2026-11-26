import type { SteerEvent } from "../../spaceship"
import { CLIP_WEIGHTS, type ClipSteer, type LabClip } from "../story/prompt"
import type { Highlights } from "../highlights"
import type { Point } from "../point"
import type { Space } from "../space"
import type { Lead } from "./attention"
import { strengthLevelOf, optionIndexAt, valueOf, type Control, type Dimension, type DimensionSource } from "./dimension"
import { makeDraggable } from "./drag"
import { axisFor } from "./fan-axis"
import { GRADUATIONS, hudNodesOf, NUMBERED_EVERY, RULER_STEPS, STRENGTH_RANGE_PX, SWING_RADIANS, type ReadoutPart } from "./future-hud"
import { linkBetween, pathOf } from "./links"
import { placeInRightMargin } from "./margin-pins"
import type { RealizationSource } from "./realization"
import { createRealizationTracker, type Tracking } from "./realization-tracker"
import type { Span } from "./segments"
import type { Sound } from "./sound/engine"
import type { DragBed, Sounds } from "./sound/sounds"
import { sentenceAt, type StoryLayout } from "./story-layout"
import { domPointAt } from "./text-offsets"

const PENDING_VALUE = "…"
/** Attention app patch: a clip dial's fallback options, in the same order as CLIP_WEIGHTS, shown capitalised in the fan. */
const WEIGHT_LABELS = CLIP_WEIGHTS.map((w) => w[0].toUpperCase() + w.slice(1))
/** Attention app patch: the first option of every clip dial, weight scale or ways: swinging to it drops the clip from the prompt. */
const IGNORE_LABEL = WEIGHT_LABELS[0]
/** Distances beyond touching the main knob: nearer than the dead zone no dimension is a candidate; at the gate the candidate is chosen. */
const MENU_DEAD_ZONE_PX = 24
const MENU_GATE_PX = 96
/** Once the sentence under the main knob delivers a knob's control this surely, the knob pins to it. */
const REALIZED_CONFIDENCE = 0.8
/** Must match the `::highlight(lab-pinned-sentence)` rule in lab.css. */
const PINNED_HIGHLIGHT = "pinned-sentence"
/** A menu that arrives sooner than this was already on its way, so the knob neither sounds loading nor ready. */
const MENU_LOADING_GRACE_MS = 60
/** Drag speed, in px per ms, at which the drag's click train is loudest. */
const DRAG_SPEED_FULL = 1.2
/** At most this many graduation ticks per move, however far the knob jumps. */
const MAX_TICKS_PER_MOVE = 4
/** Both presses of a double click on a knob fall within this long, as does the release that completes it. */
const DOUBLE_CLICK_MS = 500

type FutureKnobsOptions = {
  /** The lab's page, which knobs are added to. */
  page: HTMLElement
  space: Space
  sounds: Sounds
  highlights: Highlights
  mainKnob: HTMLElement
  /** Draws each future knob's link, from the main knob's circumference to the knob's. */
  linkPath: SVGPathElement
  /** Draws the link of the knob being tuned, so the other links can dim. */
  tunedLinkPath: SVGPathElement
  /** Holds the rim and labels of the one knob being dragged or hovered. */
  hud: SVGGElement
  source: DimensionSource
  realization: RealizationSource
  /** Attention app patch: the clipped passages the lab keeps to, read live. Each is offered in the fan as a dial reached through the "Clips" gateway. */
  clips: () => LabClip[]
  /** Attention app patch: the model's suggested ways to use one clipped passage, fetched when the learner crosses into its dial. */
  clipWays: (clip: { quote: string; around: string }, signal: AbortSignal) => Promise<string[] | undefined>
  /** Attention app patch: a clip's dial was set: write the steer (a weight, or a picked `use`) onto the note (which re-asks the text through its sources). */
  onClipSteer: (id: string, steer: ClipSteer) => void
  /** Pinned knobs sit in the margins beside it, level with their sentence. */
  textElement: HTMLElement
  context: () => { text: string; leads: Lead[] }
  /** Called when what the knobs steer changes: a knob's setting (its value in words and strength level), or a knob pinning. */
  onChange: () => void
  /** Attention app patch: dials set, deleted and pinned, for the study log (see ../lab.ts). */
  report: (event: SteerEvent) => void
}

/** Where a knob was last dragged to relative to the fan: `swing` is its angle from the axis and sets the value, `distance` from the main knob sets the strength. */
type Place = { swing: number; distance: number }

type Menu = { key: string; controller: AbortController; dimensions: Promise<Dimension[] | undefined> }

/** Attention app patch: a dial that had a dimension, as a lab that stopped keeps it, to show it again (`restore`). */
export type SavedDial = { dimension: Dimension; point: Point; place: Place; pinned?: Span; confidence?: number; parkedAt?: number }

type FutureKnob = {
  element: HTMLElement
  label: HTMLElement
  /** Where the knob stays on the lab's page, whatever the main knob does afterwards. */
  point: Point
  /** Read off when the knob is dragged, so its value and strength hold when the main knob moves away. */
  place: Place
  /** Offered while choosing; undefined until loaded. */
  menu?: Dimension[]
  /** The menu index the knob has stayed on since it left the dead zone. */
  candidate?: number
  /** How far the knob has travelled toward the gate while choosing, from 0 to 1. */
  progress: number
  /** Attention app patch: the distance a submenu fans from (where its gateway was chosen); undefined at the top level (the main knob). */
  gateBase?: number
  /** The chosen dimension; a knob without one is choosing, one with it is tuning. */
  dimension?: Dimension
  setting?: string
  isDragging: boolean
  isHovered: boolean
  controller: AbortController
  /** Set once a tuned knob is dropped, until it is dragged again or pins. */
  tracking?: Tracking
  /** How surely the sentence under the main knob delivers the knob's control, once scored. */
  confidence?: number
  /** The sentence that delivered the control: the knob sits in the margin beside it, labelled, and no longer steers. */
  pinned?: Span
  /** Set once the text grows over the dropped knob: it waits in the right gutter, level with this lab y, still steering and linked, until it pins. */
  parkedAt?: number
  sound: KnobSound
}

/** What a knob sounds while it lives. */
type KnobSound = {
  /** Starts the loading sound unless the menu arrives first. */
  loadingTimer?: number
  loading?: Sound
  /** The click train while dragged. */
  bed?: DragBed
  /** Whether the knob moved since it was pressed; a click without moving does not hand off. */
  hasMoved: boolean
  lastDrag?: { point: Point; at: number }
  /** The graduation, option and strength step last sounded while tuning. */
  marks?: { graduation: number; option: number; step: number }
}

/**
 * Future knobs are draggable dials linked to the main knob; each tunes one dimension of the upcoming text.
 * A new knob first offers a menu of dimensions, one sector of the fan each, and carrying the knob through the gate chooses the one in its direction.
 * Then the knob's swing around the main knob picks the value and its distance sets the strength, until it is dropped: it stays there on the page and keeps its setting when the main knob moves.
 * Once dropped, a knob tracks whether the sentence under the main knob delivers its setting, its fill showing how surely, and moves into the margin beside the first sentence that surely does.
 * There it is pinned: unlinked and labelled, it no longer steers and cannot be dragged.
 * A pinned knob is removed when the main knob moves back before its sentence.
 * Double clicking a knob or dropping it onto the main knob deletes it.
 */
export function createFutureKnobs({
  page,
  space,
  sounds,
  highlights,
  mainKnob,
  linkPath,
  tunedLinkPath,
  hud,
  source,
  realization,
  clips,
  clipWays,
  onClipSteer,
  textElement,
  context,
  onChange,
  report,
}: FutureKnobsOptions) {
  const tracker = createRealizationTracker(realization, () => follow(story))
  let knobs: FutureKnob[] = []
  let preloaded: Menu | undefined
  let axis = 0
  let story: StoryLayout = { content: "", text: "", combined: "", sentences: [] }
  const hudStyle = getComputedStyle(hud)

  return {
    preload,
    spawn,
    clear,
    count: () => knobs.length,
    pinnedCount: () => knobs.filter((knob) => knob.pinned).length,
    follow,
    controls,
    pause,
    resume,
    saved,
    restore,
  }

  function saved(): SavedDial[] {
    // Clip dials are not saved: the weight lives on the note, and the dial is offered again from the clips next time.
    return knobs.flatMap(({ dimension, point, place, pinned, confidence, parkedAt }) =>
      dimension && !dimension.clip ? [{ dimension, point: { ...point }, place: { ...place }, pinned: pinned && { ...pinned }, confidence, parkedAt }] : [],
    )
  }

  /**
   * Shows dials a lab had, as they were: pinned ones beside their sentence (the text must be the same), the others where they were dropped,
   * steering again and watching for their sentence. Silent, and reports nothing: the learner set them before.
   */
  function restore(dials: SavedDial[]) {
    for (const dial of dials) {
      const element = knobElement()
      const knob: FutureKnob = {
        element,
        label: element.querySelector("span")!,
        point: { ...dial.point },
        place: { ...dial.place },
        progress: 1,
        dimension: dial.dimension,
        confidence: dial.confidence,
        isDragging: false,
        isHovered: false,
        controller: new AbortController(),
        sound: { hasMoved: false },
      }
      page.append(element)
      knobs.push(knob)
      attach(knob)
      knob.setting = settingOf(knob)
      if (dial.pinned) {
        knob.pinned = { ...dial.pinned }
        element.toggleAttribute("data-pinned", true)
      } else {
        if (dial.parkedAt !== undefined) {
          knob.parkedAt = dial.parkedAt
          element.toggleAttribute("data-parked", true)
        }
        startTracking(knob)
      }
    }
    layout()
  }

  /**
   * Stops every request the knobs make: the preloaded menu, a knob still choosing (it goes, as if dropped), and the scoring of dropped knobs,
   * which `resume` takes up again.
   */
  function pause() {
    preloaded?.controller.abort()
    preloaded = undefined
    for (const knob of [...knobs]) {
      if (!knob.dimension) remove(knob, { silent: true })
      else knob.tracking?.controller.abort()
    }
    tracker.pause()
  }

  function resume() {
    for (const knob of knobs) if (knob.tracking) knob.tracking = { ...knob.tracking, controller: new AbortController() }
    follow(story)
  }

  /** Takes the text as the main knob or the generator changed it: updates each tracking knob's confidence, pins those realized, and removes pinned ones the main knob moved back past. */
  function follow(next: StoryLayout) {
    story = next
    let hasPinned = false
    const newlyPinned: FutureKnob[] = []
    for (const knob of [...knobs]) {
      if (knob.pinned && story.text.length < knob.pinned.start) remove(knob)
      if (!knob.tracking) continue
      const realized = tracker.realizedUnderKnob(knob.tracking, story)
      if (realized && realized.confidence !== knob.confidence) sounds.realized(realized.confidence, knob.point.x)
      knob.confidence = realized?.confidence
      if (realized && realized.confidence >= REALIZED_CONFIDENCE) {
        pin(knob, realized.sentence)
        newlyPinned.push(knob)
        hasPinned = true
      }
    }
    tracker.score(
      knobs.flatMap((knob) => (knob.tracking ? [knob.tracking] : [])),
      story,
    )
    layout()
    for (const knob of newlyPinned) sounds.pin(knob.point.x)
    if (hasPinned) onChange()
  }

  /** Starts fetching the menu a new knob would get, unless one for the current context is already on its way. */
  function preload() {
    const key = keyOf()
    if (preloaded?.key === key) return
    preloaded?.controller.abort()
    const menu = fetchMenu(key)
    preloaded = menu
    menu.dimensions.then((dimensions) => {
      if (!dimensions && preloaded === menu) preloaded = undefined
    })
  }

  /** Adds a knob at `point` and hands it the pressed pointer, so it follows the pointer until release drops it. */
  function spawn(point: Point, pointerId: number) {
    const key = keyOf()
    if (preloaded?.key !== key) preloaded?.controller.abort()
    const menu = preloaded?.key === key ? preloaded : fetchMenu(key)
    preloaded = undefined

    const element = knobElement()
    const knob: FutureKnob = {
      element,
      label: element.querySelector("span")!,
      point,
      place: { swing: 0, distance: 0 },
      progress: 0,
      isDragging: true,
      isHovered: false,
      controller: menu.controller,
      sound: { hasMoved: true },
    }
    page.append(element)
    knobs.push(knob)
    attach(knob)
    updateAxis()
    drag(knob, point)
    element.setPointerCapture(pointerId)
    sounds.spawn(point.x)
    knob.sound.loadingTimer = window.setTimeout(() => (knob.sound.loading = sounds.menuLoading(knob.point.x)), MENU_LOADING_GRACE_MS)
    startBed(knob)
    receiveMenu(knob, menu)
  }

  /** What a knob answers: dragging it (unless pinned), double clicking it, hovering it. */
  function attach(knob: FutureKnob) {
    const { element } = knob
    makeDraggable(element, space, {
      onStart: () => {
        if (knob.pinned) return false
        unpark(knob)
        knob.isDragging = true
        knob.sound.hasMoved = false
        stopTracking(knob)
        startBed(knob)
        return true
      },
      onDrag: (point) => {
        knob.sound.hasMoved = true
        drag(knob, point)
      },
      onDrop: () => drop(knob),
    })
    onDoubleClick(element, () => remove(knob))
    element.addEventListener("pointerenter", () => ((knob.isHovered = true), layout()))
    element.addEventListener("pointerleave", () => ((knob.isHovered = false), layout()))
  }

  function clear() {
    knobs.filter(isSteering).forEach((knob) => reportDial(knob, false))
    const hadDimension = knobs.some(isSteering)
    knobs.forEach(dispose)
    knobs = []
    layout()
    if (hadDimension) onChange()
  }

  function layout() {
    const main = space.circle(mainKnob)
    const tuned = knobs.find((knob) => knob.isDragging)
    const shown = tuned ?? knobs.find((knob) => knob.isHovered && !knob.pinned)
    if (!tuned) updateAxis()
    let readout: ReadoutPart[] = []
    for (const knob of knobs) {
      const text = show(knob)
      if (knob === shown) readout = text
      knob.label.hidden = knob === shown
      knob.element.toggleAttribute("data-dimmed", tuned !== undefined && knob !== tuned)
    }
    parkCovered()
    placeInGutter()
    for (const knob of knobs) placeOnPage(knob, main.center)
    const hoveredPins = knobs.flatMap((knob) => (knob.pinned && knob.isHovered ? [rangeOf(knob.pinned)] : []))
    highlights.set(PINNED_HIGHLIGHT, hoveredPins)
    const linksOf = (linked: FutureKnob[]) => pathOf(linked.map((knob) => linkBetween(main, { center: knob.point, radius: knob.element.offsetWidth / 2 })))
    linkPath.setAttribute("d", linksOf(knobs.filter((knob) => knob !== tuned && !knob.pinned)))
    linkPath.toggleAttribute("data-dimmed", tuned !== undefined)
    tunedLinkPath.setAttribute("d", linksOf(tuned ? [tuned] : []))
    tunedLinkPath.toggleAttribute("data-choosing", tuned !== undefined && !tuned.dimension)
    hud.replaceChildren(
      ...(shown
        ? hudNodesOf({
            center: main.center,
            rimRadius: shown.dimension ? rimRadiusOf(shown, main.radius) : gateBaseOf(shown) + MENU_GATE_PX,
            axis,
            view: viewOf(shown),
            readout,
            knob: { ...shown.place, radius: shown.element.offsetWidth / 2 },
            font: `${hudStyle.getPropertyValue("--hud-size").trim()} ${hudStyle.fontFamily}`,
          })
        : []),
    )
  }

  function controls(): Control[] {
    // Clip dials steer their clip's weight, not the text, so they are not controls.
    return knobs.flatMap((knob) =>
      isSteering(knob) ? [{ dimension: knob.dimension!, position: positionOf(knob), strength: strengthOf(knob) }] : [],
    )
  }

  function keyOf() {
    // Attention app patch: the clips (and their steers) are in the key, so a preloaded menu refreshes when they change.
    return JSON.stringify([context(), takenOf().map(({ name }) => name), clips().map((c) => `${c.id}:${c.weight}:${c.use ?? ""}`)])
  }

  function takenOf() {
    // Clip dials are not text dimensions, so they are never sent to the model as "taken".
    return knobs.flatMap((knob) => (knob.dimension && !knob.dimension.clip && !knob.pinned ? [knob.dimension] : []))
  }

  /** Attention app patch: a dial per clip the lab keeps to, except clips that already have a dial. Each is a `wayLeaf`: crossing
      into it fetches the model's ways to use the passage, then it becomes a choice dial (or falls back to the weight scale). */
  function clipLeaves(): Dimension[] {
    const dialled = new Set(knobs.flatMap((knob) => (knob.dimension?.clip ? [knob.dimension.clip] : [])))
    return clips()
      .filter((c) => !dialled.has(c.id))
      .map((c) => ({ name: c.label, clip: c.id, kind: "choice", options: [], wayLeaf: true }))
  }

  /** Attention app patch: one "Clips" gateway at the top of the fan, offered while any clip has no dial. Choosing it re-fans into the clips. */
  function clipMenu(): Dimension[] {
    return clipLeaves().length ? [{ name: "Clips", kind: "choice", options: [], submenu: () => clipLeaves() }] : []
  }

  /** The steer a clip dial's swing picks: on a ways dial, Ignore (the first option) or the chosen way as a `use`; on the fallback
      weight dial, the weight the swing lands on. */
  function clipSteerOf(knob: FutureKnob): ClipSteer {
    const { dimension } = knob
    if (dimension?.kind !== "choice") return { weight: CLIP_WEIGHTS[0] } // clip dials are always choice; never reached
    const index = optionIndexAt(dimension.options.length, positionOf(knob))
    if (dimension.clipUse) return index === 0 ? { weight: "ignore" } : { use: dimension.options[index] }
    return { weight: CLIP_WEIGHTS[index] }
  }

  function fetchMenu(key: string): Menu {
    const controller = new AbortController()
    return { key, controller, dimensions: loadMenu(controller.signal) }
  }

  /** Undefined when the source fails or offers nothing; failures are logged here, so nobody has to handle a rejection.
      Attention app patch: the clip dials come first, and stand even when the model's dimensions fail. */
  async function loadMenu(signal: AbortSignal) {
    const clipDials = clipMenu()
    try {
      const dimensions = await Array.fromAsync(source({ ...context(), taken: takenOf() }, signal))
      if (signal.aborted) return
      const menu = [...clipDials, ...dimensions]
      if (!menu.length) throw new Error("the dimension source offered nothing")
      return menu
    } catch (error) {
      if (!signal.aborted) console.error(error)
      return clipDials.length ? clipDials : undefined
    }
  }

  async function receiveMenu(knob: FutureKnob, { dimensions }: Menu) {
    const menu = await dimensions
    if (knob.controller.signal.aborted) return
    const wasLoading = stopLoadingSound(knob)
    if (!menu) {
      sounds.menuFailed(knob.point.x)
      return remove(knob, { silent: true })
    }
    if (wasLoading) sounds.menuReady(knob.point.x)
    knob.menu = menu
    updateCandidate(knob)
    layout()
  }

  function updateAxis() {
    const first = knobs.find((knob) => !knob.pinned)
    if (!first) return
    const main = space.circle(mainKnob)
    axis = axisFor(main.center, rimRadiusOf(first, main.radius), space.visible())
  }

  /** Sounds the removal unless `silent`, e.g. when a failure already sounded. */
  function remove(knob: FutureKnob, { silent = false } = {}) {
    if (!knobs.includes(knob)) return
    if (!silent) sounds.remove(knob.point.x)
    if (isSteering(knob)) reportDial(knob, false)
    dispose(knob)
    knobs = knobs.filter((other) => other !== knob)
    layout()
    if (isSteering(knob)) onChange()
  }

  function dispose(knob: FutureKnob) {
    knob.element.remove()
    knob.controller.abort()
    stopTracking(knob)
    stopLoadingSound(knob)
    knob.sound.bed?.stop()
  }

  /** Returns whether the loading sound had started. */
  function stopLoadingSound({ sound }: FutureKnob) {
    clearTimeout(sound.loadingTimer)
    const { loading } = sound
    loading?.stop()
    sound.loading = sound.loadingTimer = undefined
    return loading !== undefined
  }

  /** Choosing is categorical, so it only ticks when the candidate changes; the click train that follows angle and distance starts once a dimension is taken. */
  function startBed(knob: FutureKnob) {
    if (!knob.dimension) return
    knob.sound.bed?.stop()
    knob.sound.lastDrag = undefined
    knob.sound.bed = sounds.bed(positionOf(knob), strengthOf(knob), knob.point.x)
  }

  function startTracking(knob: FutureKnob) {
    stopTracking(knob)
    knob.tracking = { control: labelOf(knob, knob.dimension!), origin: story.text.length, controller: new AbortController() }
    follow(story)
  }

  function stopTracking(knob: FutureKnob) {
    knob.tracking?.controller.abort()
    knob.tracking = undefined
    knob.confidence = undefined
  }

  function pin(knob: FutureKnob, sentence: Span) {
    const { confidence } = knob
    unpark(knob)
    stopTracking(knob)
    knob.confidence = confidence
    knob.pinned = sentence
    knob.element.toggleAttribute("data-pinned", true)
    report({ type: "pin", dim: knob.dimension!.name, sentence: sentenceAt(story.combined, sentence), confidence: confidence ?? 0 })
  }

  /** A dial's setting where it rests (on), or its deletion while it still steered (off). */
  function reportDial(knob: FutureKnob, on: boolean) {
    const dimension = knob.dimension!
    const position = positionOf(knob)
    report({ type: "dial", on, dim: dimension.name, value: valueOf({ dimension, position }), position, strength: strengthOf(knob) })
  }

  /** A dropped knob the text has grown over moves out of the way, into the right gutter, so it never hides the words; it keeps steering until it pins. */
  function parkCovered() {
    const text = textBox()
    if (!text) return
    for (const knob of knobs) {
      if (!knob.dimension || knob.pinned || knob.isDragging || knob.parkedAt !== undefined) continue
      const radius = knob.element.offsetWidth / 2
      const { x, y } = knob.point
      if (x + radius > text.left && x - radius < text.right && y + radius > text.top && y - radius < text.bottom) {
        knob.parkedAt = y
        knob.element.toggleAttribute("data-parked", true)
      }
    }
  }

  function unpark(knob: FutureKnob) {
    knob.parkedAt = undefined
    knob.element.removeAttribute("data-parked")
  }

  /** The lab box of the shown text, or undefined while there is none. */
  function textBox() {
    const range = document.createRange()
    range.selectNodeContents(textElement)
    const box = range.getBoundingClientRect()
    return box.width ? space.rect(box) : undefined
  }

  /** Pinned knobs sit level with their sentence, parked ones level with where they were; both in the right gutter, stacked so none overlap. */
  function placeInGutter() {
    const placed = knobs.filter((knob) => knob.pinned || knob.parkedAt !== undefined)
    const points = placeInRightMargin(
      placed.map((knob) => ({
        anchor: knob.pinned ? anchorOf(knob.pinned) : { x: knob.point.x, y: knob.parkedAt! },
        element: knob.element,
        label: knob.label,
      })),
      space.rect(textElement.getBoundingClientRect()).right,
      page.clientWidth,
    )
    points.forEach((point, i) => {
      placed[i].point = point
      placed[i].element.dataset.side = "right"
    })
  }

  /** The lab point of the sentence's first character. */
  function anchorOf(sentence: Span): Point {
    const [first] = rangeOf({ start: sentence.start, end: sentence.start + 1 }).getClientRects()
    if (!first) return { x: 0, y: 0 }
    const { left, top, height } = space.rect(first)
    return { x: left, y: top + height / 2 }
  }

  function rangeOf({ start, end }: Span) {
    const range = document.createRange()
    range.setStart(...domPointAt(textElement, start))
    range.setEnd(...domPointAt(textElement, Math.min(end, story.text.length)))
    return range
  }

  function drag(knob: FutureKnob, point: Point) {
    const main = space.circle(mainKnob)
    const dx = point.x - main.center.x
    const dy = point.y - main.center.y
    knob.point = point
    knob.place = { swing: wrapped(Math.atan2(dx, dy) - axis), distance: Math.hypot(dx, dy) }
    const candidate = knob.candidate
    updateCandidate(knob)
    if (!knob.dimension && knob.candidate !== undefined && knob.candidate !== candidate) sounds.candidate(knob.candidate, point.x)
    soundTuning(knob)
    layout()
    settle(knob)
  }

  /** Ticks as a tuned knob crosses graduations, options or steps of strength, and feeds the drag's click train. */
  function soundTuning(knob: FutureKnob) {
    const { sound, dimension, point } = knob
    const now = performance.now()
    const { lastDrag } = sound
    const speed = lastDrag ? Math.hypot(point.x - lastDrag.point.x, point.y - lastDrag.point.y) / Math.max(1, now - lastDrag.at) / DRAG_SPEED_FULL : 0
    sound.lastDrag = { point, at: now }
    const position = positionOf(knob)
    const strength = strengthOf(knob)
    sound.bed?.move(position, strength, clamp01(speed), point.x)
    if (!dimension) return

    const marks = {
      graduation: Math.round(position * GRADUATIONS),
      option: dimension.kind === "choice" ? optionIndexAt(dimension.options.length, position) : 0,
      step: Math.min(RULER_STEPS, Math.floor(strength * RULER_STEPS)),
    }
    const previous = sound.marks
    sound.marks = marks
    if (!previous) return
    if (dimension.kind === "scale" && marks.graduation !== previous.graduation) {
      const direction = Math.sign(marks.graduation - previous.graduation)
      const crossed = Math.min(MAX_TICKS_PER_MOVE, Math.abs(marks.graduation - previous.graduation))
      for (let i = 1; i <= crossed; i++) {
        const graduation = previous.graduation + direction * i
        sounds.graduation(graduation / GRADUATIONS, graduation % NUMBERED_EVERY === 0, point.x)
      }
    }
    if (marks.option !== previous.option) sounds.sector(marks.option, point.x)
    if (marks.step !== previous.step) {
      const crossed = marks.step > previous.step ? marks.step : previous.step
      if (crossed > 0) sounds.ruler(crossed, RULER_STEPS, point.x)
    }
  }

  function drop(knob: FutureKnob) {
    knob.isDragging = false
    knob.sound.bed?.stop()
    knob.sound.bed = undefined
    if (!knobs.includes(knob)) return
    if (!knob.dimension || knob.place.distance < minDistanceOf(knob, space.circle(mainKnob).radius)) return remove(knob)
    if (knob.sound.hasMoved) sounds.handOff(knob.point.x)
    // A clip dial keeps steering its clip's weight; it does not track a sentence or report as a text dial.
    if (knob.dimension.clip) return
    startTracking(knob)
    // a press that did not move it (e.g. the two presses of the double click that deletes it) sets nothing
    if (knob.sound.hasMoved) reportDial(knob, true)
  }

  /** Where a knob's current menu fans from: the main knob at the top level, or where a submenu's gateway was chosen. */
  function gateBaseOf(knob: FutureKnob) {
    return knob.gateBase ?? minDistanceOf(knob, space.circle(mainKnob).radius)
  }

  /** While choosing, the dimension in the knob's direction is the candidate, and carrying the knob through the gate chooses it. */
  function updateCandidate(knob: FutureKnob) {
    if (knob.dimension) return
    const beyondTouching = knob.place.distance - gateBaseOf(knob)
    knob.candidate = knob.menu && beyondTouching >= MENU_DEAD_ZONE_PX ? optionIndexAt(knob.menu.length, positionOf(knob)) : undefined
    knob.progress = clamp01(beyondTouching / MENU_GATE_PX)
    if (knob.candidate !== undefined && beyondTouching >= MENU_GATE_PX) choose(knob, knob.menu![knob.candidate])
  }

  function choose(knob: FutureKnob, dimension: Dimension) {
    // Attention app patch: a gateway dial re-fans into its children (a nested menu) instead of becoming tunable.
    if (dimension.submenu) return enterSubmenu(knob, dimension)
    // Attention app patch: a clip's dial fetches the model's ways to use it before it can be swung.
    if (dimension.wayLeaf) return enterClipWays(knob, dimension)
    knob.dimension = dimension
    knob.candidate = undefined
    knob.sound.marks = undefined
    sounds.take(knob.point.x)
    if (knob.isDragging) startBed(knob)
    layout()
    settle(knob)
  }

  /** Attention app patch: descend into a gateway's children. The submenu fans from where the gateway was chosen, so the learner
      drags on outward to pick a child. An empty or failed submenu drops the knob. */
  async function enterSubmenu(knob: FutureKnob, gateway: Dimension) {
    knob.candidate = undefined
    knob.gateBase = knob.place.distance
    knob.sound.marks = undefined
    sounds.take(knob.point.x)
    layout()
    const children = await gateway.submenu!()
    if (!knobs.includes(knob) || knob.dimension) return
    if (!children || !children.length) return remove(knob)
    knob.menu = children
    updateCandidate(knob)
    layout()
  }

  /** Attention app patch: crossing into a clip's dial. It shows loading while a cheap call fetches the model's ways to use the
      passage, then becomes a choice dial over [Ignore, ...ways] the learner swings to pick a `use`. If the call fails or offers
      none, it falls back to the weight scale (Stage 1's dial), so the dial always ends up tunable. */
  async function enterClipWays(knob: FutureKnob, leaf: Dimension) {
    knob.candidate = undefined
    knob.menu = undefined
    knob.gateBase = knob.place.distance
    knob.sound.marks = undefined
    stopLoadingSound(knob)
    knob.sound.loadingTimer = window.setTimeout(() => (knob.sound.loading = sounds.menuLoading(knob.point.x)), MENU_LOADING_GRACE_MS)
    layout()
    const clip = clips().find((c) => c.id === leaf.clip)
    let ways: string[] | undefined
    try {
      if (clip) ways = await clipWays({ quote: clip.quote, around: clip.around }, knob.controller.signal)
    } catch (error) {
      if (!knob.controller.signal.aborted) console.error(error)
    }
    if (knob.controller.signal.aborted || !knobs.includes(knob) || knob.dimension) return
    const wasLoading = stopLoadingSound(knob)
    const options = ways?.length ? [IGNORE_LABEL, ...ways] : WEIGHT_LABELS
    knob.dimension = { ...leaf, kind: "choice", options, wayLeaf: false, clipUse: !!ways?.length }
    knob.sound.marks = undefined
    if (wasLoading) sounds.menuReady(knob.point.x)
    sounds.take(knob.point.x)
    if (knob.isDragging) startBed(knob)
    layout()
    settle(knob)
  }

  /** Reports a change only when what the text generator would see differs from the last report.
      Attention app patch: a clip dial writes its steer onto the note instead; the note's new sources re-ask the text. */
  function settle(knob: FutureKnob) {
    const setting = settingOf(knob)
    if (setting === knob.setting) return
    knob.setting = setting
    if (knob.dimension?.clip) return onClipSteer(knob.dimension.clip, clipSteerOf(knob))
    onChange()
  }

  function settingOf(knob: FutureKnob) {
    if (!knob.dimension) return undefined
    // A clip dial's setting is only its steer (its distance is ignored), so a drag that keeps the same option re-writes nothing.
    if (knob.dimension.clip) {
      const steer = clipSteerOf(knob)
      return steer.use ? `use:${steer.use}` : `weight:${steer.weight}`
    }
    return `${valueOf({ dimension: knob.dimension, position: positionOf(knob) })}|${strengthLevelOf(strengthOf(knob))}`
  }

  /** The label goes on the side away from the main knob, so it stays off the link. */
  function placeOnPage(knob: FutureKnob, origin: Point) {
    const size = knob.element.offsetWidth
    const { x, y } = knob.point
    knob.element.style.translate = `${x - size / 2}px ${y - size / 2}px`
    if (!knob.pinned && knob.parkedAt === undefined) knob.element.dataset.side = x < origin.x ? "left" : "right"
  }

  /** Updates the knob's look and returns what its HUD readout shows. */
  function show(knob: FutureKnob): ReadoutPart[] {
    const { dimension, element } = knob
    element.toggleAttribute("data-dragging", knob.isDragging)
    element.toggleAttribute("data-loading", !dimension && !knob.menu)
    element.toggleAttribute("data-tuned", dimension !== undefined)
    if (!dimension) {
      element.style.setProperty("--lab-fill", `${knob.progress}`)
      labelWith(knob.label, PENDING_VALUE)
      element.setAttribute("aria-label", `future knob, choosing a dimension, double click to delete`)
      if (!knob.menu) return [{ text: PENDING_VALUE, tone: "live" }]
      return knob.candidate === undefined ? [] : [{ text: previewOf(knob.menu[knob.candidate]) }]
    }
    if (dimension.clip) {
      // A clip dial shows its passage and the option its swing picks (a weight, or a way to use it); it has no strength and never realizes in a sentence.
      const value = valueOf({ dimension, position: positionOf(knob) })
      const count = dimension.kind === "choice" ? dimension.options.length : 1
      const step = dimension.kind === "choice" ? optionIndexAt(dimension.options.length, positionOf(knob)) : 0
      element.style.setProperty("--lab-fill", `${(step + 1) / count}`)
      element.toggleAttribute("data-tracking", false)
      labelWith(knob.label, `${dimension.name}: ${value}`)
      element.setAttribute("aria-label", `clip ${dimension.clipUse ? "use" : "weight"}, ${dimension.name}: ${value}, double click to remove`)
      return [{ text: `${dimension.name}:`, tone: "dim" }, { text: value, tone: "live" }]
    }
    const strength = strengthOf(knob)
    const value = valueOf({ dimension, position: positionOf(knob) })
    const percent = `${Math.round(strength * 100)}%`
    const realized = knob.confidence === undefined ? "" : `${Math.round(knob.confidence * 100)}%${knob.pinned ? "" : " realized"}`
    const isRealizing = knob.tracking !== undefined || knob.pinned !== undefined
    element.style.setProperty("--lab-fill", `${isRealizing ? (knob.confidence ?? 0) : strength}`)
    element.toggleAttribute("data-tracking", knob.tracking !== undefined)
    labelWith(knob.label, `${dimension.name}: ${value}`, realized)
    const state = knob.pinned ? "realized and pinned beside its sentence" : `${strengthLevelOf(strength)} influence${realized && `, ${realized}`}`
    element.setAttribute("aria-label", `future knob, ${dimension.name}: ${value}, ${state}, double click to delete`)
    return [{ text: `${dimension.name}:`, tone: "dim" }, { text: value, tone: "live" }, { text: realized ? `${percent} · ${realized}` : percent }]
  }

  function viewOf(knob: FutureKnob) {
    if (knob.dimension) return { phase: "tuning" as const, dimension: knob.dimension, swing: clampedSwingOf(knob) }
    return { phase: "choosing" as const, names: knob.menu?.map(({ name }) => name) ?? [], candidate: knob.candidate }
  }

  function labelOf(knob: FutureKnob, dimension: Dimension) {
    return `${dimension.name}: ${valueOf({ dimension, position: positionOf(knob) })}`
  }

  function positionOf(knob: FutureKnob) {
    return clamp01((knob.place.swing + SWING_RADIANS) / (2 * SWING_RADIANS))
  }

  function strengthOf(knob: FutureKnob) {
    const min = minDistanceOf(knob, space.circle(mainKnob).radius)
    return clamp01((knob.place.distance - min) / STRENGTH_RANGE_PX)
  }

  function clampedSwingOf(knob: FutureKnob) {
    return positionOf(knob) * 2 * SWING_RADIANS - SWING_RADIANS
  }
}

/** A new future knob: a dashed dial with its label beside it. */
function knobElement() {
  const element = Object.assign(document.createElement("button"), { className: "knob future", type: "button" })
  element.setAttribute("aria-label", "future knob, …, double click to delete")
  element.append(Object.assign(document.createElement("span"), { textContent: "…" }))
  return element
}

/**
 * Calls `onDouble` on a double click whose two presses both landed on `element`. A knob spawned by double clicking the main knob and holding
 * captures that pointer, so the gesture's own double click is delivered to it on release; that one must not delete it.
 */
function onDoubleClick(element: HTMLElement, onDouble: () => void) {
  let presses: number[] = []
  element.addEventListener("pointerdown", ({ timeStamp }) => (presses = [...presses.slice(-1), timeStamp]))
  element.addEventListener("dblclick", ({ timeStamp }) => {
    const [first, second] = presses
    if (presses.length === 2 && second - first <= DOUBLE_CLICK_MS && timeStamp - second <= DOUBLE_CLICK_MS) onDouble()
  })
}

function isSteering(knob: FutureKnob) {
  // A clip dial has a dimension but steers its clip's weight, not the text: it is never a steering control, never pinned, never reported.
  return knob.dimension !== undefined && !knob.dimension.clip && !knob.pinned
}

function previewOf(dimension: Dimension) {
  if (dimension.submenu) return dimension.name // a gateway (e.g. Clips) has no value to preview, only its name
  const offer = dimension.kind === "scale" ? `${dimension.low} ↔ ${dimension.high}` : dimension.options.join(" · ")
  return `${dimension.name}: ${offer}`
}

/** Writes `text` into a knob's label, followed by `detail` set apart in a `<b>`. */
function labelWith(label: HTMLElement, text: string, detail = "") {
  const parts: (string | Node)[] = [text]
  if (detail) parts.push(" ", Object.assign(document.createElement("b"), { textContent: detail }))
  label.replaceChildren(...parts)
}

function rimRadiusOf(knob: Pick<FutureKnob, "element">, mainRadius: number) {
  return minDistanceOf(knob, mainRadius) + STRENGTH_RANGE_PX
}

function minDistanceOf({ element }: Pick<FutureKnob, "element">, mainRadius: number) {
  return mainRadius + element.offsetWidth / 2
}

function wrapped(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}
