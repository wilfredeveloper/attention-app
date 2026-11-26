// Run with: pnpm test   (Node strips the TypeScript types itself)
// The lab's OpenRouter path (lib/labOpenRouter.ts), against a fake fetch: what it sends, that the stream passes through, and what it logs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openRouterLab, requestFor } from "./labOpenRouter.ts";

const never = new AbortController().signal;
const body = { messages: [{ role: "user", content: "go on" }], temperature: 0.9, max_completion_tokens: 500 };
const sse = (...events) => events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
const delta = (content) => ({ choices: [{ delta: { content } }] });
const usage = { prompt_tokens: 120, completion_tokens: 20, cost: 0.00001, prompt_tokens_details: { cached_tokens: 100 } };

function fakeFetch(text, status = 200) {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return new Response(text, { status, headers: { "Content-Type": "text/event-stream" } });
  };
  return { fetch, sent };
}

test("gpt-oss keeps its Cerebras pin and low hidden reasoning; other models get reasoning off and no pin", () => {
  const oss = requestFor("openai/gpt-oss-120b", body);
  assert.deepEqual(oss.reasoning, { effort: "low", exclude: true });
  assert.deepEqual(oss.provider, { order: ["cerebras"] });
  const ds = requestFor("deepseek/deepseek-v4-flash", body);
  assert.deepEqual(ds.reasoning, { enabled: false });
  assert.equal(ds.provider, undefined);
  assert.equal(ds.max_tokens, 500);
  assert.equal(ds.stream, true);
});

test("passes the stream through unchanged and logs tokens, cost and the first word", async () => {
  const text = sse(delta(""), delta("Hello"), delta(" there"), { choices: [], usage }, "[DONE]");
  const { fetch, sent } = fakeFetch(text);
  const logs = [];
  const res = await openRouterLab({ key: "k", model: "deepseek/deepseek-v4-flash", body, signal: never, course: "c", fetch, log: (r, c) => logs.push({ r, c }) });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), text);
  assert.equal(sent[0].auth, "Bearer k");
  assert.equal(sent[0].body.model, "deepseek/deepseek-v4-flash");
  assert.equal(logs.length, 1);
  const { r, c } = logs[0];
  assert.deepEqual(r.usage, { input_tokens: 20, output_tokens: 20, cache_read_input_tokens: 100 });
  assert.equal(r.total_cost_usd, 0.00001);
  assert.deepEqual(Object.keys(r.modelUsage), ["deepseek/deepseek-v4-flash"]);
  assert.equal(c.course, "c");
  assert.equal(c.error, undefined);
  assert.ok(c.firstTokenAt >= c.startedAt);
});

test("an upstream error comes back with its status and is logged as failed", async () => {
  const { fetch } = fakeFetch('{"error":{"message":"no such model"}}', 400);
  const logs = [];
  const res = await openRouterLab({ key: "k", model: "x/y", body, signal: never, fetch, log: (r, c) => logs.push({ r, c }) });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /no such model/);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].r, null);
  assert.match(logs[0].c.error, /^HTTP 400/);
});

test("a body without messages is a 400 and never reaches OpenRouter", async () => {
  const { fetch, sent } = fakeFetch("");
  const res = await openRouterLab({ key: "k", model: "x/y", body: { nope: 1 }, signal: never, fetch });
  assert.equal(res.status, 400);
  assert.equal(sent.length, 0);
});

test("a reader that stops early is logged once, as aborted", async () => {
  const { fetch } = fakeFetch(sse(delta("Hi"), delta(" more")));
  const logs = [];
  const res = await openRouterLab({ key: "k", model: "x/y", body, signal: never, fetch, log: (r, c) => logs.push(c) });
  const reader = res.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].error, "aborted");
});
