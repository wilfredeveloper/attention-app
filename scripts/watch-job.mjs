// Runs one "watch it" job: a short narrated video about a highlight.
//
//   node scripts/watch-job.mjs <LEARNING>/<course>/app-data/videos/<id>/job.json
//
// Started detached by POST /api/watch (lib/watchJobs.ts) with stdout/stderr going to job.log in
// that folder, so it outlives app reloads. Everything is local:
//   1. claude -p (no tools) streams the scenes: a narration and one SVG frame each (lib/watch.ts).
//   2. As soon as a narration is complete, Kokoro voices it (scene-N.wav) while its frame is still
//      being drawn (scene-N.svg). A scene with both joins scenes.json, in order, and the board can
//      play it: the first one within seconds, the rest ahead of the playback.
//   3. When all are in, ffmpeg stitches video.mp4 and captions.vtt is written from the narration.
// job.json carries the status and a progress line; one "watch" line goes to calls.jsonl.
// SIGTERM to the process group (cancel) kills this runner, claude, Kokoro and ffmpeg; the API marks
// it cancelled. KOKORO_DIR overrides where Kokoro lives.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FPS, FRAME_H, FRAME_W, MAX_SCENES, WATCH_SYSTEM, cleanSvg, held, parseScenes, vtt, watchPrompt, wavSeconds } from "../lib/watch.ts";

const KOKORO = process.env.KOKORO_DIR || path.resolve(import.meta.dirname, "..", "kokoro");
const VOICE = "af_heart";
const FFMPEG = "ffmpeg"; // from PATH

const jobPath = path.resolve(process.argv[2] ?? "");
if (path.basename(jobPath) !== "job.json") {
  console.error("usage: node scripts/watch-job.mjs <LEARNING>/<course>/app-data/videos/<id>/job.json");
  process.exit(1);
}
const DIR = path.dirname(jobPath);
const COURSE_DIR = path.resolve(DIR, "..", "..", "..");
const LEARNING = path.dirname(COURSE_DIR);

const say = (msg) => process.stdout.write(`# [${new Date().toISOString()}] ${msg}\n`);
async function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 1) + "\n");
  await fs.rename(tmp, file);
}

const job = JSON.parse(await fs.readFile(jobPath, "utf8"));
if (job.status !== "queued") {
  say(`job is ${job.status}, not queued; nothing to do`);
  process.exit(0);
}
// How hard the model thinks before it draws (the Models tab's setting, saved on the job). "high": it designs the whole video
// first, about 2 to 3 minutes of thinking, and then writes scenes more slowly than the voice speaks them, so the scenes are held
// back until the script is whole and then play straight through ("medium" likewise, about a minute). "low": no thinking (the
// prompt's START AT ONCE), first scene in about 10 s, uneven pictures.
const EFFORT = ["low", "medium", "high"].includes(job.effort) ? job.effort : "high";
const STREAM = EFFORT === "low"; // scenes play as they are made
const startedAt = Date.now();
let writing = Promise.resolve();
/** Change the job and save it (saves run one after another). */
const update = (patch) => {
  Object.assign(job, patch);
  const snap = { ...job };
  return (writing = writing.then(() => writeJson(jobPath, snap)));
};
await update({ status: "running", pid: process.pid, startedAt: new Date(startedAt).toISOString(), progress: "writing script" });

/** Run a command to its end; resolves with its exit code and the tail of what it printed. */
const run = (bin, args, opts = {}) =>
  new Promise((resolve) => {
    const c = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "";
    const keep = (d) => (out = (out + d.toString()).slice(-1500));
    c.stdout.on("data", keep);
    c.stderr.on("data", keep);
    c.on("error", (e) => resolve({ code: -1, out: `could not start ${bin}: ${e.message}` }));
    c.on("close", (code) => resolve({ code: code ?? -1, out }));
  });

// ---- scenes, as they come ----

const slots = []; // per scene the model wrote: { narration, dur?: number (voiced), visual?: string | null (null: no usable frame) }
const ready = []; // scenes.json: the scenes that can play, in order
let total = 0; // scenes written, once the script is whole
let voiced = 0;
let failure = "";
let voiceQueue = Promise.resolve();

