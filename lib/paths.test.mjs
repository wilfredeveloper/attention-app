// Run with: pnpm test   (Node strips the TypeScript types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { learningDir } from "./paths.ts";

test("the learning folder is beside the app's main checkout, even from a git worktree", () => {
  const root = mkdtempSync(path.join(tmpdir(), "paths-"));
  const main = path.join(root, "CODE-HQ", "attention-app");
  mkdirSync(path.join(main, ".git", "worktrees", "t3-1"), { recursive: true });
  const tree = path.join(root, ".t3", "worktrees", "attention-app", "t3-1");
  mkdirSync(tree, { recursive: true });
  writeFileSync(path.join(tree, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "t3-1")}\n`);

  assert.equal(learningDir(main), path.join(root, "CODE-HQ", "learning")); // .git is a folder
  assert.equal(learningDir(tree), path.join(root, "CODE-HQ", "learning")); // .git is a file into the main checkout
  assert.equal(learningDir(path.join(root, "elsewhere")), path.join(root, "learning")); // no git at all
});
