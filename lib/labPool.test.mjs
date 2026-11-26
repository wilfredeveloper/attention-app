// Run with: pnpm test   (Node strips the TypeScript types itself)
// The lab's claude pool (lib/labPool.ts), run against a fake `claude` (lib/labPool.fake.mjs) whose replies the message picks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createLabPool, messageOf } from "./labPool.ts";

const FAKE = fileURLToPath(new URL("./labPool.fake.mjs", import.meta.url));
const never = new AbortController().signal;

const body = (user, extra = {}) => ({
  messages: [
    { role: "system", content: "SYSTEM TEXT" },
    { role: "user", content: user },
  ],
  temperature: 0.9,
  max_completion_tokens: 2000,
  ...extra,
});

/** A pool on the fake, closed after the test, with every call it logs. */
function poolFor(t, options = {}) {
  const logs = [];
  const pool = createLabPool({ command: process.execPath, args: [FAKE], idle: 1, log: (result, call) => logs.push({ result, ...call }), ...options });
  t.after(() => pool.close());
  return { pool, logs };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check, ms = 3000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (check()) return;
  assert.fail("timed out waiting");
}

/** The text of an SSE reply, read as lib/lab/llm/cerebras.ts reads it; also checks every line is one it can read. */
async function textOf(response) {
  const raw = await response.text();
  assert.match(raw, /data: \[DONE\]\n\n$/);
  let text = "";
  for (const line of raw.split("\n")) {
    if (!line) continue;
    assert.ok(line.startsWith("data: "), line);
    const data = line.slice(5).trim();
    if (data !== "[DONE]") text += JSON.parse(data).choices[0].delta.content;
  }
  return text;
}

test("a call goes to the process that was waiting, with its system prompt on top, and comes back in the lab's SSE shape", async (t) => {
  const { pool, logs } = poolFor(t);
  await until(() => pool.snapshot().idle.length === 1);
  const [pid] = pool.snapshot().idle;
  await sleep(100);

  const response = await pool.respond(body("mode:echo explain hashing"), never, "ml-models");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
  assert.match(response.headers.get("X-Lab-Process"), /^warm, idle \d+ ms$/);
  const text = await textOf(response);
  assert.equal(text, `pid ${pid}|${messageOf("SYSTEM TEXT", "mode:echo explain hashing")}`);
  assert.ok(text.endsWith("<instructions>\nSYSTEM TEXT\n</instructions>\n\nmode:echo explain hashing"));

  assert.equal(logs.length, 1);
  assert.equal(logs[0].course, "ml-models");
  assert.equal(logs[0].error, undefined);
  assert.ok(logs[0].firstTokenAt >= logs[0].startedAt);
  assert.equal(logs[0].result.usage.output_tokens, 20);
});

test("the process is killed after its one call, and a new one waits in its place", async (t) => {
  const { pool } = poolFor(t);
  await until(() => pool.snapshot().idle.length === 1);
  const [served] = pool.snapshot().idle;
  await textOf(await pool.respond(body("mode:echo hi"), never));
  await until(() => !alive(served));
  await until(() => pool.snapshot().idle.length === 1);
  assert.notEqual(pool.snapshot().idle[0], served);
  assert.deepEqual(pool.snapshot().busy, []);
});

test("with none waiting, a call starts a process of its own", async (t) => {
  const { pool } = poolFor(t, { idle: 0 });
  const response = await pool.respond(body("mode:echo hi"), never);
  assert.equal(response.headers.get("X-Lab-Process"), "cold");
  assert.match(await textOf(response), /^pid \d+\|/);
});

test("past the cap on calls at once, a call gets a 429 at once", async (t) => {
  const { pool } = poolFor(t, { idle: 2, maxActive: 2 });
  const first = await pool.respond(body("mode:slow"), never);
  const second = await pool.respond(body("mode:slow"), never);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const started = Date.now();
  const third = await pool.respond(body("mode:echo"), never);
  assert.equal(third.status, 429);
  assert.ok(Date.now() - started < 100);
  await first.body.cancel();
  // a slot is free again
  assert.equal((await pool.respond(body("mode:echo"), never)).status, 200);
  await second.body.cancel();
});

test("past the calls a minute, a call gets a 429", async (t) => {
  const { pool } = poolFor(t, { perMinute: 3 });
  for (let i = 0; i < 3; i++) await textOf(await pool.respond(body("mode:echo"), never));
  const over = await pool.respond(body("mode:echo"), never);
  assert.equal(over.status, 429);
  assert.match(await over.text(), /3 lab calls a minute/);
});

