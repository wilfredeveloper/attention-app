import { promises as fs } from "node:fs";
import path from "node:path";

export { learningDir } from "./learning-dir.mjs";
import { learningDir } from "./learning-dir.mjs";

// LEARNING_DIR lets tests point the app at a scratch copy so they never touch real learner data.
export const LEARNING = process.env.LEARNING_DIR ?? learningDir(process.cwd());

const COURSE = /^[a-z0-9-]+$/;

// A course is a plain folder in the learning root; "_shared" and the like are not courses.
export async function isCourse(course: string) {
  if (!COURSE.test(course) || course.startsWith("_")) return false;
  return fs.stat(path.join(LEARNING, course)).then((s) => s.isDirectory(), () => false);
}
