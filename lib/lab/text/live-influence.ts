import { createDecisions, storedGeminiKey, type Question } from "../llm/decisions"
import type { Focus, InfluenceSource } from "./influence"

const MODEL = "gemini-decision-1"

export const QUESTIONS: Record<Focus["kind"], { instructions: string; levels: string[] }> = {
  "next sentence": {
    instructions: "connect to and influence the NEXT SENTENCE",
    levels: [
      "No connection",
      "Weak: shares a detail or the setting",
      "Moderate: the next sentence builds on it",
      "Strong: the next sentence directly follows from it",
    ],
  },
  "key phrase": {
    instructions: "connect to the KEY PHRASE: what it names, what causes it or what follows from it",
    levels: [
      "No connection",
      "Weak: shares a detail or the setting",
      "Moderate: involves what the key phrase names",
      "Strong: directly about, caused by or causing the key phrase",
    ],
  },
}

export const liveInfluence: InfluenceSource = async function* (sentences, focus, signal) {
  const apiKey = storedGeminiKey()
  if (!apiKey) throw new Error("save a Gemini API key on the decisions page first")

  const { instructions, levels } = QUESTIONS[focus.kind]
  const input = `SENTENCES\n${sentences.map((sentence, i) => `[${i + 1}] ${sentence}`).join("\n")}\n\n${focus.kind.toUpperCase()}\n${focus.text}`
  const questions = Object.fromEntries(
    sentences.map((_, i): [string, Question] => [
      keyOf(i),
      { type: "score", instructions: `How strongly does sentence [${i + 1}] ${instructions}?`, criteria: levels },
    ]),
  )
  const { answers } = await createDecisions(apiKey, { model: MODEL, input, questions }, signal)

  for (const index of sentences.keys()) {
    const answer = answers[keyOf(index)]
    if (answer?.type === "score") yield { index, strength: answer.score / (levels.length - 1) }
  }
}

function keyOf(index: number) {
  return `s${index + 1}`
}
