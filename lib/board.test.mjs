// Run with: pnpm test   (Node strips the TypeScript types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { BAR_H, CARD_H, GAP_Y, freeY, fromLegacyCard, newerSave, placeLegacy, savedTime, settle, toLegacyCard } from "./board.ts";

const card = (over) => ({
  id: "a", parentId: null, term: "t", context: "", trail: [], x: 970, relX: 10, relY: 500,
  level: 1, parts: ["", "", "", ""], status: ["idle", "idle", "idle", "idle"], ...over,
});

test("a free spot clears every box in the way, with a gap", () => {
  const taken = [{ x: 0, y: 100, w: 300, h: 200 }, { x: 0, y: 310, w: 300, h: 50 }];
  assert.equal(freeY(10, 120, 100, 40, taken), 360 + GAP_Y);
  assert.equal(freeY(400, 120, 100, 40, taken), 120); // another column is free
});

test("saved cards that were never dragged stack in their column, parents first", () => {
  const { cards } = placeLegacy(
    [card({ id: "a", relY: 500 }), card({ id: "b", relY: 510 }), card({ id: "c", parentId: "a", x: 1400, relY: 30 })],
    [],
  );
  const y = Object.fromEntries(cards.map((c) => [c.id, c.y]));
  assert.equal(y.a, 476);
  assert.equal(y.b, 476 + CARD_H + GAP_Y);
  assert.equal(y.c, y.a + 30 - 24);
});

test("a dragged card keeps its place; a page's y moves up to the top of its bar", () => {
  const { cards, pages } = placeLegacy(
    [card({ id: "a", y: 9000 })],
    [{ id: "p", src: "/x.html", title: "X", x: 1000, y: 700 }],
  );
  assert.equal(cards[0].y, 9000);
  assert.equal(pages[0].y, 700 - BAR_H);
});

test("a card goes to props and back to the saved form unchanged", () => {
  const saved = card({
    id: "um79mdsn", page: "jggubvn0", y: 12, level: 4, w: 677, h: 1913, createdAt: 5,
    parts: ["1", "2", "3", "<svg/>"], status: ["done", "done", "done", "done"],
    from: { lesson: "l", card: "z" }, recall: { step: "done", had: true },
  });
  const back = toLegacyCard("shape:um79mdsn", saved.x, 12, fromLegacyCard(saved));
  assert.deepEqual(back, saved);
});

test("an unsized card saves no size, and a card from a card keeps no page", () => {
  const p = fromLegacyCard(card({ parentId: "x", page: "p" }));
  assert.equal(p.sized, false);
  const back = toLegacyCard("shape:a", 0, 0, p);
  assert.equal("w" in back, false);
  assert.equal("page" in back, false);
  assert.equal(back.parentId, "x");
});

test("loading drops text cut off mid-stream so it is asked for again", () => {
  assert.deepEqual(settle({ parts: ["a", "half", "", ""], status: ["done", "streaming", "error", "idle"] }), {
    parts: ["a", "", "", ""],
    status: ["done", "idle", "idle", "idle"],
  });
});

test("a card given only a width keeps it, and still fits its text in height", () => {
  const saved = card({ w: 520 });
  const p = fromLegacyCard(saved);
  assert.equal(p.fixedW, true);
  assert.equal(p.sized, false);
  assert.equal(p.w, 520);
  const back = toLegacyCard("shape:a", 0, 0, p);
  assert.equal(back.w, 520);
  assert.equal("h" in back, false);
});

// ---- which saved copy a board opens from ----
const boardOf = (...createdAt) => ({
  store: Object.fromEntries(createdAt.map((t, i) => [`shape:${i}`, { typeName: "shape", type: "lesson-note", props: { createdAt: t } }]).concat([["page:p", { typeName: "page" }]])),
});

test("a save's time is its stamp, else the newest shape on it", () => {
  assert.equal(savedTime(null), 0);
  assert.equal(savedTime({ savedAt: 5, board: boardOf(9) }), 5);
  assert.equal(savedTime({ board: boardOf(3, 8, 2) }), 8);
  assert.equal(savedTime({ cards: [{ createdAt: 4 }], board: boardOf(1) }), 4); // a board from before tldraw has only cards
  assert.equal(savedTime({ board: boardOf() }), 0);
});

test("a board opens from the newer copy, the file on a tie", () => {
  const file = { board: boardOf(100) }; // written yesterday, before any note
  const local = { board: boardOf(100, 200) }; // the browser's copy, with a note the file never got
  assert.equal(newerSave(file, local), local);
  const stamped = { savedAt: 300, board: boardOf(100) };
  assert.equal(newerSave(stamped, local), stamped); // stamped after the note's time: the file
  assert.equal(newerSave(file, { board: boardOf(100) }), file); // a tie
  assert.equal(newerSave(null, local), local);
  assert.equal(newerSave(file, null), file);
  assert.equal(newerSave(null, null), null);
});
