/** Attention app patch: where the lab's text calls go unless its host names another route (LabOptions.completeUrl). */
export const API_URL = "/api/spaceship/complete"
const MODEL = "gpt-oss-120b"

export const KEY_STORAGE = "cerebras-api-key"

export const storedApiKey = () => "server"

export type CompletionRequest = {
  url: string
  apiKey: string
  system: string
  user: string
  temperature: number
  maxCompletionTokens: number
  signal: AbortSignal
}

export async function* streamCompletion({ url, system, user, temperature, maxCompletionTokens, signal }: CompletionRequest) {
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      reasoning_effort: "low",
      temperature,
      max_completion_tokens: maxCompletionTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  })

  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  if (!response.body) throw new Error("no response body")

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += value

    const events = buffer.split("\n")
    buffer = events.pop() ?? ""

    for (const line of events) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : ""
      if (!data || data === "[DONE]") continue
      const content = JSON.parse(data).choices?.[0]?.delta?.content
      if (content) yield content as string
    }
  }
}
