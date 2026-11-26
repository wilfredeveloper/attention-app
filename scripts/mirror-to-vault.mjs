#!/usr/bin/env node
/**
 * Mirror app lessons (MDX) into the Obsidian vault as plain-markdown review
 * companions, so graph view stays alive alongside the app. Multi-course aware.
 *
 * Usage:  node scripts/mirror-to-vault.mjs
 * Reads:  content/courses/<course>/lessons/*.mdx
 * Writes: ../learning/<course>/lessons/<file>.md
 *
 * The app is the interactive source of truth; these companions are read-only
 * mirrors (re-run this script rather than editing them).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, "..");
const COURSES = path.join(APP, "content", "courses");
const VAULT_ROOT = path.resolve(APP, "..", "learning");

const titleize = (slug) =>
  slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

function toWikilinks(md) {
  // [text](/courses/x/concepts/slug) or [text](/concepts/slug) -> [[Title]]
  return md.replace(
    /\[([^\]]+)\]\((?:\/courses\/[a-z-]+)?\/concepts\/([a-z-]+)\)/g,
    (_m, _t, slug) => `[[${titleize(slug)}]]`
  );
}

function stripJsx(md) {
  return md
    .replace(/<BreathTimer\s*\/>/g, "> 🧘 **Practice (in the app):** a 60-second breath-anchor timer. Each caught wander is one rep.")
    .replace(/<Quiz[\s\S]*?\/>/g, "> ✅ **Self-test (in the app):** recall questions with instant feedback.")
    .replace(/<Compare[\s\S]*?\/>/g, "> ⚖️ **Comparison (in the app):** a side-by-side of the two.")
    .replace(/<Callout>\s*([\s\S]*?)\s*<\/Callout>/g, (_m, inner) =>
      inner.trim().split("\n").map((l) => `> ${l.trim()}`).join("\n")
    );
}

function conceptFooter(concepts) {
  const links = (concepts || []).map((s) => `[[${titleize(s)}]]`).join(" · ");
  return `\n\n---\nConcepts: ${links}\n`;
}

function mirror(course, file) {
  const dir = path.join(COURSES, course, "lessons");
  const { data, content } = matter(fs.readFileSync(path.join(dir, file), "utf8"));
  if (data.status !== "available") return null;

  const base = file.replace(/\.mdx$/, "");
  const m = base.match(/^(\d+)-(.+)$/);
  const number = m ? parseInt(m[1], 10) : 0;

  const body = toWikilinks(stripJsx(content)).trim();
  const note = `---
type: lesson
course: ${course}
number: ${number}
status: available
aliases: ["${String(number).padStart(4, "0")} ${data.title}"]
source: app
---

# Lesson ${number} · ${data.title}

*${data.subtitle || ""}*

▶ **Do this lesson interactively in the app** — this note is the review companion (generated; edits are not synced back).

${body}${conceptFooter(data.concepts)}`;

  const outDir = path.join(VAULT_ROOT, course, "lessons");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${base}.md`);
  fs.writeFileSync(out, note, "utf8");
  return path.relative(process.cwd(), out);
}

const written = [];
for (const course of fs.readdirSync(COURSES)) {
  const lessonsDir = path.join(COURSES, course, "lessons");
  if (!fs.existsSync(lessonsDir)) continue;
  for (const f of fs.readdirSync(lessonsDir).filter((f) => f.endsWith(".mdx"))) {
    const r = mirror(course, f);
    if (r) written.push(r);
  }
}
console.log(
  written.length
    ? `Mirrored ${written.length} lesson(s):\n  ${written.join("\n  ")}`
    : "No available lessons to mirror."
);
