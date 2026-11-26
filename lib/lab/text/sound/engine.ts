/**
 * Short synthesized sounds on native Web Audio nodes. The nodes render on the audio thread; the page only builds a handful per sound
 * and disconnects them when they end, so sound costs the main thread microseconds per event.
 * Attention app patch: every lab on the page shares one AudioContext (browsers cap how many a page may open), and each plays through
 * an output of its own (see `openOutput`), so a paused lab is silenced at once and a closed one leaves no node behind. The context is
 * closed when the last output closes.
 */

const MASTER_VOLUME = 0.7
/** Beyond this many sounding voices new ones are dropped, so a burst of events cannot pile up work. */
const MAX_VOICES = 48
/** Pan never reaches a hard side. */
const PAN_WIDTH = 0.85
/** A small dark room: decaying noise whose highs die faster than its lows. */
const REVERB_SECONDS = 0.9
const NOISE_SECONDS = 2
const SILENCE = 1e-4
/** Time constant of the fade when a sound is cut short. */
const CUT_SECONDS = 0.012
const STORAGE_KEY = "text-sound"
/** The bed's clicks are scheduled this far ahead on the audio clock, topped up every tick, so main-thread stalls do not make them stutter. */
const BED_LOOKAHEAD_SECONDS = 0.1
const BED_TICK_MS = 25
/** The bed counts the pointer as resting once its speed has not been updated for this long. */
const BED_SPEED_HOLD_MS = 90

/**
 * One sound: a tone (FM when `index` is set), or filtered white noise when `filter` is set.
 * Times are in seconds from now. The level rises linearly over `attack`, stays for `hold`, then falls exponentially to silence over `decay`.
 */
export type Voice = {
  /** Oscillator frequency, or the noise filter's frequency. */
  f: number
  /** Glides `f` exponentially to this over `glide`, by default the whole voice. */
  to?: number
  glide?: number
  wave?: "sine" | "triangle" | "square"
  filter?: "bandpass" | "lowpass" | "highpass"
  q?: number
  /** FM: a modulator at `f * ratio` with a peak deviation of `index * f * ratio`, decaying to a tenth over the voice. */
  ratio?: number
  index?: number
  /** Square-wave vibrato of ±`lfoDepth` Hz at `lfoRate` Hz. */
  lfoRate?: number
  lfoDepth?: number
  delay?: number
  attack?: number
  hold?: number
  decay: number
  gain: number
  /** -1 left to 1 right. */
  pan?: number
  /** Share sent to the reverb, 0 to 1. */
  wet?: number
}

/** A sound that can be cut short, e.g. a hold sweep the pointer abandons. */
export type Sound = { stop(): void }

/** A continuous click train while a future knob is dragged: its rate follows `strength`, its pitch `position`, its level `speed`; all 0 to 1. */
export type BedState = { position: number; strength: number; speed: number; pan: number }
export type Bed = { set(state: BedState): void; stop(): void }

type Graph = { context: AudioContext; master: GainNode; reverb: ConvolverNode; noise: AudioBuffer }

/** Where a lab's voices go: its own dry and reverb sends, which it can silence or disconnect without touching the other labs'. */
type Bus = { dry: GainNode; wet: GainNode }

/** One lab's sound: voices and beds play only while it is audible; `close` silences it and disconnects what it added. */
export type Output = { play(voices: Voice[]): Sound; startBed(initial: BedState): Bed; setAudible(on: boolean): void; close(): void }

const SILENT: Sound = { stop() {} }
/** How fast a lab going quiet fades, as a time constant: quick, but without a click. */
const MUTE_SECONDS = 0.01
let graph: Graph | undefined
let outputs = 0
/** Read on first use: the module also loads on the server, which has no storage. */
let isOn: boolean | undefined
/** Set from a user gesture until the context resumes, so the sound that gesture triggers is not lost. */
let isUnlocking = false
let voiceCount = 0

export function isSoundOn() {
  if (isOn === undefined) {
    try {
      isOn = localStorage.getItem(STORAGE_KEY) !== "off"
    } catch {
      isOn = true
    }
  }
  return isOn
}

/** Remembered across visits, for every lab. Call from a user gesture, so turning sound on may start audio. */
export function setSoundOn(on: boolean) {
  isOn = on
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off")
  } catch {}
  if (on) unlock()
  else graph?.context.suspend()
}

