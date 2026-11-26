"use client";

import { useEffect, useRef, useState } from "react";
import { useProgress } from "@/lib/store";
import { useCourseSlug } from "@/components/CourseContext";

const TOTAL = 60;

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss < 10 ? "0" : ""}${ss}`;
}

export default function BreathTimer() {
  const [remaining, setRemaining] = useState(TOTAL);
  const [taps, setTaps] = useState(0);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRepToday = useProgress((s) => s.logRepToday);
  const course = useCourseSlug();

  useEffect(() => {
    return () => {
      if (tick.current) clearInterval(tick.current);
    };
  }, []);

  function start() {
    setPhase("running");
    setRemaining(TOTAL);
    setTaps(0);
    tick.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (tick.current) clearInterval(tick.current);
          setPhase("done");
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }

  function reset() {
    if (tick.current) clearInterval(tick.current);
    setPhase("idle");
    setRemaining(TOTAL);
    setTaps(0);
  }

  // When a completed session had at least one caught wander, count today's rep.
  useEffect(() => {
    if (phase === "done" && taps > 0 && course) logRepToday(course);
  }, [phase, taps, course, logRepToday]);

  const doneMsg =
    taps === 0
      ? "Zero taps can mean deep focus — or that the drift slipped by unnoticed. Try once more and watch closely."
      : taps <= 4
      ? `You did ${taps} Returns. Steady attention with clean catches — exactly the rep.`
      : `You did ${taps} Returns. A busy mind, beautifully caught each time — ${taps} push-ups for attention.`;

  return (
    <div className="rounded-xl border border-rule bg-card p-6 text-center shadow-sm">
      <div className="tabular text-5xl font-semibold tracking-tight">
        {fmt(remaining)}
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {phase !== "running" && (
          <button
            onClick={start}
            className="rounded-lg border border-accent bg-accent px-5 py-2.5 text-white transition hover:opacity-90"
          >
            {phase === "done" ? "Again" : "Begin"}
          </button>
        )}
        {phase !== "idle" && (
          <button
            onClick={reset}
            className="rounded-lg border border-accent px-5 py-2.5 text-accent transition hover:bg-accent-soft"
          >
            Reset
          </button>
        )}
      </div>

      {phase === "running" && (
        <div className="mt-5">
          <button
            onClick={() => setTaps((t) => t + 1)}
            className="rounded-lg border border-accent bg-accent px-6 py-3.5 text-lg text-white transition hover:opacity-90"
          >
            I noticed — returning ↩
          </button>
          <div className="mt-4 text-lg font-semibold text-win">
            Reps: {taps}
            {taps === 1
              ? "  — that's the skill, right there."
              : taps > 1
              ? "  — good. Back to the breath."
              : ""}
          </div>
        </div>
      )}

      {phase === "done" && (
        <p className="mx-auto mt-5 max-w-md font-semibold text-win">{doneMsg}</p>
      )}

      {phase === "idle" && (
        <p className="mx-auto mt-4 max-w-md text-sm text-muted">
          Rest attention on the breath. When you notice it has wandered, tap the
          button and return. You are counting reps, not failures.
        </p>
      )}
    </div>
  );
}
