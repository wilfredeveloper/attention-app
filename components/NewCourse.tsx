"use client";

// Library panel: start a new course. The learner says what they want to learn; app/api/courses/new
// makes the course folder and starts the /teach run that writes its mission and first lesson
// (scripts/lesson-job.mjs). Shows new-course runs in progress, and a failed one with a retry.
// LessonNotifier announces the finished lesson on any page.

import { useCallback, useEffect, useState } from "react";
import type { LessonJob } from "@/lib/lessonJobs";
import { JOB_STARTED } from "@/components/LessonNotifier";
import "@/app/lessons.css";

const POLL_MS = 10_000;
const active = (j: LessonJob) => j.status === "queued" || j.status === "running";
const minutes = (j: LessonJob) => Math.max(0, Math.floor((Date.now() - Date.parse(j.startedAt ?? j.createdAt)) / 60_000));

export default function NewCourse({ empty }: { empty: boolean }) {
  const [jobs, setJobs] = useState<LessonJob[]>([]);
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const r = await fetch("/api/lessons/jobs").catch(() => null);
    if (!r?.ok) return;
    const all = ((await r.json()) as { jobs: LessonJob[] }).jobs;
    // per course, its newest job, when that job is a new-course run still going or failed
    const newest = new Map<string, LessonJob>();
    for (const j of all) if (!newest.has(j.course)) newest.set(j.course, j);
    setJobs([...newest.values()].filter((j) => j.topic && (active(j) || j.status === "failed")));
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    return () => clearTimeout(first);
  }, [refresh]);
  const running = jobs.some(active);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [running, refresh]);

  async function start(t: string, n?: string) {
    if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    setBusy(true);
    setError("");
    const r = await fetch("/api/courses/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: t, note: n?.trim() || undefined }),
    }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Couldn't reach the app server.");
    const body = (await r.json().catch(() => ({}))) as { job?: LessonJob; error?: string };
    if (!body.job) return setError(body.error ?? `Request failed (${r.status}).`);
    setOpen(false);
    setTopic("");
    setNote("");
    window.dispatchEvent(new Event(JOB_STARTED));
    refresh();
  }

  async function cancel(j: LessonJob) {
    await fetch("/api/lessons/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course: j.course, id: j.id }),
    }).catch(() => null);
    refresh();
  }

  return (
    <section className="nl" aria-label="Start a course">
      {jobs.map((j) => (
        <div className="nl-status" key={j.id} aria-live="polite">
          {active(j) ? (
            <>
              <p className="nl-line">
                <span className="nl-dot" aria-hidden />
                {j.status === "queued" ? "Starting" : `Writing the first lesson of “${j.topic}”… ${minutes(j)} min`}
              </p>
              {j.progress && <p className="nl-progress">{j.progress}</p>}
              <button type="button" className="nl-btn nl-quiet" onClick={() => cancel(j)}>
                Cancel
              </button>
            </>
          ) : (
            <p className="nl-line nl-bad">
              “{j.topic}” couldn’t be started: {j.error}{" "}
              <button type="button" className="nl-btn nl-quiet" onClick={() => start(j.topic!, j.note)} disabled={busy}>
                Try again
              </button>
            </p>
          )}
        </div>
      ))}
      {open ? (
        <div className="nl-form">
          <label htmlFor="nc-topic">What do you want to learn?</label>
          <input
            id="nc-topic"
            className="nc-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={300}
            placeholder="How vaccines train the immune system"
            autoFocus
          />
          <label htmlFor="nc-note" style={{ marginTop: 10 }}>
            Anything else for your teacher? (why you want it, what you already know, a source to follow)
          </label>
          <textarea id="nc-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
          <div className="nl-row">
            <button type="button" className="nl-btn" onClick={() => start(topic, note)} disabled={busy || !topic.trim()}>
              {busy ? "Starting…" : "Start the course"}
            </button>
            <button type="button" className="nl-btn nl-quiet" onClick={() => setOpen(false)}>
              Not now
            </button>
            <small>Writes the first lesson in the background with Opus, up to $5. You’ll be told when it’s ready.</small>
          </div>
          {error && <p className="nl-bad">{error}</p>}
        </div>
      ) : (
        <>
          {empty && jobs.length === 0 && <p className="nl-line" style={{ marginBottom: 10 }}>No courses yet. Start one on anything you want to learn.</p>}
          <button type="button" className="nl-btn" onClick={() => setOpen(true)}>
            Start a course
          </button>
        </>
      )}
    </section>
  );
}
