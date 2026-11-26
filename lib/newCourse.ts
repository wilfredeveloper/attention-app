import { promises as fs } from "node:fs";
import path from "node:path";
import { LEARNING } from "@/lib/paths";
import { courses } from "@/lib/courses";
import { slugOf } from "@/lib/courseSlug";

// A new course, started from the app: a folder in the learning root, named from the learner's topic,
// with the shared assets linked in (as LEARNING/CLAUDE.md says). The lesson job then writes its
// mission, notes and first lesson. Server only.

// A course folder that was started but never got its mission or a lesson (the first run failed or was
// cancelled) can be started again under the same name.
async function unstarted(dir: string) {
  const has = (p: string) => fs.stat(path.join(dir, p)).then(() => true, () => false);
  const lessons = await fs.readdir(path.join(dir, "lessons")).catch(() => [] as string[]);
  return !(await has("MISSION.md")) && !lessons.some((f) => f.endsWith(".html"));
}

/** Makes (or reuses an unstarted) course folder for the topic and returns its slug, or null if the topic has no usable name. */
export async function makeCourse(topic: string): Promise<string | null> {
  const base = slugOf(topic);
  if (!base) return null;
  const own = new Set(courses.map((c) => c.slug)); // the app's own MDX courses
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (own.has(slug)) continue;
    const dir = path.join(LEARNING, slug);
    try {
      await fs.mkdir(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST" || !(await unstarted(dir))) continue;
    }
    await fs.symlink(path.join("..", "_shared", "assets"), path.join(dir, "assets")).catch(() => {}); // already there
    return slug;
  }
  return null;
}
