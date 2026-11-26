"use client";

import { useProgress, useCourseProgress, useHasMounted } from "@/lib/store";
import { logEvent } from "@/lib/events";

export default function LessonComplete({
  course,
  slug,
}: {
  course: string;
  slug: string;
}) {
  const mounted = useHasMounted();
  const cp = useCourseProgress(course);
  const setLesson = useProgress((s) => s.setLesson);
  const checked = mounted && !!cp.completed[slug];

  return (
    <button
      onClick={() => {
        setLesson(course, slug, !checked);
        // The only place this renders is a lesson page read top to bottom, so "reader".
        logEvent(course, { kind: "done", lesson: slug, view: "reader", done: !checked });
      }}
      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 transition ${
        checked
          ? "border-win bg-win/10 text-win"
          : "border-accent text-accent hover:bg-accent-soft"
      }`}
    >
      <span className="text-lg leading-none">{checked ? "✓" : "○"}</span>
      {checked ? "Completed" : "Mark this lesson complete"}
    </button>
  );
}