/**
 * Opens one lab's output on the shared audio graph, which is built by the first one, suspended until the first pointer or key press,
 * as browsers only let a gesture start audio. Starts inaudible.
 */
export function openOutput(): Output {
  if (typeof AudioContext === "undefined") return { play: () => SILENT, startBed: () => ({ set() {}, stop() {} }), setAudible() {}, close() {} }
  if (!graph) {
    graph = createGraph()
    for (const type of ["pointerdown", "keydown"]) addEventListener(type, unlock, { capture: true })
  }
  outputs++
  const { context, master, reverb } = graph
  const bus: Bus = { dry: new GainNode(context), wet: new GainNode(context) }
  bus.dry.connect(master)
  bus.wet.connect(reverb)
  const beds = new Set<() => void>()
  let isAudible = false
  let isClosed = false
  const canPlay = () => isAudible && isPlayable()

  return {
    play(voices) {
      if (!canPlay()) return SILENT
      const started = voices.flatMap((voice) => safely(() => start(voice, bus)) ?? [])
      return { stop: () => started.forEach((sound) => safely(() => sound.stop())) }
    },
    /** Starts the click train; `set` it as the pointer moves. */
    startBed(initial) {
      if (!canPlay()) return { set() {}, stop() {} }
      let state = initial
      let setAt = performance.now()
      let nextAt = context.currentTime
      const fill = () => {
        if (!canPlay()) return
        const now = context.currentTime
        nextAt = Math.max(nextAt, now)
        const speed = performance.now() - setAt > BED_SPEED_HOLD_MS ? 0 : state.speed
        while (nextAt < now + BED_LOOKAHEAD_SECONDS) {
          safely(() =>
            start(
              { filter: "bandpass", f: 1200 + state.position * 2400, q: 3, decay: 0.003, gain: 0.05 + speed * 0.25, pan: state.pan, delay: nextAt - now },
              bus,
            ),
          )
          nextAt += 1 / (5 + state.strength * 25)
        }
      }
      fill()
      const timer = setInterval(fill, BED_TICK_MS)
      const stop = () => {
        clearInterval(timer)
        beds.delete(stop)
      }
      beds.add(stop)
      return {
        set(next) {
          state = next
          setAt = performance.now()
        },
        stop,
      }
    },
    /** An inaudible lab starts no sound, and what it was sounding fades out now rather than ringing on. */
    setAudible(on) {
      if (isClosed || on === isAudible) return
      isAudible = on
      if (!on) beds.forEach((stop) => stop())
      for (const gain of [bus.dry.gain, bus.wet.gain]) gain.setTargetAtTime(on ? 1 : 0, context.currentTime, MUTE_SECONDS)
    },
    close() {
      if (isClosed) return
      isClosed = true
      isAudible = false
      beds.forEach((stop) => stop())
      bus.dry.disconnect()
      bus.wet.disconnect()
      if (--outputs === 0) closeGraph()
    },
  }
}

function closeGraph() {
  for (const type of ["pointerdown", "keydown"]) removeEventListener(type, unlock, { capture: true })
  graph?.context.close()
  graph = undefined
}

/** Sound is feedback, never control: a failure is logged and the interaction that triggered it carries on. */
function safely<T>(run: () => T): T | undefined {
  try {
    return run()
  } catch (error) {
    console.error(error)
  }
}

function isPlayable() {
  return graph !== undefined && isSoundOn() && (graph.context.state === "running" || isUnlocking) && voiceCount < MAX_VOICES
}

function unlock() {
  if (!graph || !isSoundOn() || graph.context.state === "running") return
  isUnlocking = true
  graph.context.resume().finally(() => (isUnlocking = false))
}

