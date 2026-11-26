// Run with: pnpm test   (Node strips the TypeScript types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { entryFor, label, matchFor, norm, scopeKey, toEntries, wholeWords } from "./gloss.ts";

const entries = toEntries([
  { term: "neuron", def: "A unit that sums its inputs.", also: ["neurons", "one neuron", "single neuron"] },
  { term: "single-layer network", def: "A network with one neuron." },
  { term: "decision boundary", def: "Where z equals 0." },
  { term: "sigmoid", def: "An S-shaped squash.", also: ["σ"] },
  { term: "forward pass", def: "Computing the outputs." },
  { term: "corner", def: "One of the four points." },
  { term: "XOR", def: "Exclusive or.", also: ["exclusive or"] },
  { term: "OR", def: "A gate that is 1 when either input is." },
  { term: "AND", def: "A gate that is 1 when both inputs are." },
]);

/** A highlight of `words` where they first stand in `around`. */
const pick = (around, words, scope) => {
  const start = around.indexOf(words);
  assert.notEqual(start, -1, `"${words}" is not in the passage`);
  return { text: words, around, start, end: start + words.length, scope };
};
const termOf = (around, words, scope) => matchFor(entries, pick(around, words, scope))?.entry.term ?? null;
const lockOf = (around, words) => {
  const m = matchFor(entries, pick(around, words));
  return m && around.slice(m.start, m.end);
};

test("norm: case, punctuation and plural endings go", () => {
  assert.equal(norm("Single-layer  Networks,"), "single layer network");
  assert.equal(norm("boundaries"), "boundary");
  assert.equal(norm("the loss"), "the loss");
});

test("toEntries: a term is found by each of its spellings, once", () => {
  const es = toEntries([{ term: "sigmoid", def: "d", also: ["σ", "Sigmoid"] }, { term: "sigmoids", def: "other" }]);
  assert.deepEqual(es.map((e) => e.key), ["sigmoid", "σ"]);
  assert.equal(es[1].term, "sigmoid");
});

test("a highlight that is a term gets that term", () => {
  const p = "The sigmoid squashes, and the decision boundary is where it sits on the fence.";
  assert.equal(termOf(p, "sigmoid"), "sigmoid");
  assert.equal(termOf(p, "decision boundary"), "decision boundary");
  assert.equal(lockOf(p, "decision boundary"), "decision boundary");
});

test("small words at the ends don't count, and the lock sits on the term", () => {
  const p = "The single-layer network is one neuron.";
  assert.equal(termOf(p, "The single-layer network"), "single-layer network");
  assert.equal(lockOf(p, "The single-layer network"), "single-layer network");
  assert.equal(termOf("Each of the corners has a target.", "the corners"), "corner");
});

test("half a term, mid-drag, completes to the term the text has there", () => {
  const p = "Its whole forward pass is one line, and the decision boundary is z = 0.";
  assert.equal(termOf(p, "forward pa"), "forward pass");
  assert.equal(lockOf(p, "forward pa"), "forward pass");
  assert.equal(lockOf(p, "decision bou"), "decision boundary");
  assert.equal(termOf(p, "decision"), "decision boundary", "a whole word of a term the text has around it");
});

test("words that are only part of a longer term elsewhere are not that term", () => {
  // reported: "network" showed "single-layer network"
  const p = "A network that shrugs and answers 0.5 everywhere misses every target by 0.5.";
  assert.equal(termOf(p, "network"), null);
});

test("a longer highlight is never defined by one term inside it", () => {
  // reported: a sentence latched onto one of its words
  const p = "The single-layer network is one neuron. Each corner shows its target.";
  assert.equal(termOf(p, "single-layer network is one neuron"), null);
  assert.equal(termOf(p, "Each corner shows its target"), null);
  assert.equal(termOf("The sigmoid, which squashes any number.", "sigmoid, which squashes"), null);
});

test("an acronym is itself only in capitals", () => {
  // found in testing: "and" in a sentence matched the AND gate
  assert.equal(termOf("Squaring makes it positive and punishes big misses.", "and"), null);
  assert.equal(termOf("Its target is 0 or 1.", "0 or 1"), null);
  assert.equal(termOf("Its target is 0 or 1.", "or"), null);
  assert.equal(termOf("An OR gate is 1 when either input is.", "OR"), "OR");
  assert.equal(termOf("XOR is not linearly separable.", "XOR"), "XOR");
  assert.equal(termOf('XOR ("exclusive or") is 1 when exactly one input is.', "exclusive or"), "XOR");
});

test("an entry written for one passage holds only there", () => {
  const here = {};
  const live = entryFor("network", "Here, a model that has learned nothing.", here);
  const p = "A network that shrugs.";
  assert.equal(matchFor([...entries, live], pick(p, "network", here))?.entry.def, "Here, a model that has learned nothing.");
  assert.equal(matchFor([...entries, live], pick(p, "network", {})), null);
  assert.equal(matchFor([...entries, live], pick(p, "network")), null);
});

test("a highlight that starts before this passage is matched by its words, not by where it sits", () => {
  assert.equal(matchFor(entries, { text: "sigmoid", around: "A paragraph without the word.", start: 0, end: 29 })?.entry.term, "sigmoid");
});

test("label: one line, cut with an ellipsis", () => {
  assert.equal(label("  a\n  short one "), "a short one");
  assert.equal(label("x".repeat(60)).length, 48);
  assert.ok(label("x".repeat(60)).endsWith("…"));
});

test("wholeWords: an end inside a word moves out to the word's edge", () => {
  // reported: a pause mid-drag at "Neural Ne" asked the model about half a word, then again for "Neural Net"
  const p = "Then click Neural Net and train the single-layer network.";
  assert.equal(wholeWords(pick(p, "Neural Ne")).text, "Neural Net");
  assert.equal(wholeWords(pick(p, "eural Net")).text, "Neural Net");
  assert.equal(wholeWords(pick(p, "Neural Net")).text, "Neural Net");
  assert.equal(wholeWords(pick(p, "single-la")).text, "single-layer", "a hyphen joins a word");
  const w = wholeWords(pick(p, "ural N"));
  assert.equal(p.slice(w.start, w.end), "Neural Net");
});

test("wholeWords: words already whole, or a highlight its paragraph doesn't hold, stay as they are", () => {
  const p = "Train the network.";
  assert.equal(wholeWords(pick(p, "the network")).text, "the network");
  assert.equal(wholeWords({ text: "across two paragraphs", around: p, start: 0, end: 5 }).text, "across two paragraphs");
});

test("scopeKey: the same paragraph text gives the same key, any change another", () => {
  assert.equal(scopeKey("Then click  Neural Net."), scopeKey("Then click Neural Net."));
  assert.notEqual(scopeKey("Then click Neural Net."), scopeKey("Then click Neural Nets."));
});

test("a definition kept for a paragraph is found again by the same words there, a half word too", () => {
  const p = "Then click Neural Net and train it.";
  const scope = scopeKey(p);
  const live = entryFor("Neural Net", "A tool in the course repo for training small networks.", scope);
  const es = [...entries, live];
  const h = (words) => ({ ...pick(p, words), scope });
  assert.equal(matchFor(es, h("Neural Net"))?.entry.def, live.def);
  assert.equal(matchFor(es, { ...h("Neural Ne"), ...wholeWords(h("Neural Ne")) })?.entry.def, live.def);
  assert.equal(matchFor(es, { ...pick(p, "Neural Net"), scope: scopeKey("Another paragraph.") }), null);
});