/** Scenes join scenes.json in order, each once its frame and its voice both exist; one with no usable frame is left out. */
let next = 0; // the first scene not yet looked at for scenes.json
let scripted = false; // the model has finished writing
async function publish() {
  if (!STREAM && !scripted) return;
  const had = ready.length;
  for (; next < slots.length; next++) {
    const s = slots[next];
    if (s.visual === null) continue;
    if (!s.visual || !s.dur) break;
    ready.push({ narration: s.narration, visual: s.visual, audio: `scene-${next + 1}.wav`, dur: s.dur });
    if (ready.length === 1) say(`first scene ready after ${Date.now() - startedAt} ms`);
  }
  if (ready.length > had) await writeJson(path.join(DIR, "scenes.json"), ready);
}

function voice(i) {
  const s = slots[i];
  voiceQueue = voiceQueue.then(async () => {
    if (failure) return;
    const file = path.join(DIR, `scene-${i + 1}.wav`);
    // "--": a narration that starts with a dash is still the text
    const r = await run("uv", ["run", "say.py", "-v", VOICE, "-s", "1.0", "-o", file, "--", s.narration], { cwd: KOKORO });
    const dur = r.code === 0 ? wavSeconds(await fs.readFile(file).catch(() => Buffer.alloc(0))) : 0;
    if (!dur) {
      failure = `Kokoro could not voice scene ${i + 1}: ${r.out.trim().split("\n").at(-1) ?? ""}`;
      return;
    }
    s.dur = dur;
    voiced++;
    await update({ progress: `voicing ${voiced}/${total || Math.max(slots.length, voiced)}` });
    await publish();
  });
}

let handling = Promise.resolve();
/** Take what is new in the model's text so far: voice each new narration, save each new frame. */
function take(text) {
  const { narrations, scenes } = parseScenes(text);
  for (let i = slots.length; i < Math.min(narrations.length, MAX_SCENES); i++) {
    slots.push({ narration: narrations[i] });
    if (narrations[i]) voice(i);
    else slots[i].visual = null;
  }
  for (let i = 0; i < Math.min(scenes.length, MAX_SCENES); i++) {
    const s = slots[i];
    if (s.visual !== undefined) continue;
    const svg = cleanSvg(scenes[i].svg);
    s.visual = svg ? `scene-${i + 1}.svg` : null;
    handling = handling.then(async () => {
      if (svg) await fs.writeFile(path.join(DIR, s.visual), svg);
      await publish();
    });
  }
}

// ---- 1. the script ----

let result = null;
let firstAt = null;
let stderr = "";
let text = "";
const FIRST_WORD_MS = 12_000; // claude usually answers within 2 s
let answering = false;
/** One run of claude; resolves "stalled" if the model sent nothing at all in time, not even thinking (it is killed and asked again). */
const script = () => new Promise((resolve) => {
  answering = false;
  const child = spawn(
    "claude",
    [
      "-p", watchPrompt(job.input),
      "--model", job.model,
      "--effort", EFFORT,
      "--system-prompt", STREAM ? WATCH_SYSTEM : WATCH_SYSTEM.split("\n\n").filter((p) => !p.startsWith("START AT ONCE")).join("\n\n"),
      "--tools", "",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
    ],
    // It needs no files, so it runs in the temp folder, away from the app's own project settings and history.
    { stdio: ["ignore", "pipe", "pipe"], env: process.env, cwd: os.tmpdir() },
  );
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        const ev = JSON.parse(line);
        if (ev.type === "stream_event") answering = true; // text or thinking: either way it is at work
        if (ev.event?.delta?.type === "thinking_delta" && job.progress !== "designing the video") void update({ progress: "designing the video" });
        if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.type === "text_delta") {
          if (!firstAt) {
            firstAt = Date.now();
            if (!STREAM) void update({ progress: "drawing the scenes" });
          }
          text += ev.event.delta.text;
          take(text);
        }
        if (ev.type === "result") result = ev;
      } catch {
        /* not JSON */
      }
    }
  });
  child.stderr.on("data", (d) => (stderr = (stderr + d.toString()).slice(-2000)));
  child.on("error", (err) => {
    stderr = `could not start claude: ${err.message}`;
    resolve(-1);
  });
  const watchdog = setTimeout(() => {
    if (answering) return;
    child.kill("SIGTERM");
    resolve("stalled");
  }, FIRST_WORD_MS);
  child.on("close", (c) => {
    clearTimeout(watchdog);
    resolve(c ?? -1);
  });
});
let code = await script();
if (code === "stalled") {
  say(`claude sent nothing in ${FIRST_WORD_MS} ms: asking again`);
  code = await script();
  if (code === "stalled") {
    code = -1;
    stderr = "Claude didn't answer. Try again in a moment.";
  }
}
say(`claude exited with code ${code} after ${Date.now() - startedAt} ms, ${slots.length} scenes`);
await fs.writeFile(path.join(DIR, "script.txt"), text).catch(() => {});

