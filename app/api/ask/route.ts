import { spawn } from "node:child_process";
import { logCall } from "@/lib/calls";
import { modelFor } from "@/lib/models";

// Local-only tutor endpoint. Uses the machine's logged-in Claude Code
// subscription (the `claude` CLI) — no API key. Streams the answer back as
// plain text. The learner highlights a passage in a lesson and asks about it.
// Started lean, like /api/explain (no tools, MCP servers, settings or default system
// prompt), and read as a token stream: the first words go out in about three seconds,
// where the whole answer used to arrive at the end (nine or more).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AskBody = {
  course?: string;
  courseSlug?: string;
  lesson?: string;
  heading?: string;
  selection?: string;
  context?: string;
  level?: string;
  question?: string;
  history?: { q: string; a: string }[];
  mode?: string; // "chat" = the free-form board chat (no highlighted passage); otherwise the passage tutor
  board?: string; // in chat mode: a digest of what is on the board right now (notes, cards, pages)
};

// How deep the learner asked this highlight to be explained.
const LEVELS: Record<string, { style: string; ask: string }> = {
  simple: {
    style:
      "They asked for the SIMPLE version: explain it as you would to a bright friend with no background. " +
      "Everyday words, one concrete analogy or example, no formulas, and any jargon either avoided or " +
      "defined in a few words. Answer in 2–3 short paragraphs, grounded in the passage below.",
    ask: "Explain this passage as simply as you can — what it means and why it matters here.",
  },
  mid: {
    style:
      "They learn visually, their maths is rusty, and they want intuition before formalism. " +
      "Answer in 2–4 short paragraphs, concrete and plain, grounded in the passage below.",
    ask: "Explain this passage simply — what it means and why it matters here.",
  },
  deep: {
    style:
      "They asked for the DEEP version: they are studying maths and calculus and want the real mechanism. " +
      "Use the proper vocabulary and show how each piece actually works. Include formulas only when the idea is " +
      "itself a calculation (model maths, probability, optimisation, a cost), with every symbol defined in words " +
      "(write maths as plain text or inline code; the panel cannot typeset LaTeX); a short derivation or worked " +
      "numbers are welcome there. For systems, software and process ideas, explain the real steps and parts in " +
      "words, with no formulas, and never invent notation for them. Start with one sentence of intuition, " +
      "then go deep; up to about 6 paragraphs, grounded in the passage below.",
    ask: "Explain this passage in depth — the mechanism behind it, the maths, and why it matters here.",
  },
};

// The free-form board chat: the learner asks anything, with whatever the board can tell the model about
// what they are reading and have gathered. Not tied to a highlighted passage.
function buildChatPrompt(b: AskBody): string {
  const parts: string[] = [];
  parts.push(
    "You are a sharp, friendly assistant beside someone studying on an interactive learning canvas. " +
      "Answer their question directly and conversationally in plain Markdown — short paragraphs, no preamble, " +
      "no restating the question. Code in fenced blocks when it helps; maths in LaTeX ($…$ inline, $$…$$ display) is typeset. " +
      "Lean on the context below when it is relevant, but answer whatever they actually ask.",
  );
  const where = [b.course && `course “${b.course}”`, b.lesson && `lesson “${b.lesson}”`, b.heading && `section “${b.heading}”`]
    .filter(Boolean)
    .join(", ");
  if (where) parts.push(`They are reading ${where}.`);
  if (b.board?.trim()) parts.push(`What is on their board right now:\n"""\n${b.board.trim()}\n"""`);
  for (const turn of b.history ?? []) parts.push(`Earlier — they said: ${turn.q}\nYou answered: ${turn.a}`);
  parts.push(`Their message: ${(b.question ?? "").trim() || "Hello."}`);
  return parts.join("\n\n");
}

function buildPrompt(b: AskBody): string {
  if (b.mode === "chat") return buildChatPrompt(b);
  const level = LEVELS[b.level ?? ""] ?? LEVELS.mid;
  const parts: string[] = [];
  parts.push(
    `You are the tutor for the course "${b.course ?? "this course"}". ` +
      `The learner is reading the lesson "${b.lesson ?? ""}"` +
      (b.heading ? `, in the section "${b.heading}".` : "."),
  );
  parts.push(
    level.style + " No preamble, no restating the question.",
  );
  if (b.selection) parts.push(`They highlighted this passage:\n"""\n${b.selection}\n"""`);
  if (b.context && b.context !== b.selection)
    parts.push(`Surrounding text, for context:\n"""\n${b.context}\n"""`);
  for (const turn of b.history ?? [])
    parts.push(`Earlier — they asked: ${turn.q}\nYou answered: ${turn.a}`);
  parts.push(
    b.question?.trim()
      ? `Their question: ${b.question.trim()}`
      : level.ask,
  );
  return parts.join("\n\n");
}

export async function POST(req: Request) {
  const body = (await req.json()) as AskBody;
  const prompt = buildPrompt(body);

  // stream-json with partial messages: the text goes out as it is written, and the final
  // "result" message (tokens, cost, model) is logged to calls.jsonl.
  const chat = body.mode === "chat";
  const model = await modelFor(chat ? "chat" : `ask.${LEVELS[body.level ?? ""] ? (body.level as "simple" | "mid" | "deep") : "mid"}`);
  const child = spawn(
    "claude",
    [
      "-p", prompt,
      "--model", model,
      "--system-prompt",
      chat
        ? "You are a helpful assistant answering one person as they study. Answer in plain Markdown."
        : "You are a patient tutor writing for one learner. Answer in plain Markdown.",
      "--tools", "",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );

  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));

  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let result: unknown = null;
  let cancelled = false;
  let logged = false;
  const log = (error?: string) => {
    if (logged) return;
    logged = true;
    const feature = chat ? "chat" : `ask.${LEVELS[body.level ?? ""] ? body.level : "mid"}`;
    logCall(result, { feature, course: body.courseSlug ?? body.course ?? "", startedAt, firstTokenAt, error });
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buf = "";
      let sent = false;
      child.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            const d = ev.type === "stream_event" ? ev.event : null;
            if (d?.type === "content_block_delta" && d.delta?.type === "text_delta") {
              firstTokenAt ??= Date.now();
              sent = true;
              controller.enqueue(new TextEncoder().encode(d.delta.text));
            } else if (ev.type === "result") {
              result = ev;
              // nothing streamed (an older CLI, or an error): the whole answer, as before
              if (!sent && typeof ev.result === "string") controller.enqueue(new TextEncoder().encode(ev.result));
            }
          } catch {
            /* not a JSON line */
          }
        }
      });
      child.stdout.on("end", () => controller.close());
      child.on("error", (err) => {
        log(`spawn: ${err.message}`);
        controller.error(new Error(`Failed to run claude: ${err.message}`));
      });
      child.on("close", (code) => {
        log(result ? undefined : cancelled ? "aborted" : stderr.trim().slice(0, 500) || `claude exited with code ${code}`);
        if (code !== 0 && stderr) {
          try {
            controller.enqueue(new TextEncoder().encode(`\n\n[tutor error] ${stderr.trim()}`));
          } catch {
            /* already closed */
          }
        }
      });
    },
    cancel() {
      cancelled = true;
      child.kill("SIGTERM");
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
