// Scoring questions for the steer-live lab (lib/lab), answered by Jev
// (TypeSafe's decision model) through OpenRouter. The lab speaks the Gemini
// decisions shape it was written for; Jev's answers come back in the same
// shape, so only the request needs renaming: `input` -> `state`, and a noul's
// `true_description`/`false_description` -> `true`/`false`.

import { SPACESHIP_DECIDE_MODEL } from "@/lib/spaceship";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = SPACESHIP_DECIDE_MODEL;

type Question = { type: string; instructions: string; criteria?: unknown };

export async function POST(req: Request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return Response.json({ error: { message: "OPENROUTER_API_KEY is not set in .env.local" } }, { status: 500 });

  const { input, questions } = (await req.json()) as { input: unknown; questions: Record<string, Question> };
  const upstream = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    signal: req.signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      state: input,
      questions: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, toJev(q)])),
    }),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

function toJev(q: Question): Question {
  if (q.type !== "noul" || !q.criteria) return q;
  const c = q.criteria as { true_description?: string; false_description?: string };
  return { ...q, criteria: { true: c.true_description, false: c.false_description } };
}
