/** How strongly the sentence at `index` connects to the focus, from 0 (unrelated) to 1 (drives it or is driven by it). */
export type Influence = { index: number; strength: number }

/** What sentences are scored against: the sentence after the main knob, or the phrase of a hovered attention box. */
export type Focus = { kind: "next sentence" | "key phrase"; text: string }

/** Streams an influence per sentence on `focus`. Must stop (by throwing or returning) once `signal` aborts. */
export type InfluenceSource = (sentences: string[], focus: Focus, signal: AbortSignal) => AsyncIterable<Influence>
