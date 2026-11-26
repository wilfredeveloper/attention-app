// Streaming text for the steer-live lab (lib/lab). The lab sends an
// OpenAI-style chat body; this forwards it to OpenRouter with the server's key
// and pipes the SSE stream straight back. Same model upstream uses, on Cerebras.

import { SPACESHIP_TEXT_MODEL } from "@/lib/spaceship";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = SPACESHIP_TEXT_MODEL;

export async function POST(req: Request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return new Response("OPENROUTER_API_KEY is not set in .env.local", { status: 500 });

  const body = await req.json();
  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: req.signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      messages: body.messages,
      temperature: body.temperature,
      max_tokens: body.max_completion_tokens,
      reasoning: { effort: "low", exclude: true },
      provider: { order: ["cerebras"] },
    }),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream" },
  });
}
