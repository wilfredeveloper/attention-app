// Run with: pnpm test   (Node strips the TypeScript types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { shownPrefix } from "./lab/text/words.ts";

const text = "Every constraint is satisfied—output 1 only when the inputs differ.\nThen the next line.";

test("the shown text is what the lines cover, character for character", () => {
  assert.equal(shownPrefix(text, ["Every constraint is", "satisfied—output 1 only"]), "Every constraint is satisfied—output 1 only");
});

test("a line that breaks inside a word (at a dash) adds no word past it", () => {
  // counting words would make this "satisfied—" + "output" two words, and report "…satisfied—output 1"
  assert.equal(shownPrefix(text, ["Every constraint is satisfied—", "output"]), "Every constraint is satisfied—output");
  assert.equal(shownPrefix(text, ["Every constraint is satisfied—"]), "Every constraint is satisfied—");
});

test("line breaks of the text itself are kept", () => {
  assert.equal(shownPrefix(text, ["Every constraint is satisfied—output 1 only when the inputs differ.", "Then the"]), "Every constraint is satisfied—output 1 only when the inputs differ.\nThen the");
});

test("a line that isn't next in the text gives no answer", () => {
  assert.equal(shownPrefix(text, ["Every constraint", "the next line"]), undefined);
  assert.equal(shownPrefix(text, ["nothing like it"]), undefined);
  assert.equal(shownPrefix(text, []), "");
});
