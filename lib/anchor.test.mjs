// Run with: pnpm test   (Node strips the TypeScript types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { findAll, searchable } from "./anchor.ts";

test("a phrase is found across elements and broken-up whitespace", () => {
  const texts = ["A layer wants ", "more than", "\n    one answer. A layer wants more."];
  const places = findAll(texts, "more than one answer");
  assert.equal(places.length, 1);
  assert.deepEqual(places[0], { start: [1, 0], end: [2, 15] });
  assert.equal(texts[2].slice(0, places[0].end[1]).trim(), "one answer");
});

test("every occurrence is returned, in order", () => {
  const places = findAll(["the matrix, ", "and the matrix again"], "the matrix");
  assert.deepEqual(places.map((p) => p.start), [[0, 0], [1, 4]]);
});

test("a phrase with maths is looked for by its longest plain part", () => {
  assert.equal(searchable("the sum $\\sum_i x_i$ over all inputs"), "over all inputs");
  assert.equal(searchable("$W_{ij}$ is"), "");
  assert.equal(searchable("  spread\n out  "), "spread out");
});

test("nothing found is an empty list", () => {
  assert.deepEqual(findAll(["hello world"], "goodbye"), []);
  assert.deepEqual(findAll(["hello"], ""), []);
});

test("when it isn't there as written, case is ignored", () => {
  const places = findAll(["draw and constrain geometry with a light pen."], "Light pen");
  assert.deepEqual(places, [{ start: [0, 35], end: [0, 44] }]);
  assert.equal(findAll(["Light pen and light pen"], "Light pen").length, 1); // an exact match wins
});

test("a highlight across blocks is found whether a space was taken where they meet or not", () => {
  // a heading "UI" right before a paragraph: no whitespace between their text nodes
  const page = ["Lee, Imagining interfaces to language models · UI", "Each section shows 3–5 chips"];
  const glued = findAll(page, "UIEach section"); // taken before blocks were spaced
  const spaced = findAll(page, "UI Each section"); // taken now
  assert.deepEqual(glued, [{ start: [0, 47], end: [1, 12] }]);
  assert.deepEqual(spaced, glued);
  // and the other way: a page with whitespace between the blocks still finds the glued phrase
  assert.deepEqual(findAll(["UI", "\n  ", "Each section"], "UIEach section"), [{ start: [0, 0], end: [2, 12] }]);
});

test("whitespace is ignored only when the phrase isn't there with it", () => {
  assert.deepEqual(findAll(["the rapist", " and the therapist"], "the rapist"), [{ start: [0, 0], end: [0, 10] }]);
});
