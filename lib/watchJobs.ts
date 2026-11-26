import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { LEARNING } from "@/lib/paths";
import { getSettings } from "@/lib/models";
import type { Scene, WatchInput, WatchJob } from "@/lib/watch";

// "Watch it" jobs: a narrated video about a highlight, made by scripts/watch-job.mjs.
//   <LEARNING>/<course>/app-data/videos/<id>/job.json     the job (this file and the runner write it)
//   .../scenes.json                                       the scenes that can play so far, in order
//   .../scene-N.svg, scene-N.wav, video.mp4, captions.vtt the media (GET /api/watch/file serves it)
//   .../job.log                                           the runner's output
// The runner is a detached Node process, as a lesson job's is (lib/lessonJobs.ts), so a video being
// made outlives app reloads. Several can run at once. Server only.

const ID = /^[a-z0-9-]+$/;
const RUNNER = path.join(process.cwd(), "scripts", "watch-job.mjs");
const QUEUED_GRACE_MS = 60_000; // a queued job with no runner pid after this long never started

export const validId = (id: unknown): id is string => typeof id === "string" && ID.test(id);
export const videoDir = (course: string, id: string) => path.join(LEARNING, course, "app-data", "videos", id);
const jobFile = (course: string, id: string) => path.join(videoDir(course, id), "job.json");

const readJson = async <T>(file: string): Promise<T | null> => fs.readFile(file, "utf8").then((s) => JSON.parse(s) as T, () => null);
async function writeJob(job: WatchJob) {
  const file = jobFile(job.course, job.id);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(job, null, 1) + "\n");
  await fs.rename(tmp, file);
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
const active = (j: WatchJob) => j.status === "queued" || j.status === "running";

// An active job whose runner is gone (machine restarted, runner crashed) is marked failed.
async function reap(job: WatchJob): Promise<WatchJob> {
  if (!active(job)) return job;
  const dead = job.pid ? !pidAlive(job.pid) : Date.now() - Date.parse(job.createdAt) > QUEUED_GRACE_MS;
  if (!dead) return job;
  const now = (await readJson<WatchJob>(jobFile(job.course, job.id))) ?? job; // the runner may have just written its final status
  if (!active(now)) return now;
  const failed: WatchJob = { ...now, status: "failed", error: "runner stopped", finishedAt: new Date().toISOString() };
  await writeJob(failed);
  return failed;
}

/** Starts the job that makes a video; scenes appear in readWatch as they become playable. */
export async function startWatch(course: string, input: WatchInput): Promise<WatchJob> {
  const now = new Date();
  const id = `${now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${randomBytes(3).toString("hex")}`.toLowerCase();
  const { models, watchEffort } = await getSettings();
  const job: WatchJob = { id, course, status: "queued", createdAt: now.toISOString(), model: models.watch, effort: watchEffort, input };
  await fs.mkdir(videoDir(course, id), { recursive: true });
  await writeJob(job);
  const log = openSync(path.join(videoDir(course, id), "job.log"), "a");
  try {
    // detached: own process group (so cancel can kill claude, Kokoro and ffmpeg too) and no tie to this server
    const child = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", RUNNER, jobFile(course, id)], {
      detached: true,
      stdio: ["ignore", log, log],
      env: process.env,
    });
    child.on("error", () => {}); // reap() marks it failed if it never started
    child.unref();
  } finally {
    closeSync(log);
  }
  return job;
}

/** A video's job and the scenes that can play so far, or null if there is no such video. */
export async function readWatch(course: string, id: string): Promise<{ job: WatchJob; scenes: Scene[] } | null> {
  if (!validId(id)) return null;
  const job = await readJson<WatchJob>(jobFile(course, id));
  if (!job) return null;
  return { job: await reap(job), scenes: (await readJson<Scene[]>(path.join(videoDir(course, id), "scenes.json"))) ?? [] };
}

/** Stops a video being made: kills the job's process group and marks it cancelled. The scenes already made stay playable. */
export async function cancelWatch(course: string, id: string): Promise<WatchJob | null> {
  if (!validId(id)) return null;
  const job = await readJson<WatchJob>(jobFile(course, id));
  if (!job) return null;
  if (!active(job)) return job;
  if (job.pid) {
    try {
      process.kill(-job.pid, "SIGTERM"); // the whole group: runner, claude, Kokoro, ffmpeg
    } catch {
      /* already gone */
    }
  }
  const now = (await readJson<WatchJob>(jobFile(course, id))) ?? job;
  if (!active(now)) return now;
  const { progress: _drop, ...rest } = now; // eslint-disable-line @typescript-eslint/no-unused-vars
  const cancelled: WatchJob = { ...rest, status: "cancelled", finishedAt: new Date().toISOString() };
  await writeJob(cancelled);
  return cancelled;
}