function start(voice: Voice, bus: Bus): Sound | undefined {
  if (voiceCount >= MAX_VOICES) return
  const { context, noise } = graph!
  const { f, to, filter, delay = 0, attack = filter ? 0.001 : 0.002, hold = 0, decay, gain, pan = 0, wet = 0 } = voice
  const t0 = context.currentTime + delay
  const end = t0 + attack + hold + decay
  const nodes: AudioNode[] = []
  const sources: AudioScheduledSourceNode[] = []
  const add = <T extends AudioNode>(node: T) => (nodes.push(node), node)
  /** Where a noise voice starts reading the shared buffer, so repeated clicks do not sound identical. */
  const offset = Math.random() * (NOISE_SECONDS - 0.5)

  let head: AudioNode
  if (filter) {
    const source = add(new AudioBufferSourceNode(context, { buffer: noise }))
    const shaper = add(new BiquadFilterNode(context, { type: filter, Q: voice.q ?? 2 }))
    shaper.frequency.setValueAtTime(f, t0)
    if (to) shaper.frequency.exponentialRampToValueAtTime(to, t0 + (voice.glide ?? end - t0))
    source.connect(shaper)
    sources.push(source)
    head = shaper
  } else {
    const carrier = add(new OscillatorNode(context, { type: voice.wave ?? "sine" }))
    carrier.frequency.setValueAtTime(f, t0)
    const glideEnd = t0 + (voice.glide ?? end - t0)
    if (to) carrier.frequency.exponentialRampToValueAtTime(to, glideEnd)
    if (voice.index) {
      const ratio = voice.ratio ?? 3.01
      const deviation = voice.index * f * ratio
      const modulator = add(new OscillatorNode(context, { frequency: f * ratio }))
      const depth = add(new GainNode(context))
      depth.gain.setValueAtTime(deviation, t0)
      depth.gain.exponentialRampToValueAtTime(deviation * 0.1 + 1, end)
      if (to) modulator.frequency.exponentialRampToValueAtTime(to * ratio, glideEnd)
      modulator.connect(depth).connect(carrier.frequency)
      sources.push(modulator)
    }
    if (voice.lfoRate && voice.lfoDepth) {
      const lfo = add(new OscillatorNode(context, { type: "square", frequency: voice.lfoRate }))
      lfo.connect(add(new GainNode(context, { gain: voice.lfoDepth }))).connect(carrier.frequency)
      sources.push(lfo)
    }
    sources.push(carrier)
    head = carrier
  }

  const level = add(new GainNode(context, { gain: 0 }))
  level.gain.setValueAtTime(0, t0)
  level.gain.linearRampToValueAtTime(gain, t0 + attack)
  if (hold) level.gain.setValueAtTime(gain, t0 + attack + hold)
  level.gain.exponentialRampToValueAtTime(SILENCE, end)
  const panner = add(new StereoPannerNode(context, { pan: Math.max(-1, Math.min(1, pan)) * PAN_WIDTH }))
  head.connect(level).connect(panner).connect(bus.dry)
  if (wet > 0) panner.connect(add(new GainNode(context, { gain: wet }))).connect(bus.wet)

  for (const source of sources) {
    if (source instanceof AudioBufferSourceNode) source.start(t0, offset)
    else source.start(t0)
    source.stop(end + 0.02)
  }
  voiceCount++
  sources.at(-1)!.onended = () => {
    voiceCount--
    for (const node of nodes) node.disconnect()
  }

  return {
    stop() {
      const now = context.currentTime
      level.gain.cancelAndHoldAtTime(now)
      level.gain.setTargetAtTime(0, now, CUT_SECONDS)
      for (const source of sources) source.stop(Math.max(now, t0) + CUT_SECONDS * 6)
    },
  }
}

function createGraph(): Graph {
  const context = new AudioContext({ latencyHint: "interactive" })
  const master = new GainNode(context, { gain: MASTER_VOLUME })
  const limiter = new DynamicsCompressorNode(context, { threshold: -14, knee: 6, ratio: 6, attack: 0.001, release: 0.08 })
  const reverb = new ConvolverNode(context, { buffer: roomOf(context) })
  master.connect(limiter).connect(context.destination)
  reverb.connect(master)
  return { context, master, reverb, noise: noiseOf(context) }
}

function noiseOf(context: AudioContext) {
  const buffer = context.createBuffer(1, context.sampleRate * NOISE_SECONDS, context.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
  return buffer
}

function roomOf(context: AudioContext) {
  const length = Math.floor(context.sampleRate * REVERB_SECONDS)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const samples = buffer.getChannelData(channel)
    let smoothed = 0
    for (let i = 0; i < length; i++) {
      const progress = i / length
      smoothed += (Math.random() * 2 - 1 - smoothed) * (0.9 - 0.75 * progress)
      samples[i] = smoothed * (1 - progress) ** 3
    }
  }
  return buffer
}
