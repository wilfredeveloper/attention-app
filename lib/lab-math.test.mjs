// Run with: pnpm test   (Node strips the TypeScript types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainMath, plainMathStream, readyEnd } from "./lab/text/plain-math.ts";

/** What the lab gets from `deltas`, joined. */
async function streamed(deltas) {
  let out = "";
  for await (const chunk of plainMathStream((async function* () { yield* deltas; })())) out += chunk;
  return out;
}

// Written by the lab's model before its prompts asked for plain math (gpt-oss-120b, steered toward technical terms).
const LEAK =
  "consider a simple linear regression model \\(y = w x + b\\) trained on a single data point \\((x=3,\\,y_{\\text{true}}=7)\\) " +
  "with mean-squared-error loss \\(L = (y_{\\text{true}} - (w x + b))^{2}\\). Computing the gradient yields " +
  "\\(\\partial L/\\partial w = -2 x\\) and, with \\(\\eta = 0.1\\), \\(w_{\\text{new}} = 1 + 2.4\\). The sum \\(\\sum_{i=1}^{64} q_i k_i\\) " +
  "is \\frac{\\partial L}{\\partial w} for \\(\\mathbf{x}\\) in \\((0,1)\\).";

test("text without LaTeX is left as it is", () => {
  for (const text of [
    "A neuron adds its weighted inputs: 2 × 3 + 1 × -1 = 5, so (0,1) and (1,0) land on one side.",
    "It costs $5, or $0.002 per token, and echo $HOME/$USER prints a path.",
    "x1, x², y_true, e^30 and the set {0, 1} read fine as they are.",
    "A regex like \\d+ or a path like C:\\Users\\name keeps its backslashes.",
  ])
    assert.equal(plainMath(text), text);
});

test("the LaTeX the lab used to show reads as plain text", () => {
  assert.equal(plainMath("\\(x_1, x_2\\)"), "x_1, x_2");
  assert.equal(plainMath("\\(\\mathbf{x}\\)"), "x");
  assert.equal(plainMath("\\((0,1)\\)"), "(0,1)");
  assert.equal(plainMath("$x_{1}$ and $x$, $$\\mathbf{y}$$"), "x₁ and x, y");
  assert.equal(
    plainMath(LEAK),
    "consider a simple linear regression model y = w x + b trained on a single data point (x=3, y_true=7) " +
      "with mean-squared-error loss L = (y_true - (w x + b))². Computing the gradient yields " +
      "∂L/∂w = -2 x and, with η = 0.1, w_new = 1 + 2.4. The sum ∑ᵢ₌₁⁶⁴ q_i k_i " +
      "is ∂L/∂w for x in (0,1).",
  );
});

test("commands become symbols, fractions and scripts", () => {
  assert.equal(plainMath("a \\cdot b \\approx c \\to d"), "a · b ≈ c → d");
  assert.equal(plainMath("\\hat{y} = w^\\top x"), "y\u0302 = w^T x");
  assert.equal(plainMath("\\frac{w x + b}{2}"), "(w x + b)/2");
  assert.equal(plainMath("\\sqrt{d_{k}} and \\sqrt{64}"), "√dₖ and √64");
  assert.equal(plainMath("e^{-1}, e^{z_i}, W^{(l)}"), "e⁻¹, e^(z_i), W^(l)");
  assert.equal(plainMath("\\|x\\|, \\log p, \\left( a \\right)"), "‖x‖, log p, ( a )");
});

test("a LaTeX token split across deltas comes out whole, wherever it is split", async () => {
  const whole = plainMath(LEAK);
  for (let at = 0; at <= LEAK.length; at++) assert.equal(await streamed([LEAK.slice(0, at), LEAK.slice(at)]), whole, `split at ${at}`);
  assert.equal(await streamed([...LEAK]), whole);
});

test("only what may be a cut-short token is held back", () => {
  assert.equal(readyEnd("A neuron adds its weigh"), 23);
  assert.equal(readyEnd("the input row \\(\\mathbf{x"), 14);
  assert.equal(readyEnd("the input row x_"), 14);
  assert.equal(readyEnd("the input row \\"), 14);
  assert.equal(readyEnd("so \\frac{a b}{c"), 3);
  assert.equal(readyEnd("so \\partial L"), 3);
});
