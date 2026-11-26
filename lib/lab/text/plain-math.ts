// Attention app patch: the prompts ask for math as plain text (story/prompt.ts), but some LaTeX still slips through, and the lab shows
// its text as it is and sends it back as the text so far, where it spreads. This turns that LaTeX into plain text as the text streams.
// No imports, so the tests can load this file as it is (lib/lab-math.test.mjs).

/** Commands as plain text: symbols, function names, and nothing for those that only shape the layout. Others are left as written. */
const SYMBOLS: Record<string, string> = {
  cdot: "·", times: "×", div: "÷", pm: "±", approx: "≈", sim: "~", propto: "∝", ne: "≠", neq: "≠", le: "≤", leq: "≤", ge: "≥", geq: "≥",
  to: "→", rightarrow: "→", Rightarrow: "⇒", leftarrow: "←", mapsto: "↦", implies: "⇒", iff: "⇔", in: "∈", subset: "⊂", subseteq: "⊆",
  cup: "∪", cap: "∩", forall: "∀", exists: "∃", neg: "¬", land: "∧", lor: "∨", emptyset: "∅", infty: "∞", sum: "∑", prod: "∏",
  int: "∫", partial: "∂", nabla: "∇", ell: "ℓ", prime: "′", ldots: "…", cdots: "…", dots: "…", top: "T", circ: "∘", odot: "⊙",
  otimes: "⊗", mid: "|", Vert: "‖", lVert: "‖", rVert: "‖",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", eta: "η", theta: "θ", lambda: "λ", mu: "μ",
  pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  log: "log", ln: "ln", exp: "exp", sin: "sin", cos: "cos", tan: "tan", max: "max", min: "min", arg: "arg", lim: "lim", det: "det",
  quad: " ", qquad: " ", left: "", right: "", displaystyle: "", hline: "", big: "", Big: "", bigl: "", bigr: "", Bigl: "", Bigr: "",
}
/** Symbols that bind to the letter after them, as ∂L does: the space LaTeX needs between them is dropped. */
const TIGHT = /^[\p{Script=Greek}∂∇∑∏∫]$/u

/** Characters that have a subscript or superscript form, and those forms. */
const SUB = [[..."0123456789+-−=()aeijkmnotx"], [..."₀₁₂₃₄₅₆₇₈₉₊₋₋₌₍₎ₐₑᵢⱼₖₘₙₒₜₓ"]]
const SUP = [[..."0123456789+-−=()iknTtxy"], [..."⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾ⁱᵏⁿᵀᵗˣʸ"]]
const ACCENTS: Record<string, string> = { hat: "\u0302", bar: "\u0304" }

/** The text with its LaTeX as plain text: delimiters and $ signs around math dropped, known commands as symbols or words, x_{1} as x₁. */
export function plainMath(text: string) {
  if (!/[\\$_^]/.test(text)) return text
  let out = text
    .replace(/\$([A-Za-z]|[^\s$]*[\\_^{}][^\s$]*)\$/g, "$1") // $x$, $x_1$: a $ that is only a price, as in $5, stays
    .replace(/\$\$|\$(?=\\[a-zA-Z])|(?<=\})\$/g, "")
    .replace(/\\\\/g, " ")
    .replace(/\\[()[\]]/g, "")
    .replace(/\\[,;:> ]/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\\|/g, "‖")
    .replace(/\\begin\{\w*\*?\}(?:\{[^{}]*\})?|\\end\{\w*\*?\}/g, "")
    .replace(/\\([a-zA-Z]+)( (?=[\p{L}\p{N}]))?/gu, (command, name: string, space = "") => {
      const symbol = SYMBOLS[name]
      if (symbol === undefined) return command
      return TIGHT.test(symbol) ? symbol : symbol + space
    })
  // innermost braces first, so what is inside a group is plain before the group is
  for (let last = ""; out !== last; ) {
    last = out
    out = out
      .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, top: string, bottom: string) => `${group(top)}/${group(bottom)}`)
      .replace(/\\sqrt\{([^{}]*)\}/g, (_, root: string) => `√${group(root)}`)
      .replace(/\\(hat|bar)\{(\p{L})\}/gu, (_, accent: string, letter: string) => letter + ACCENTS[accent])
      .replace(/\\(?!(?:[dt]?frac|sqrt)\b)[a-zA-Z]+\*?\{([^{}]*)\}/g, "$1")
      .replace(/([_^])\{([^{}]*)\}/g, (_, mark: string, inner: string) => script(mark, inner))
  }
  return out.replace(/\\([{}%$&#_])/g, "$1")
}

/** A sub- or superscript in its Unicode form when it has one and is short (x₁, e⁻¹, ∑ᵢ₌₁), else written out (y_true, e^(z+1)). */
function script(mark: string, inner: string) {
  const [from, to] = mark === "_" ? SUB : SUP
  const chars = [...inner.trim()]
  const letters = chars.filter((char) => /\p{L}/u.test(char)).length
  if (chars.length && letters <= 1 && chars.every((char) => from.includes(char))) return chars.map((char) => to[from.indexOf(char)]).join("")
  return mark + group(inner)
}

/** A part of a fraction, root or script: in brackets unless it is one term or already in them. */
function group(part: string) {
  const term = part.trim()
  return /^[\p{L}\p{N}.'′∂∇]*$|^\([^()]*\)$/u.test(term) ? term : `(${term})`
}

/** One LaTeX command, with the space after it that belongs to it, or the one character it escapes. */
const COMMAND = /[a-zA-Z]+ ?|[^]/y

/**
 * How much of the start of `text` can be made plain on its own: all of it, unless its end may be a LaTeX token cut short (a command,
 * a script, a $ or an open brace), which is held back from the last space outside braces, so it is made plain once it is whole.
 */
export function readyEnd(text: string) {
  let depth = 0
  let end = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === "\\") {
      COMMAND.lastIndex = i + 1
      i += COMMAND.exec(text)?.[0].length ?? 0
    } else if (char === "{") depth++
    else if (char === "}") depth = Math.max(0, depth - 1)
    else if (!depth && /\s/.test(char)) end = i + 1
  }
  return depth || /[\\$_^{}]/.test(text.slice(end)) ? end : text.length
}

/** Past this, held text is let go as it is: a brace that never closes must not stop the text. */
const MAX_HELD = 200

/** `deltas` with their LaTeX made plain, even when a token is split across deltas. Text with none of it passes through as it comes. */
export async function* plainMathStream(deltas: AsyncIterable<string>) {
  let held = ""
  for await (const delta of deltas) {
    held += delta
    const ready = readyEnd(held)
    const end = held.length - ready > MAX_HELD ? held.length : ready
    const plain = plainMath(held.slice(0, end))
    held = held.slice(end)
    if (plain) yield plain
  }
  const rest = plainMath(held)
  if (rest) yield rest
}
