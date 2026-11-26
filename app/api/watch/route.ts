import { isCourse } from "@/lib/paths";
import { isLocalRequest, notLocal } from "@/lib/local";
import { readWatch, startWatch } from "@/lib/watchJobs";
import { learnerWork } from "@/lib/watch";
import { features } from "@/lib/features";

// "Watch it": a short narrated video about a highlight (scripts/watch-job.mjs, detached).
// POST { course, term, context?, courseTitle?, lesson?, heading?, learner? } -> 202 { job }: starts making one. learner: what
// they have made of the lesson on their board (notes, clips, cards, questions; lib/watch.ts LearnerWork), so the video builds on it.
// GET ?course=&id= -> { job, scenes }: its status and progress line, and the scenes that can play
// so far, in order (their files come from /api/watch/file). The board polls this while one is made.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  if (!isLocalRequest(req)) return notLocal();
  if (!(await features()).watch) return Response.json({ error: "Watch needs Kokoro (KOKORO_DIR), uv and ffmpeg on this machine" }, { status: 501 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const term = str(b.term, 2000);
  if (typeof b.course !== "string" || !term) return Response.json({ error: "bad request" }, { status: 400 });
  if (!(await isCourse(b.course))) return Response.json({ error: "no such course" }, { status: 404 });
  const job = await startWatch(b.course, {
    term,
    context: str(b.context, 1800),
    course: str(b.courseTitle, 200),
    lesson: str(b.lesson, 200),
    heading: str(b.heading, 200),
    learner: learnerWork(b.learner),
  });
  return Response.json({ job }, { status: 202 });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const course = q.get("course") ?? "";
  if (!(await isCourse(course))) return Response.json({ error: "no such course" }, { status: 404 });
  const found = await readWatch(course, q.get("id") ?? "");
  if (!found) return Response.json({ error: "no such video" }, { status: 404 });
  return Response.json(found);
}
