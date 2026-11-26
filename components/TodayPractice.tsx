"use client";

import { useProgress, useCourseProgress, lastNDays, todayIso, useHasMounted } from "@/lib/store";

export default function TodayPractice({
  course,
  prompt,
}: {
  course: string;
  prompt: string;
}) {
  const mounted = useHasMounted();
  const cp = useCourseProgress(course);
  const logRepToday = useProgress((s) => s.logRepToday);
  const unlogRepToday = useProgress((s) => s.unlogRepToday);

  const hasToday = mounted && cp.repDays.includes(todayIso());
  const week = lastNDays(mounted ? cp.repDays : [], 7);

  return (
    <div className="rounded-xl border border-rule bg-card p-6">
      <p className="mt-0">{prompt}</p>

      {!hasToday ? (
        <button
          onClick={() => logRepToday(course)}
          className="rounded-lg border border-accent bg-accent px-5 py-2.5 text-white transition hover:opacity-90"
        >
          ✓ I did a rep today
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-win">
            Logged for today. A return counts, however small. 🌿
          </span>
          <button
            onClick={() => unlogRepToday(course)}
            className="text-sm text-muted underline"
          >
            undo
          </button>
        </div>
      )}

      <div className="mt-5 flex gap-2 text-lg" title="last 7 days" aria-label="last 7 days">
        {week.map((d) => (
          <span key={d.iso} className={d.done ? "text-win" : "text-rule"}>
            {d.done ? "●" : "○"}
          </span>
        ))}
      </div>
    </div>
  );
}
