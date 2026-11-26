import { promises as fs } from "node:fs";
import path from "node:path";
import { LEARNING } from "@/lib/paths";
import { FEATURES, MODELS, type Model, getSettings, saveSettings, validate } from "@/lib/models";
import type { WatchJob } from "@/lib/watch";
import type { Call } from "@/lib/calls";
import { isLocalRequest, notLocal } from "@/lib/local";

// Model routing settings (lib/models.ts) for the control room's Models tab.
//   GET                -> { models, prefetchPictures, lab } with defaults filled in
//   GET ?measured=1    -> the same plus `measured`: medians per feature and model from
//                         calls.jsonl over the last 30 days, the lab's medians per model id, what explain.4 calls cost,
//                         and the finished videos per watch model and effort (how long they took, the latest one to look at)
//   PUT { models?, prefetchPictures?, lab?, watchEffort? } -> saves; 400 on unknown features, models or keys

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAYS = 30;

type Stat = { n: number; first: number; total: number; cost: number }; // medians: ms, ms, USD per call

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// "claude-haiku-4-5-20251001" -> "haiku"
const family = (id: string) => MODELS.find((m) => id.includes(m));

async function measured() {
  let text = "";
  try {
    text = await fs.readFile(path.join(LEARNING, "_shared", "app-data", "calls.jsonl"), "utf8");
  } catch {
    /* no calls yet */
  }
  const since = Date.now() - DAYS * 86_400_000;
  const groups = new Map<string, Call[]>();
  const lab = new Map<string, Call[]>(); // the Steer live lab's calls, by model id: its models aren't just haiku, sonnet, opus
  const pictures = { calls: 0, cost: 0 };
  for (const line of text.split("\n")) {
    let c: Call;
    try {
      c = JSON.parse(line);
    } catch {
      continue;
    }
    if (!c || !(Date.parse(c.t) >= since)) continue;
    if (c.feature === "explain.4") {
      pictures.calls++;
      pictures.cost += c.cost_usd || 0;
    }
    if (c.feature === "lab" && c.ok && c.model) lab.set(c.model, [...(lab.get(c.model) ?? []), c]);
    const fam = family(c.model ?? "");
    if (!c.ok || !fam || !(FEATURES as string[]).includes(c.feature)) continue;
    const key = `${c.feature}|${fam}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const stat = (cs: Call[]): Stat => ({
    n: cs.length,
    first: median(cs.map((c) => c.ms_first)),
    total: median(cs.map((c) => c.ms_total)),
    cost: median(cs.map((c) => c.cost_usd)),
  });
  const stats: Record<string, Partial<Record<Model, Stat>>> = {};
  for (const [key, cs] of groups) {
    const [f, m] = key.split("|") as [string, Model];
    (stats[f] ??= {})[m] = stat(cs);
  }
  return { days: DAYS, stats, lab: Object.fromEntries([...lab].map(([m, cs]) => [m, stat(cs)])), pictures };
}

type WatchStat = { n: number; secs: number; latest: { course: string; id: string; term: string; scenes: number; secs: number } };

/** The videos made in the last DAYS, by "model|effort" ("opus|high"): how many, their median time from ▶ Watch to
    the whole video, and the newest one. A video made before the effort was saved on its job isn't counted. */
async function watched(): Promise<Record<string, WatchStat>> {
  const since = Date.now() - DAYS * 86_400_000;
  const groups = new Map<string, { job: WatchJob; secs: number; scenes: number }[]>();
  const courses = await fs.readdir(LEARNING).catch(() => [] as string[]);
  for (const course of courses) {
    const dir = path.join(LEARNING, course, "app-data", "videos");
    for (const id of await fs.readdir(dir).catch(() => [] as string[])) {
      const job = await fs.readFile(path.join(dir, id, "job.json"), "utf8").then((t) => JSON.parse(t) as WatchJob, () => null);
      if (!job || job.status !== "done" || !job.effort || !job.finishedAt || !(Date.parse(job.createdAt) >= since)) continue;
      const scenes = await fs.readFile(path.join(dir, id, "scenes.json"), "utf8").then((t) => (JSON.parse(t) as unknown[]).length, () => 0);
      const key = `${family(job.model) ?? job.model}|${job.effort}`;
      groups.set(key, [...(groups.get(key) ?? []), { job, scenes, secs: (Date.parse(job.finishedAt) - Date.parse(job.createdAt)) / 1000 }]);
    }
  }
  const out: Record<string, WatchStat> = {};
  for (const [key, vs] of groups) {
    const last = vs.reduce((a, b) => (a.job.createdAt > b.job.createdAt ? a : b));
    out[key] = {
      n: vs.length,
      secs: median(vs.map((v) => v.secs)),
      latest: { course: last.job.course, id: last.job.id, term: last.job.input.term.length > 80 ? `${last.job.input.term.slice(0, 79)}…` : last.job.input.term, scenes: last.scenes, secs: last.secs },
    };
  }
  return out;
}

export async function GET(req: Request) {
  const settings = await getSettings();
  if (!new URL(req.url).searchParams.has("measured")) return Response.json(settings);
  return Response.json({ ...settings, measured: { ...(await measured()), watch: await watched() } });
}

export async function PUT(req: Request) {
  if (!isLocalRequest(req)) return notLocal(); // changes files or spends money: this machine only (see lib/local.ts)
  const body = await req.json().catch(() => undefined);
  const err = validate(body);
  if (err) return Response.json({ error: err }, { status: 400 });
  return Response.json(await saveSettings(body));
}
