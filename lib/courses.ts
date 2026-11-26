import type { Course } from "@/lib/content";
import { attention } from "@/content/courses/attention/course";

// The course registry. Add a course = create content/courses/<slug>/course.ts
// and append it here. (Pure data — safe to import from client components.)
export const courses: Course[] = [attention];

export function getCourse(slug: string): Course | undefined {
  return courses.find((c) => c.slug === slug);
}
