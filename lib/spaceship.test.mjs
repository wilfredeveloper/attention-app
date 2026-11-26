// Run with: pnpm test   (Node strips the TypeScript types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLabModel, isSteerEvent, labModelStamp } from "./spaceship.ts";

test("each of the five lab events is accepted", () => {
  for (const e of [
    { type: "launch", phrase: "hash tables" },
    { type: "dial", on: true, dim: "depth", value: "very deep", position: 0.9, strength: 0.5 },
    { type: "pin", dim: "depth", sentence: "A hash maps keys to slots.", confidence: 0.8 },
    { type: "dragback", words: 12, discarded: "some words" },
    { type: "close", secs: 30, words: 120, dials: 2 },
  ])
    assert.equal(isSteerEvent(e), true, e.type);
});

test("an event missing a field, with a wrong type, or of an unknown type is refused", () => {
  assert.equal(isSteerEvent({ type: "dial", on: true, dim: "depth", value: "deep", position: 0.9 }), false);
  assert.equal(isSteerEvent({ type: "close", secs: "30", words: 1, dials: 0 }), false);
  assert.equal(isSteerEvent({ type: "pin", dim: "d", sentence: "s", confidence: Number.NaN }), false);
  assert.equal(isSteerEvent({ type: "zoom" }), false);
  assert.equal(isSteerEvent({ type: "toString" }), false);
  assert.equal(isSteerEvent({ type: "constructor" }), false);
  assert.equal(isSteerEvent(null), false);
});

test("the canvas lab's events name its text model and how it was reached, and the decide model", () => {
  assert.equal(labModelStamp("claude-haiku-5-5"), "claude-haiku-5-5 via claude CLI, typesafe/jev-1.14");
  assert.equal(labModelStamp("deepseek/deepseek-v4-flash"), "deepseek/deepseek-v4-flash via OpenRouter, typesafe/jev-1.14");
});

test("the lab's model is Haiku through the CLI or an OpenRouter model id", () => {
  for (const m of ["claude-haiku-5-5", "deepseek/deepseek-v4-flash", "openai/gpt-oss-120b", "~deepseek/deepseek-flash-latest", "deepseek/deepseek-v4.1-flash:batch"])
    assert.equal(isLabModel(m), true, m);
  for (const m of ["", "haiku", "claude-sonnet-5-5", "deepseek", "a/b c", "/x", "a/b/c", 3, null]) assert.equal(isLabModel(m), false, String(m));
});
