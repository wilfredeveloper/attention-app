import { storedApiKey, streamCompletion } from "../llm/cerebras"
import { CLIP_WAYS_SYSTEM, clipWaysUser, parseWays } from "../story/prompt"

/** Attention app patch: the model's suggested ways to use one clipped passage, for that clip's dial in the fan. One cheap call,
    made when the learner crosses into the clip (so nothing is asked until they reach for it); `url` is the lab's text route, which
    lab.ts binds. Resolves to a short list of imperative phrases (the dial puts Ignore first), or undefined when the call fails or
    offers none, so the dial can fall back to the weight scale. */
export async function liveClipWays(url: string, clip: { quote: string; around: string; topic?: string }, signal: AbortSignal) {
  const apiKey = storedApiKey()
  if (!apiKey) return undefined
  let text = ""
  for await (const delta of streamCompletion({
    url,
    apiKey,
    system: CLIP_WAYS_SYSTEM,
    user: clipWaysUser(clip),
    temperature: 0.4,
    maxCompletionTokens: 200,
    signal,
  }))
    text += delta
  return parseWays(text)
}
