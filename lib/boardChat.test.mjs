// Run with: pnpm test   (Node strips the TypeScript types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { threadTitle } from "./boardChat.ts";

test("threadTitle names a thread from its first question", () => {
  assert.equal(threadTitle("What is a tensor?"), "What is a tensor");
  assert.equal(threadTitle("  how   does  softmax  work  "), "how does softmax work");
  assert.equal(threadTitle("“Explain attention”"), "Explain attention");
});

test("threadTitle caps a long question on a word boundary with an ellipsis", () => {
  const long = "Can you walk me through how backpropagation updates the weights step by step please";
  const out = threadTitle(long);
  assert.ok(out.length <= 41, out);
  assert.ok(out.endsWith("…"), out);
  assert.ok(!/ …$/.test(out), "no space before the ellipsis");
});

test("threadTitle falls back to a name when the question is empty", () => {
  assert.equal(threadTitle(""), "New chat");
  assert.equal(threadTitle("   "), "New chat");
  assert.equal(threadTitle("???"), "New chat");
});
