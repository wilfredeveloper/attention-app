import { createDecisions, storedGeminiKey, type Question } from "../llm/decisions"
import type { RealizationSource } from "./realization"

const MODEL = "gemini-decision-1"

export const liveRealization: RealizationSource = async function* ({ context, sentences, asked, control }, signal) {
  const apiKey = storedGeminiKey()
  if (!apiKey) throw new Error("save a Gemini API key on the decisions page first")

  const input = [
    ...(context ? [`TEXT SO FAR\n${context}`] : []),
    `CANDIDATE SENTENCES\n${sentences.map((sentence, i) => `[${i + 1}] ${sentence}`).join("\n")}`,
    `CONTROL\n${control}`,
  ].join("\n\n")
  const questions = Object.fromEntries(asked.map((index) => [keyOf(index), questionAbout(index)]))
  const { answers } = await createDecisions(apiKey, { model: MODEL, input, questions }, signal)

  for (const index of asked) {
    const answer = answers[keyOf(index)]
    if (answer?.type === "noul") yield { index, confidence: answer.noul }
  }
}

function keyOf(index: number) {
  return `s${index + 1}`
}

function questionAbout(index: number): Question {
  return {
    type: "noul",
    instructions: `Does sentence [${index + 1}] deliver what the CONTROL asks for?`,
    criteria: {
      true_description: "The sentence clearly shows the control's value.",
      false_description: "The sentence does not show it, or shows the opposite.",
    },
  }
}
