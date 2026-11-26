// First-run setup:  pnpm bootstrap
//
// 1. Makes the learning folder (beside the app, or $LEARNING_DIR) from starter/learning, unless it
//    already has a CLAUDE.md. Never overwrites anything.
// 2. Publishes the learning folder's courses into the app (scripts/sync-courses.mjs), which also
//    writes content/embedded-courses.json, the course list the app is built with.
// 3. Links the teach skill into ~/.claude/skills/teach, so /teach works from any terminal,
//    unless something is already there.
// 4. Checks that the claude CLI is on PATH.

import { execFileSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { learningDir } from "../lib/learning-dir.mjs";

const APP = path.resolve(import.meta.dirname, "..");
const LEARNING = process.env.LEARNING_DIR || learningDir(APP);
const SKILL = path.join(APP, "skills", "teach");
const LINK = path.join(os.homedir(), ".claude", "skills", "teach");

// 1. the learning folder
if (existsSync(path.join(LEARNING, "CLAUDE.md"))) {
  console.log(`Learning folder: ${LEARNING} (already set up, left as is)`);
} else {
  await fs.cp(path.join(APP, "starter", "learning"), LEARNING, { recursive: true, force: false, errorOnExist: false });
  const rules = path.join(LEARNING, "CLAUDE.md");
  const text = await fs.readFile(rules, "utf8");
  await fs.writeFile(rules, text.replaceAll("{{APP}}", APP).replaceAll("{{LEARNING}}", LEARNING));
  try {
    execFileSync("python3", [path.join(LEARNING, "_shared", "build_library.py")], { stdio: "ignore" });
  } catch {
    console.log("  (python3 not found: the library page index.html will be built after the first lesson)");
  }
  console.log(`Learning folder: made ${LEARNING}`);
}

// 2. publish its courses into the app
execFileSync(process.execPath, [path.join(APP, "scripts", "sync-courses.mjs")], { stdio: "ignore", env: { ...process.env, VAULT: LEARNING } });
console.log("Courses: published into the app");

// 3. the teach skill
const current = await fs.realpath(LINK).catch(() => null);
if (current === (await fs.realpath(SKILL))) {
  console.log(`Teach skill: ${LINK} already points here`);
} else if (current || (await fs.lstat(LINK).catch(() => null))) {
  console.log(`Teach skill: ${LINK} already exists and isn't this app's skill; left as is.`);
  console.log(`  To use this one: rm ${LINK} && ln -s ${SKILL} ${LINK}`);
} else {
  await fs.mkdir(path.dirname(LINK), { recursive: true });
  await fs.symlink(SKILL, LINK);
  console.log(`Teach skill: linked ${LINK} -> ${SKILL}`);
}

// 4. the claude CLI
try {
  execFileSync("claude", ["--version"], { stdio: "ignore" });
  console.log("Claude CLI: found");
} catch {
  console.log("Claude CLI: not found. Install Claude Code and sign in; the tutor and lessons run through it.");
}

console.log(`
For /teach in a terminal, add this to your shell profile (~/.bashrc or ~/.zshrc):
  export LEARNING_DIR="${LEARNING}"
Then start the app with: pnpm dev`);
