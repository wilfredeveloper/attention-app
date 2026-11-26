// Streaming text for the Steer live lab in a canvas note, on the model picked in the control room's Models tab (lib/models.ts
// `lab`): Haiku 5.5 through the machine's logged-in `claude` CLI, from a pool of processes started ahead of time
// (lib/labPool.ts), or a model on OpenRouter (lib/labOpenRouter.ts). It takes the OpenAI-style body the lab sends
// /api/spaceship/complete and answers in the same SSE shape, so lib/lab/llm/cerebras.ts reads both alike. ?course= names the
// course for calls.jsonl. The setting is read on every call, so a change applies to the next one with no restart.

import { logCall } from "@/lib/calls";
import { claudeCommand, createLabPool, type LabPool } from "@/lib/labPool";
import { openRouterLab } from "@/lib/labOpenRouter";
import { getSettings } from "@/lib/models";
import { LAB_CLAUDE_MODEL } from "@/lib/spaceship";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One pool per server process, kept on globalThis: Next's dev reload runs this file again, and a second pool would leave the
// first one's processes running.
const shared = globalThis as typeof globalThis & { labPool?: LabPool };

export async function POST(req: Request) {
  const { lab } = await getSettings();
  const course = new URL(req.url).searchParams.get("course") ?? "";
  const body = await req.json().catch(() => null);

  if (lab === LAB_CLAUDE_MODEL) {
    shared.labPool ??= createLabPool({
      ...claudeCommand(LAB_CLAUDE_MODEL),
      log: (result, call) => logCall(result, { feature: "lab", ...call }),
    });
    return shared.labPool.respond(body, req.signal, course);
  }

  // Switched to OpenRouter: the pool's waiting processes (about 600 MB) aren't needed. Switching back starts a new pool.
  shared.labPool?.close();
  shared.labPool = undefined;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return new Response("OPENROUTER_API_KEY is not set in .env.local", { status: 500 });
  return openRouterLab({ key, model: lab, body, signal: req.signal, course, log: (result, call) => logCall(result, { feature: "lab", ...call }) });
}
