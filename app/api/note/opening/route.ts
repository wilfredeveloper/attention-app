// The opening of a note's starting point ("Steer from this" on a note, LessonCanvas). The note's
// clips and the learner's draft go to the lab's text model, which names a TOPIC and writes a BRIDGE
// that carries on from the draft's last word. The draft never comes back from the model: the canvas
// puts the bridge after the learner's own text. Same model, key and provider as /api/spaceship/complete.
//   POST { course, lesson, clips: { quote, where, around }[], draft } -> { topic, bridge }

import { SPACESHIP_TEXT_MODEL } from "@/lib/spaceship";
import { dropEcho, openingMessages, parseOpening, readOpening } from "@/lib/note";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return new Response("OPENROUTER_API_KEY is not set in .env.local", { status: 500 });

  const input = readOpening(await req.json().catch(() => null));
  if (!input) return new Response("Nothing to start from: write something or clip a passage first.", { status: 400 });

  // Up to two tries: a network failure (a fetch that throws, which would otherwise be an empty 500), an
  // error status, or a reply without a TOPIC or BRIDGE is asked again once. Not once the learner has gone.
  let failed = "";
  for (let attempt = 0; attempt < 2 && !req.signal.aborted; attempt++) {
    let upstream: Response;
    try {
      upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: req.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: SPACESHIP_TEXT_MODEL,
          messages: openingMessages(input),
          temperature: 0.6,
          max_tokens: 1200, // the reasoning counts against this too
          reasoning: { effort: "low", exclude: true },
          provider: { order: ["cerebras"] },
        }),
      });
    } catch (e) {
      failed = `The model couldn’t be reached (${(e as Error).message}).`;
      continue;
    }
    if (!upstream.ok) {
      failed = `The model didn’t answer (${upstream.status}).`;
      continue;
    }
    const data = (await upstream.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
    const out = parseOpening(data?.choices?.[0]?.message?.content ?? "");
    if (!out) {
      failed = "The model’s answer had no topic or bridge.";
      continue;
    }
    return Response.json({ topic: out.topic, bridge: dropEcho(input.draft, out.bridge) }); // never the draft twice
  }
  return new Response(failed || "Cancelled.", { status: 502 });
}
