// Run with: pnpm test   (Node strips the TypeScript types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILD, count, cueTimes, easeInOut, easeOut, mix } from "./motion.ts";

test("mix blends numbers, in anything of the same shape", () => {
  assert.equal(mix("10", "20", 0.5), "15");
  assert.equal(mix("0.2", "1", 0.25), "0.4");
  assert.equal(mix("translate(10,20)", "translate(30,-20)", 0.5), "translate(20,0)");
  assert.equal(mix("M0 0 L10 10", "M4 0 L10 30", 0.5), "M2 0 L10 20");
  assert.equal(mix("10,10 20,20", "20,10 20,40", 0.1), "11,10 20,22");
});

test("mix blends colours", () => {
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mix("#fff", "#000", 0.5), "#808080");
  assert.equal(mix("#234be7", "#234be7", 0.3), "#234be7");
});

test("mix switches halfway when the two can't blend", () => {
  assert.equal(mix("none", "#ffffff", 0.4), "none");
  assert.equal(mix("none", "#ffffff", 0.6), "#ffffff");
  assert.equal(mix("M0 0 L10 10", "M0 0 C1 2 3 4 5 6", 0.4), "M0 0 L10 10");
  assert.equal(mix("10 20", "10", 0.9), "10");
});

test("mix starts at a and ends at b exactly", () => {
  assert.equal(mix("1.005", "2", 0), "1.005");
  assert.equal(mix("1", "2.005", 1), "2.005");
});

test("easings run from 0 to 1", () => {
  for (const ease of [easeInOut, easeOut]) {
    assert.equal(ease(0), 0);
    assert.equal(ease(1), 1);
    assert.ok(ease(0.3) < ease(0.6));
  }
});

test("a part with a cue comes in just before its word is spoken", () => {
  const narration = "Each token makes a query, and every other token offers a key."; // 61 characters
  const [query, key] = cueTimes(narration, ["query", "key"], 10);
  assert.ok(Math.abs(query - (narration.indexOf("query") / narration.length) * 10 + 0.2) < 1e-9);
  assert.ok(key > query);
  assert.ok(key <= 10 - BUILD - 0.3 + 1e-9); // built before the scene ends
});

test("parts without a cue, or with a word that isn't said, take their turn in order", () => {
  const at = cueTimes("One two three four five six seven eight.", [null, "missing", null], 8);
  assert.ok(at[0] < at[1] && at[1] < at[2]);
  assert.ok(at[0] >= 0.15);
});

test("cue times stay inside a very short scene", () => {
  for (const t of cueTimes("Hi there.", ["hi", "there", null], 0.6)) assert.ok(t >= 0.15 && t <= 0.6);
  assert.deepEqual(cueTimes("Anything.", [], 5), []);
});

test("a number counts to its new value, with the decimals it ends with", () => {
  assert.equal(count("0", "11", 0.5), "6");
  assert.equal(count("8", "0", 0.25), "6");
  assert.equal(count("0.2", "0.90", 0.5), "0.55");
  assert.equal(count("3", "-1", 1), "-1");
  assert.equal(count("1", "2.5", 0), "1.0");
});
