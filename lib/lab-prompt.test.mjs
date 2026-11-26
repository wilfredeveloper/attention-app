// Run with: pnpm test   (Node strips the TypeScript types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TOPIC,
  STEERED_SYSTEM_PROMPT,
  STORY_SYSTEM_PROMPT,
  clipWaysUser,
  headingOf,
  parseWays,
  sameSources,
  steeredUserMessage,
  storyUserMessage,
} from "./lab/story/prompt.ts";

const sources = [
  { quote: "Attention lets each token\nlook at every other token.", where: "Lesson 3 · Self-attention", around: "Before that, RNNs read one token at a time." },
  { quote: "Keys and queries are compared by a dot product.", where: "", around: "" },
];

test("a topic becomes a heading the text continues after", () => {
  assert.equal(headingOf("How LoRA works"), "How LoRA works:");
  assert.equal(headingOf("  hash tables  "), "hash tables:");
  assert.equal(headingOf("Why do layers need a bend?"), "Why do layers need a bend?");
  assert.equal(headingOf("Gradients:"), "Gradients:");
});

test("no topic starts on the default one", () => {
  assert.equal(headingOf(""), `${DEFAULT_TOPIC}:`);
  assert.equal(headingOf("   "), `${DEFAULT_TOPIC}:`);
});

test("without sources the unsteered call sends the text alone, as before", () => {
  assert.equal(storyUserMessage("Attention heads: each one", []), "Attention heads: each one");
});

test("with sources the unsteered call lists them first, then the text so far", () => {
  assert.equal(
    storyUserMessage("Attention heads: each one", sources),
    [
      "SOURCES",
      '[1] From Lesson 3 · Self-attention: "Attention lets each token look at every other token."',
      "Around it: Before that, RNNs read one token at a time.",
      '[2] "Keys and queries are compared by a dot product."',
      "",
      "TEXT SO FAR",
      "Attention heads: each one",
    ].join("\n"),
  );
});

test("the steered call keeps its blocks, and leaves out what is empty", () => {
  assert.equal(
    steeredUserMessage("Attention heads: each one", { phrases: ["each [head] looks"], controls: [] }, []),
    "KEY PHRASES\neach [head] looks\n\nTEXT SO FAR\nAttention heads: each one",
  );
});

test("the steered call puts the sources before the steering", () => {
  const message = steeredUserMessage("Attention heads: each one", { phrases: ["each [head] looks"], controls: ["depth: very mechanism (strong)"] }, sources);
  const order = ["SOURCES", "KEY PHRASES", "CONTROLS", "TEXT SO FAR"].map((header) => message.indexOf(`${header}\n`));
  assert.ok(order.every((at) => at >= 0), message);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(message.endsWith("TEXT SO FAR\nAttention heads: each one"));
});

