/**
 * Asks whether sentences deliver what a future knob's control asks for.
 * `sentences` follow `context` and are all given as context; only those at the `asked` indices are scored.
 */
export type RealizationRequest = { context: string; sentences: string[]; asked: number[]; control: string }

/** How sure the scorer is, from 0 to 1, that the sentence at `index` delivers the control. */
export type Realization = { index: number; confidence: number }

/** Streams a realization per asked sentence. Must stop (by throwing or returning) once `signal` aborts. */
export type RealizationSource = (request: RealizationRequest, signal: AbortSignal) => AsyncIterable<Realization>
