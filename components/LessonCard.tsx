"use client";

import Link from "next/link";
import type { LessonMeta } from "@/lib/lessons";
import { useCourseProgress, useHasMounted } from "@/lib/store";

export default function LessonCard({ lesson }: { lesson: LessonMeta }) {
  const mounted = useHasMounted();
  const cp = useCourseProgress(lesson.course);
  const isDone = mounted && !!cp.completed[lesson.slug];
  const planned = lesson.status === "planned";

  const inner = (
    <div
      className={`flex items-center gap-4 rounded-xl border bg-card p-4 transition ${
        isDone ? "border-win" : "border-rule"
      } ${planned ? "opacity-55" : "hover:border-accent"}`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm tabular ${
          isDone ? "border-win text-win" : "border-rule text-muted"
        }`}
      >
        {isDone ? "✓" : lesson.number}
      </span>
      <div className="flex-1">
        <div className="font-semibold">
          Lesson {lesson.number} · {lesson.title}
        </div>
        <div className="text-sm text-muted">{lesson.subtitle}</div>
      </div>
      {planned ? (
        <span className="rounded-full border border-rule px-2.5 py-0.5 text-xs text-muted">
          soon
        </span>
      ) : (
        <span className="text-xs text-muted">{lesson.minutes} min</span>
      )}
    </div>
  );

  if (planned) return inner;
  return (
    <Link
      href={`/courses/${lesson.course}/lessons/${lesson.slug}`}
      className="block no-underline"
    >
      {inner}
    </Link>
  );
}