test("both system prompts say how to use sources", () => {
  for (const prompt of [STORY_SYSTEM_PROMPT, STEERED_SYSTEM_PROMPT]) {
    assert.match(prompt, /SOURCES/);
    assert.match(prompt, /ground the explanation in them/);
    assert.match(prompt, /don't quote them back/);
  }
});

test("both system prompts ask for math as plain text, never LaTeX", () => {
  for (const prompt of [STORY_SYSTEM_PROMPT, STEERED_SYSTEM_PROMPT]) assert.match(prompt, /Never LaTeX: no backslashes, no dollar signs/);
});

// ---- per-clip weight (slice 3) ----

const weighted = [
  { quote: "Attention lets each token look at every other token.", where: "Lesson 3", around: "", weight: "strong" },
  { quote: "Keys and queries are compared by a dot product.", where: "", around: "", weight: "slight" },
  { quote: "Softmax turns scores into weights.", where: "", around: "", weight: "moderate" },
];

test("a source's weight is spelled out, but moderate (the default) is left unmarked", () => {
  assert.equal(
    storyUserMessage("The text", weighted),
    [
      "SOURCES",
      '[1] From Lesson 3: "Attention lets each token look at every other token." (weight: strong)',
      '[2] "Keys and queries are compared by a dot product." (weight: slight)',
      '[3] "Softmax turns scores into weights."',
      "",
      "TEXT SO FAR",
      "The text",
    ].join("\n"),
  );
});

test("an ignored source is left out, and the kept ones are renumbered", () => {
  const sources = [
    { quote: "Kept one.", where: "", around: "", weight: "strong" },
    { quote: "Dropped one.", where: "", around: "", weight: "ignore" },
    { quote: "Kept two.", where: "", around: "", weight: "moderate" },
  ];
  assert.equal(
    storyUserMessage("The text", sources),
    'SOURCES\n[1] "Kept one." (weight: strong)\n[2] "Kept two."\n\nTEXT SO FAR\nThe text',
  );
});

test("when every source is ignored, the unsteered call sends the text alone", () => {
  assert.equal(storyUserMessage("The text", [{ quote: "x", where: "", around: "", weight: "ignore" }]), "The text");
});

test("the steered call drops ignored sources and spells out the rest's weight", () => {
  const message = steeredUserMessage(
    "The text",
    { phrases: ["a [key] idea"], controls: [] },
    [
      { quote: "Lean here.", where: "", around: "", weight: "strong" },
      { quote: "Not here.", where: "", around: "", weight: "ignore" },
    ],
  );
  assert.match(message, /SOURCES\n\[1\] "Lean here\." \(weight: strong\)/);
  assert.doesNotMatch(message, /Not here/);
});

test("both system prompts explain a source's weight, reusing strong and slight", () => {
  for (const prompt of [STORY_SYSTEM_PROMPT, STEERED_SYSTEM_PROMPT]) {
    assert.match(prompt, /weight/);
    assert.match(prompt, /strong/);
    assert.match(prompt, /slight/);
  }
});

test("sameSources counts a weight change as a different list", () => {
  const base = [{ quote: "q", where: "w", around: "a", weight: "moderate" }];
  assert.ok(sameSources(base, [{ quote: "q", where: "w", around: "a", weight: "moderate" }]));
  assert.ok(!sameSources(base, [{ quote: "q", where: "w", around: "a", weight: "strong" }]));
  assert.ok(!sameSources(base, [{ quote: "q", where: "w", around: "a", weight: "ignore" }]));
});

// ---- contextual ways to use a clip (slice 3, stage 2) ----

test("a source's use takes the place of its weight on the SOURCES line", () => {
  const message = storyUserMessage("The text", [
    { quote: "Attention lets each token look at every other token.", where: "Lesson 3", around: "", use: "make it the running example" },
    { quote: "Softmax turns scores into weights.", where: "", around: "", weight: "strong", use: "contrast it with the naive sum" },
  ]);
  assert.match(message, /\[1\] From Lesson 3: ".*" \(use: make it the running example\)/);
  // a use wins over a weight that is also set
  assert.match(message, /\[2\] "Softmax turns scores into weights\." \(use: contrast it with the naive sum\)/);
});

test("an ignored source is still dropped even with a use set", () => {
  assert.equal(storyUserMessage("The text", [{ quote: "x", where: "", around: "", weight: "ignore", use: "whatever" }]), "The text");
});

test("sameSources counts a use change as a different list", () => {
  const base = [{ quote: "q", where: "w", around: "a", use: "define its term" }];
  assert.ok(sameSources(base, [{ quote: "q", where: "w", around: "a", use: "define its term" }]));
  assert.ok(!sameSources(base, [{ quote: "q", where: "w", around: "a", use: "apply it to a case" }]));
  assert.ok(!sameSources(base, [{ quote: "q", where: "w", around: "a" }]));
});

test("both system prompts explain a source's use", () => {
  for (const prompt of [STORY_SYSTEM_PROMPT, STEERED_SYSTEM_PROMPT]) assert.match(prompt, /a use/);
});

test("clipWaysUser carries the passage, what's around it, and the topic", () => {
  const user = clipWaysUser({ quote: "a weighted sum", around: "each input times its weight", topic: "A layer is a table of weights" });
  assert.match(user, /Topic: A layer is a table of weights/);
  assert.match(user, /Passage: "a weighted sum"/);
  assert.match(user, /Around it: each input times its weight/);
  // the topic and around-it lines are left out when absent
  assert.equal(clipWaysUser({ quote: "a weighted sum" }), 'Passage: "a weighted sum"');
});

test("parseWays takes short imperative lines, strips bullets and numbering, dedupes, and caps at four", () => {
  const raw = "1. Make it the running example\n- Contrast it with the naive sum\n• Define its term\nmake it the running example\nApply it to a concrete case\nWarn about a pitfall here now please";
  const ways = parseWays(raw);
  assert.deepEqual(ways, ["Make it the running example", "Contrast it with the naive sum", "Define its term", "Apply it to a concrete case"]);
  // the duplicate (case aside) and the over-long 9-word line are dropped, and no more than four survive
});

test("parseWays returns undefined when nothing usable survives, so the dial falls back to the weight scale", () => {
  assert.equal(parseWays("\n   \nThis line is far too long to be a short imperative phrase for a dial option here\n"), undefined);
});
