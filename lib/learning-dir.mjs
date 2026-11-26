import { readFileSync } from "node:fs";
import path from "node:path";

/** The learning folder: beside the app's main checkout. Run from a git worktree (whose `.git` is a file
    pointing into the main checkout's .git/worktrees), the app still finds the main checkout's folder, so
    a worktree reads and writes the learner's real data instead of a folder beside the worktrees.
    Plain JS so the scripts/ can import it too.
    @param {string} cwd the app's folder
    @returns {string} */
export function learningDir(cwd) {
  let app = cwd;
  try {
    const m = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]/m.exec(readFileSync(path.join(cwd, ".git"), "utf8"));
    if (m) app = m[1];
  } catch {
    /* .git is a folder (the main checkout) or absent: the app is where it runs */
  }
  return path.resolve(app, "..", "learning");
}
