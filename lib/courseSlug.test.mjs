import { test } from "node:test";
import assert from "node:assert/strict";
import { slugOf } from "./courseSlug.ts";

test("a topic becomes a folder name: lowercase words joined by dashes", () => {
  assert.equal(slugOf("How Transformers work?"), "how-transformers-work");
  assert.equal(slugOf("  C++ & Rust: memory safety "), "c-rust-memory-safety");
  assert.equal(slugOf("Café crème"), "cafe-creme");
});

test("long topics are cut at a word, short of 40 characters", () => {
  const s = slugOf("the history and philosophy of mathematics from euclid to godel and beyond");
  assert.ok(s.length <= 40);
  assert.equal(s, "the-history-and-philosophy-of");
});

test("a topic with no letters or digits has no name", () => {
  assert.equal(slugOf("?!… —"), "");
  assert.equal(slugOf("日本語"), "");
});
