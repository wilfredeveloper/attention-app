import type { Lead } from "./attention"

/** An aspect of the upcoming text that a future knob tunes: a two-pole scale, or a choice among options.
    Attention app patch: `clip` marks a dial that isn't a text dimension but a clipped source's steer (the clip's id); its swing
    picks an option and writes it onto the note rather than steering the text. `submenu` marks a gateway dial: choosing it re-fans
    into its children (a nested marking menu) instead of becoming tunable, so one "Clips" handle can lead to the clips and then to
    each clip's steer. Its own kind/options are unused.
    `wayLeaf` marks a clip dial whose options aren't fixed: crossing into it fetches the model's suggested ways to use the passage,
    and only then does it become a choice dial (falling back to the weight scale if the fetch fails). `clipUse` then says its
    options are those ways, which the learner picks as the clip's `use` (Ignore is the first option), not weights on the scale. */
export type Dimension = {
  name: string
  clip?: string
  submenu?: () => Dimension[] | Promise<Dimension[] | undefined>
  wayLeaf?: boolean
  clipUse?: boolean
} & ({ kind: "scale"; low: string; high: string } | { kind: "choice"; options: string[] })

/** A dimension with the knob's position across the fan (0 is the low pole or first option, 1 the high pole or last) and its strength of influence, both from 0 to 1. */
export type Control = { dimension: Dimension; position: number; strength: number }

export type DimensionContext = { text: string; leads: Lead[]; taken: Dimension[] }

/** Streams the dimensions offered for `context.text`, most relevant first: each differs from the others and from every one in `context.taken`. Must stop (by throwing or returning) once `signal` aborts. */
export type DimensionSource = (context: DimensionContext, signal: AbortSignal) => AsyncIterable<Dimension>

export type StrengthLevel = "slight" | "moderate" | "strong"

/** The fan is split into `optionCount` equal sectors; returns the one containing `position`. */
export function optionIndexAt(optionCount: number, position: number) {
  return Math.min(optionCount - 1, Math.floor(position * optionCount))
}

/** Index 0–4 of the five grades a scale position is spoken as: very low, somewhat low, midway, somewhat high, very high. */
export function gradeIndexOf(position: number) {
  if (position < 0.2) return 0
  if (position < 0.4) return 1
  if (position <= 0.6) return 2
  if (position <= 0.8) return 3
  return 4
}

/** The control's value in words: a scale's grade, e.g. "very calm", "somewhat tense", "midway between calm and tense"; or a choice's selected option. */
export function valueOf({ dimension, position }: Pick<Control, "dimension" | "position">) {
  if (dimension.kind === "choice") return dimension.options[optionIndexAt(dimension.options.length, position)]
  const { low, high } = dimension
  return ["very " + low, "somewhat " + low, `midway between ${low} and ${high}`, "somewhat " + high, "very " + high][gradeIndexOf(position)]
}

/** Thirds of the strength range. */
export function strengthLevelOf(strength: number): StrengthLevel {
  if (strength < 1 / 3) return "slight"
  if (strength < 2 / 3) return "moderate"
  return "strong"
}
