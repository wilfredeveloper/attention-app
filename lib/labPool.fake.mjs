// A stand-in for the `claude` CLI, for lib/labPool.test.mjs. Started the way the pool starts claude, it waits for one stream-json
// message on stdin and answers in stream-json lines, the way the message asks: "mode:<name>" anywhere in it picks how.
//   echo (the default): "pid <pid>|" and then the message itself, a few words a chunk, then a result
//   slow: a word every 50 ms, 200 words
//   silent: nothing at all
//   stall: one word, then nothing
//   long: 600 words as fast as it can
//   error: a result with is_error, as when the usage limit is reached
//   ratelimit: a rejected rate_limit_event, then nothing
//   die: an error on stderr, then exits before any text
// Like claude, it exits once its stdin closes.

import { createInterface } from "node:readline";

const out = (line) => process.stdout.write(JSON.stringify(line) + "\n");
const text = (t) => out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } } });
const result = (r, isError = false) =>
  out({
    type: "result",
    subtype: isError ? "error_during_execution" : "success",
    is_error: isError,
    result: r,
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
    modelUsage: { "claude-haiku-5-5": { outputTokens: 20 } },
    total_cost_usd: 0.0001,
  });

const lines = createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.once("line", async (line) => {
  const content = JSON.parse(line).message.content;
  const mode = content.match(/mode:(\w+)/)?.[1] ?? "echo";
  out({ type: "system", subtype: "init", model: "claude-haiku-5-5" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (mode === "echo") {
    const reply = `pid ${process.pid}|${content}`;
    for (let i = 0; i < reply.length; i += 20) text(reply.slice(i, i + 20));
    result(reply);
  } else if (mode === "slow") {
    for (let i = 0; i < 200; i++) {
      text(`w${i} `);
      await sleep(50);
    }
    result("slow");
  } else if (mode === "stall") {
    text("one ");
  } else if (mode === "long") {
    for (let i = 0; i < 600; i++) text(`w${i} `);
    result("long");
  } else if (mode === "error") {
    result("Claude AI usage limit reached|1763500000", true);
  } else if (mode === "ratelimit") {
    out({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } });
  } else if (mode === "die") {
    process.stderr.write("boom: something broke\n");
    process.exit(1);
  }
  // silent: says nothing, and waits to be killed
});