// a scene the model never closed has no frame
for (const s of slots) if (s.visual === undefined) s.visual = null;
scripted = true;
total = slots.filter((s) => s.visual).length;

// ---- 2. the rest of the voices ----

await voiceQueue;
await handling;
await publish();

let error;
if (code !== 0 || result?.is_error) error = `claude exited with an error (code ${code}): ${String(result?.result ?? stderr ?? "").trim().slice(0, 300) || "no output"}`;
else if (failure) error = failure;
else if (!ready.length) error = "No scene could be used from what the model wrote";

// ---- 3. video.mp4 and captions.vtt ----

if (!error) {
  await update({ progress: "rendering" });
  await fs.writeFile(path.join(DIR, "captions.vtt"), vtt(ready));
  // Each frame is drawn once, at twice its size, and the picture of it is held for as long as its voice. (Held as an SVG,
  // ffmpeg draws it again for every video frame: a six-scene video took from 40 s to over 160 s to stitch.)
  let r = { code: 0, out: "" };
  for (const s of ready) {
    if (r.code !== 0) break;
    r = await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-width", String(FRAME_W * 2), "-height", String(FRAME_H * 2), "-i", s.visual, "-frames:v", "1", s.visual.replace(/\.svg$/, ".png")], { cwd: DIR });
  }
  const inputs = ready.flatMap((s) => ["-loop", "1", "-framerate", String(FPS), "-t", held(s.dur).toFixed(3), "-i", s.visual.replace(/\.svg$/, ".png"), "-i", s.audio]);
  const chain = ready.map((_, i) => `[${2 * i}:v][${2 * i + 1}:a]`).join("");
  if (r.code === 0) r = await run(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "error", "-y", ...inputs,
      "-filter_complex", `${chain}concat=n=${ready.length}:v=1:a=1[v][a]`, "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart",
      "video.tmp.mp4",
    ],
    { cwd: DIR },
  );
  if (r.code === 0) await fs.rename(path.join(DIR, "video.tmp.mp4"), path.join(DIR, "video.mp4"));
  else error = `ffmpeg failed (code ${r.code}): ${r.out.trim().split("\n").at(-1) ?? ""}`;
}

// ---- final status (unless it was cancelled meanwhile) ----

const finishedAt = Date.now();
await writing;
const now = JSON.parse(await fs.readFile(jobPath, "utf8").catch(() => "{}"));
if (now.status === "running") {
  const rest = { ...job };
  delete rest.progress;
  await writeJson(jobPath, { ...rest, status: error ? "failed" : "done", finishedAt: new Date(finishedAt).toISOString(), ...(error ? { error } : { video: true }) });
}
say(error ? `failed: ${error}` : `done: ${ready.length} scenes, ${finishedAt - startedAt} ms`);

// ---- one calls.jsonl line, same shape as lib/calls.ts ----

try {
  const u = result?.usage ?? {};
  const models = Object.entries(result?.modelUsage ?? {}).sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0));
  const callError = error ?? (!result ? "no result" : undefined);
  const call = {
    t: new Date(startedAt).toISOString(),
    feature: "watch",
    model: models[0]?.[0] ?? "",
    effort: EFFORT,
    course: path.basename(COURSE_DIR),
    ms_first: firstAt ? firstAt - startedAt : 0,
    ms_total: finishedAt - startedAt,
    in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    out: u.output_tokens ?? 0,
    cache_read: u.cache_read_input_tokens ?? 0,
    cost_usd: result?.total_cost_usd ?? 0,
    ok: !callError,
    ...(callError ? { error: callError.slice(0, 500) } : {}),
  };
  const callsFile = path.join(LEARNING, "_shared", "app-data", "calls.jsonl");
  await fs.mkdir(path.dirname(callsFile), { recursive: true });
  await fs.appendFile(callsFile, JSON.stringify(call) + "\n");
} catch (e) {
  say(`could not log the call: ${e.message}`);
}
