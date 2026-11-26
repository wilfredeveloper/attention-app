"use client";

import { useCourseProgress, computeStreak, useHasMounted } from "@/lib/store";

function Stat({ num, label }: { num: number | string; label: string }) {
  return (
    <div className="flex-1 rounded-xl border border-rule bg-card p-4 text-center">
      <div className="tabular text-3xl font-semibold leading-none text-accent">
        {num}
      </div>
      <div className="mt-2 text-xs uppercase tracking-widest text-muted">
        {label}
      </div>
    </div>
  );
}

export default function ProgressStats({
  course,
  totalLessons,
  hasPractice,
}: {
  course: string;
  totalLessons: number;
  hasPractice: boolean;
}) {
  const mounted = useHasMounted();
  const cp = useCourseProgress(course);

  const done = mounted ? Object.values(cp.completed).filter(Boolean).length : 0;

  return (
    <div className="my-8 flex flex-wrap gap-3">
      <Stat num={`${done}/${totalLessons}`} label="Lessons done" />
      {hasPractice && (
        <>
          <Stat num={mounted ? computeStreak(cp.repDays) : 0} label="Day streak" />
          <Stat num={mounted ? cp.repDays.length : 0} label="Days practiced" />
        </>
      )}
    </div>
  );
}
