import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { Source } from "@/lib/content";

const COURSES_DIR = path.join(process.cwd(), "content", "courses");

function lessonsDir(course: string) {
  return path.join(COURSES_DIR, course, "lessons");
}

export type LessonMeta = {
  course: string;
  slug: string;
  number: number;
  title: string;
  subtitle: string;
  minutes: number;
  concepts: string[];
  primarySource: Source;
  carry: string;
  status: "available" | "planned";
  file: string; // e.g. "0001-the-return.mdx"
};

function parseFile(course: string, file: string): LessonMeta {
  const raw = fs.readFileSync(path.join(lessonsDir(course), file), "utf8");
  const { data } = matter(raw);
  const base = file.replace(/\.mdx$/, "");
  const m = base.match(/^(\d+)-(.+)$/);
  return {
    course,
    slug: m ? m[2] : base,
    number: m ? parseInt(m[1], 10) : 0,
    title: data.title ?? base,
    subtitle: data.subtitle ?? "",
    minutes: data.minutes ?? 0,
    concepts: Array.isArray(data.concepts) ? data.concepts : [],
    primarySource: data.primarySource ?? { label: "", url: "#" },
    carry: data.carry ?? "",
    status: data.status === "available" ? "available" : "planned",
    file,
  };
}

/** All lessons in a course, ordered by number. */
export function getLessons(course: string): LessonMeta[] {
  const dir = lessonsDir(course);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => parseFile(course, f))
    .sort((a, b) => a.number - b.number);
}

export function getLesson(
  course: string,
  slug: string
): LessonMeta | undefined {
  return getLessons(course).find((l) => l.slug === slug);
}

export function getAvailableLessons(course: string): LessonMeta[] {
  return getLessons(course).filter((l) => l.status === "available");
}
