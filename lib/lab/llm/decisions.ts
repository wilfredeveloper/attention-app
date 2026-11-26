const API_URL = "/api/spaceship/decide"

export const KEY_STORAGE = "gemini-api-key"

export const storedGeminiKey = () => "server"

export type Resolution = "low" | "medium" | "high" | "ultra_high"

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mime_type: string; resolution?: Resolution }
  | { type: "audio"; data: string; mime_type: string }
  | { type: "video"; data: string; mime_type: string; resolution?: Exclude<Resolution, "ultra_high"> }

export type Question =
  | { type: "noul"; instructions: string; criteria?: { true_description?: string; false_description?: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }

export type Answer =
  | { type: "noul"; noul: number; confidence: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; legend: Record<string, string>; confidence: number }

export type DecisionResponse = {
  answers: Record<string, Answer>
  usage: {
    total_input_tokens: number
    input_tokens_by_modality: { modality: string; tokens: number }[]
    total_output_tokens: number
    total_tokens: number
  }
}

export type DecisionRequest = {
  model: string
  input: string | ContentBlock[]
  questions: Record<string, Question>
}

export async function createDecisions(_apiKey: string, request: DecisionRequest, signal: AbortSignal) {
  const response = await fetch(API_URL, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  })
  const body = await response.json()

  if (!response.ok)
    throw new Error(`HTTP ${response.status} ${body.error?.code ?? ""} ${body.error?.status ?? ""}: ${body.error?.message ?? JSON.stringify(body)}`)

  return body as DecisionResponse
}