test("a call the client aborts kills its process, mid-stream or before its first token", async (t) => {
  const { pool, logs } = poolFor(t, { idle: 2 });
  await until(() => pool.snapshot().idle.length === 2);

  const midway = new AbortController();
  const streaming = await pool.respond(body("mode:slow"), midway.signal);
  assert.equal(streaming.status, 200);
  const [pid] = pool.snapshot().busy;
  midway.abort();
  await until(() => !alive(pid));
  assert.equal(logs.at(-1).error, "aborted");

  const early = new AbortController();
  const waiting = pool.respond(body("mode:silent"), early.signal);
  await sleep(50);
  const [silent] = pool.snapshot().busy;
  early.abort();
  assert.equal((await waiting).status, 499);
  await until(() => !alive(silent));

  // the client going away cancels the body: the same
  const cancelled = await pool.respond(body("mode:slow"), never);
  const [third] = pool.snapshot().busy;
  await cancelled.body.cancel();
  await until(() => !alive(third));
  assert.deepEqual(pool.snapshot().busy, []);
});

test("no first token in time: the process is killed and the call gets a 504", async (t) => {
  const { pool, logs } = poolFor(t, { firstTokenMs: 300 });
  const started = Date.now();
  const waiting = pool.respond(body("mode:silent"), never);
  await sleep(50);
  const [pid] = pool.snapshot().busy;
  const response = await waiting;
  assert.equal(response.status, 504);
  assert.ok(Date.now() - started < 1000);
  await until(() => !alive(pid));
  assert.match(logs[0].error, /no first token in 300 ms/);
});

test("silence mid-stream: the process is killed and the stream breaks, so the lab retries", async (t) => {
  const { pool, logs } = poolFor(t, { silenceMs: 300 });
  const response = await pool.respond(body("mode:stall"), never);
  assert.equal(response.status, 200);
  const [pid] = pool.snapshot().busy;
  await assert.rejects(response.text());
  await until(() => !alive(pid));
  assert.match(logs[0].error, /no output for 300 ms/);
});

test("an error result pauses the pool: quick 503s and no new processes, then it starts again", async (t) => {
  const { pool, logs } = poolFor(t, { idle: 2, breakerMs: 500 });
  await until(() => pool.snapshot().idle.length === 2);
  const failed = await pool.respond(body("mode:error"), never);
  assert.equal(failed.status, 503);
  assert.match(await failed.text(), /usage limit reached/);
  assert.match(logs[0].error, /usage limit reached/);
  await sleep(100);
  assert.deepEqual(pool.snapshot(), { idle: [], busy: [], paused: true });

  const started = Date.now();
  const meanwhile = await pool.respond(body("mode:echo"), never);
  assert.equal(meanwhile.status, 503);
  assert.match(await meanwhile.text(), /paused for 1 s more/);
  assert.ok(Date.now() - started < 50);
  assert.deepEqual(pool.snapshot().busy, []);

  await until(() => pool.snapshot().idle.length === 2);
  assert.equal(pool.snapshot().paused, false);
  assert.equal((await pool.respond(body("mode:echo"), never)).status, 200);
});

test("a rejected rate limit event pauses the pool too", async (t) => {
  const { pool } = poolFor(t, { breakerMs: 500 });
  assert.equal((await pool.respond(body("mode:ratelimit"), never)).status, 503);
  assert.equal(pool.snapshot().paused, true);
});

test("a process that dies mid-call gives a 502 with what it said", async (t) => {
  const { pool } = poolFor(t);
  const response = await pool.respond(body("mode:die"), never);
  assert.equal(response.status, 502);
  assert.match(await response.text(), /boom: something broke/);
  assert.equal(pool.snapshot().paused, false);
});

test("an idle process that dies is replaced", async (t) => {
  const { pool } = poolFor(t, { idle: 2, respawnMs: 50 });
  await until(() => pool.snapshot().idle.length === 2);
  const [dead, kept] = pool.snapshot().idle;
  process.kill(dead, "SIGKILL");
  await until(() => pool.snapshot().idle.length === 2 && !pool.snapshot().idle.includes(dead));
  assert.ok(pool.snapshot().idle.includes(kept));
});

test("a reply past max_completion_tokens is cut, its process killed, and the stream still ends cleanly", async (t) => {
  const { pool, logs } = poolFor(t);
  const response = await pool.respond(body("mode:long", { max_completion_tokens: 30 }), never);
  const [pid] = pool.snapshot().busy;
  const text = await textOf(response);
  assert.equal(text.trim().split(/\s+/).length, 23); // the first past 30 tokens, at 4 tokens to 3 words
  await until(() => !alive(pid));
  assert.match(logs[0].error, /cut at max_completion_tokens \(30\)/);
});

test("a body without a user message gets a 400", async (t) => {
  const { pool } = poolFor(t);
  assert.equal((await pool.respond({ messages: [{ role: "system", content: "x" }] }, never)).status, 400);
  assert.equal((await pool.respond(null, never)).status, 400);
});

test("without a system prompt the message is the user's text alone", () => {
  assert.equal(messageOf("  ", "hello"), "hello");
});
