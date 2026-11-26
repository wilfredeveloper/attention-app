// Attention app patch: which prompts a lab ran with, stamped on every steer event it reports (see lab.ts), so the study log can tell
// prompt versions apart. A hash of every string the models are given, taken when this module loads, so editing a prompt changes it
// with no build step; `PROMPT_REVISION` covers what is put together in code (the user messages, the scoring questions): bump it
// when you change those.

import { STEERED_SYSTEM_PROMPT, STORY_SYSTEM_PROMPT } from "./story/prompt"
import { SYSTEM_PROMPT as ATTENTION_PROMPT } from "./text/live-attention"
import { CATALOG, SYSTEM_PROMPT as DIMENSION_PROMPT } from "./text/live-dimension"
import { QUESTIONS as INFLUENCE_QUESTIONS } from "./text/live-influence"
import { LEVELS as RELEVANCE_LEVELS } from "./text/live-relevance"

const PROMPT_REVISION = 1

export const PROMPT_STAMP = hashOf(
  JSON.stringify([
    PROMPT_REVISION,
    STORY_SYSTEM_PROMPT,
    STEERED_SYSTEM_PROMPT,
    ATTENTION_PROMPT,
    DIMENSION_PROMPT,
    CATALOG,
    INFLUENCE_QUESTIONS,
    RELEVANCE_LEVELS,
  ]),
)

/** The lab is built with the app now, so it has no build of its own to stamp; events from before carry the hash of its separate build. */
export const LAB_BUILD = "app"

/** A short hex hash (cyrb53, 12 digits like the stamps before it): only to tell versions apart, nothing secret. */
function hashOf(text: string) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0").slice(0, 12)
}
