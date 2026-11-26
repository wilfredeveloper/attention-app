import { isLocalRequest, notLocal } from "@/lib/local";
import { startJob } from "@/lib/lessonJobs";
import { makeCourse } from "@/lib/newCourse";

// POST { topic, note? } -> 202 { job }: makes a course folder named from the topic and starts the
// /teach run that writes its mission and first lesson (scripts/lesson-job.mjs, detached).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TOPIC = 300;
const MAX_NOTE = 4000;

export async function POST(req: Request) {
  if (!isLocalRequest(req)) return notLocal();
  const { topic, note } = (await req.json().catch(() => ({}))) as { topic?: unknown; note?: unknown };
  if (typeof topic !== "string" || !topic.trim() || (note !== undefined && typeof note !== "string"))
    return Response.json({ error: "Say what you want to learn." }, { status: 400 });
  if (topic.length > MAX_TOPIC) return Response.json({ error: `Keep the topic under ${MAX_TOPIC} characters; put the rest in the note.` }, { status: 400 });
  if (note && note.length > MAX_NOTE) return Response.json({ error: `note is longer than ${MAX_NOTE} characters` }, { status: 400 });
  const course = await makeCourse(topic);
  if (!course) return Response.json({ error: "Use some letters or numbers in the topic." }, { status: 400 });
  const { job, started } = await startJob(course, note?.trim() || undefined, topic.trim());
  return Response.json({ job }, { status: started ? 202 : 409 });
}
