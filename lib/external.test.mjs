// Run with: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, isFresh } from "./external.mjs";

const now = Date.parse("2026-11-18T12:00:00Z");
const at = (daysAgo, kind = "html") => ({ kind, fetchedAt: new Date(now - daysAgo * DAY).toISOString() });

test("a readable copy stands 30 days by default (prefetched lesson links)", () => {
  assert.equal(isFresh(at(29), now), true);
  assert.equal(isFresh(at(31), now), false);
});

test("a copy opened on the canvas stands a day, then is fetched again", () => {
  assert.equal(isFresh(at(0.5), now, DAY), true);
  assert.equal(isFresh(at(1.5), now, DAY), false);
});

test("a failure is retried after two days, or sooner if copies expire sooner", () => {
  assert.equal(isFresh(at(1, "fail"), now), true);
  assert.equal(isFresh(at(3, "fail"), now), false);
  assert.equal(isFresh(at(0.5, "fail"), now, 0.25 * DAY), false);
});
