// The Steer live lab's text calls on an OpenRouter model, when the Models tab picks one instead of Haiku through the claude CLI
// (app/api/lab/complete). The lab's OpenAI-style body goes to OpenRouter and the SSE stream comes straight back, so
// lib/lab/llm/cerebras.ts reads it as before. Each call is logged once as it ends, in the shape lib/calls.ts reads from the CLI.
// Server only. Node built-ins only, so lib/labOpenRouter.test.mjs can run it against a fake fetch.

import type { CallLog } from "./labPool";

/** What `log` gets: the CLI's result shape (lib/calls.ts), built from OpenRouter's closing usage chunk, or null without one. */
export type OpenRouterResult = {
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
  total_cost_usd: number;
  modelUsage: Record<string, { outputTokens: number }>;
};

type Usage = { prompt_tokens?: number; completion_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number } };

/** The request OpenRouter gets for one lab call. gpt-oss stays pinned to Cerebras with low, hidden reasoning, as /api/spaceship/complete
    sends it. Every other model gets reasoning off: measured on DeepSeek V4 Flash, "low" reasoning added up to a second before the
    first word and once leaked its plan into the text. A model that can't turn reasoning off answers with an error the lab shows. */
export function requestFor(model: string, body: { messages?: unknown; temperature?: unknown; max_completion_tokens?: unknown }) {
  const gptOss = model === "openai/gpt-oss-120b";
  return {
    model,
    stream: true,
    messages: body.messages,
    temperature: body.temperature,
    max_tokens: body.max_completion_tokens,
    reasoning: gptOss ? { effort: "low", exclude: true } : { enabled: false },
    ...(gptOss ? { provider: { order: ["cerebras"] } } : {}),
  };
}

export async function openRouterLab(options: {
  key: string;
  model: string;
  body: unknown;
  signal: AbortSignal;
  course?: string;
  log?: (result: OpenRouterResult | null, call: CallLog) => void;
  fetch?: typeof fetch;
}): Promise<Response> {
  const { key, model, signal, course = "", log, fetch: send = fetch } = options;
  const body = options.body && typeof options.body === "object" ? (options.body as Record<string, unknown>) : null;
  if (!body || !Array.isArray(body.messages)) return new Response("the body needs messages", { status: 400 });

  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let usage: Usage | undefined;
  let logged = false;
  const done = (error?: string) => {
    if (logged) return;
    logged = true;
    const result: OpenRouterResult | null = usage
      ? {
          usage: {
            input_tokens: (usage.prompt_tokens ?? 0) - (usage.prompt_tokens_details?.cached_tokens ?? 0),
            output_tokens: usage.completion_tokens ?? 0,
            cache_read_input_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
          },
          total_cost_usd: usage.cost ?? 0,
          modelUsage: { [model]: { outputTokens: usage.completion_tokens ?? 0 } },
        }
      : null;
    log?.(result, { course, startedAt, firstTokenAt, ...(error ? { error } : {}) });
  };

  let upstream: Response;
  try {
    upstream = await send("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(requestFor(model, body)),
    });
  } catch (e) {
    done(signal.aborted ? "aborted" : `fetch failed: ${(e as Error).message}`);
    return new Response("OpenRouter didn’t answer", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    done(`HTTP ${upstream.status}: ${text.slice(0, 300)}`);
    return new Response(text || `OpenRouter answered ${upstream.status}`, { status: upstream.status || 502 });
  }

  // Passes every byte on unchanged, and reads the SSE lines on the side for the first text and the closing usage.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const read = (chunk: Uint8Array) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        if (firstTokenAt === null && json.choices?.[0]?.delta?.content) firstTokenAt = Date.now();
        if (json.usage) usage = json.usage;
      } catch {
        /* a comment or keep-alive line: nothing to read */
      }
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: end, value } = await reader.read();
        if (end) {
          done();
          controller.close();
          return;
        }
        read(value);
        controller.enqueue(value);
      } catch (e) {
        done(signal.aborted ? "aborted" : `stream failed: ${(e as Error).message}`);
        controller.error(e);
      }
    },
    cancel() {
      done("aborted");
      return reader.cancel();
    },
  });
  return new Response(stream, { headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream" } });
}
