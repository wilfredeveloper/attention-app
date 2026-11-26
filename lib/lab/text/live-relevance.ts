import { createDecisions, storedGeminiKey, type Question } from "../llm/decisions"
import type { RelevanceSource } from "./keyword-relevance"

const MODEL = "gemini-decision-1"
export const LEVELS = [
  "Not relevant",
  "Weak: shares the setting or a passing detail",
  "Moderate: bears on what the tip is about",
  "Strong: the tip is about it, or turns on it",
]

export const liveRelevance: RelevanceSource = async function* ({ story, tip, leads }, signal) {
  const apiKey = storedGeminiKey()
  if (!apiKey) throw new Error("save a Gemini API key on the decisions page first")

  const input = [
    ...(story ? [`TEXT SO FAR\n${story}`] : []),
    `TIP (the sentence being written now)\n${tip}`,
    `KEYWORDS\n${leads.map(({ before, keyword, after }, i) => `[${i + 1}] ${keyword} (in "${before}${keyword}${after}")`).join("\n")}`,
  ].join("\n\n")
  const questions = Object.fromEntries(
    leads.map((lead, i): [string, Question] => [
      keyOf(i),
      { type: "score", instructions: `How relevant is keyword [${i + 1}] "${lead.keyword}" to the TIP?`, criteria: LEVELS },
    ]),
  )
  const { answers } = await createDecisions(apiKey, { model: MODEL, input, questions }, signal)

  for (const index of leads.keys()) {
    const answer = answers[keyOf(index)]
    if (answer?.type === "score") yield { index, relevance: answer.score / (LEVELS.length - 1) }
  }
}

function keyOf(index: number) {
  return `k${index + 1}`
}
