import { promises as fs } from "node:fs";
import path from "node:path";
import { claudeOnce } from "@/lib/claude";
import type { Term } from "@/lib/gloss";
import { modelFor } from "@/lib/models";
import { LEARNING, isCourse } from "@/lib/paths";

// A lesson's glossary: every term, phrase, symbol and name in it, each defined in one line as that lesson uses it. Written once,
// by one model call as the lesson first opens on the canvas (the model is `gloss` in the Models tab), and kept in
// learning/<course>/app-data/gloss/<lesson>.json, so every later open reads it at once. The canvas looks highlights up in it in
// memory (lib/gloss.ts, components/canvas/lessonGloss.ts): a definition shows the moment words are highlighted.
//   POST { course, lesson, title, text, write? } -> { terms: [{ term, def, also? }], live: [{ words, scope, def }], cached, none? }
//   POST { course, lesson, add: { words, scope, def } } -> { ok }
// write: false only reads: a linked page's glossary is written the first time words are highlighted in it, not as it opens
// (none: true, there is none yet). `lesson` is a lesson's slug, "ref-<slug>" for a cheat sheet, or "web-<key>" for a website,
// which never gets a glossary, only the definitions written live there.
// `text` is the lesson's words as the canvas shows them. A failed write is not kept, so the next open tries again.
// `live`: definitions written as the learner highlighted words the glossary lacks (lessonGloss.ts), kept with the glossary so
// the same words in the same paragraph (`scope`, lib/gloss.ts scopeKey) cost nothing on any later visit.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 60_000; // characters: the prompt goes through argv, which tops out near 128 KiB

const SYSTEM =
  "You write the glossary a reader sees instantly when they highlight words in one lesson. " +
  "Output only a JSON array, no markdown fence and no commentary: " +
  '[{"term": "...", "def": "...", "also": ["..."]}]. ' +
  "Cover 60 to 150 entries: every technical term, named idea, multi-word phrase with its own meaning, symbol, acronym and " +
  "person or system the lesson names, plus everyday words it uses in a special sense. Use the term as it appears in the lesson. " +
  '"def" is one plain sentence of at most 20 words that defines it as THIS lesson uses it: start with the meaning, ' +
  "never repeat the term, no preamble, no markdown, no LaTeX (write math as plain Unicode text). " +
  '"also" lists other spellings in the text (plurals, the acronym or its expansion, a symbol), or is left out.';

/** A definition written live for words in one paragraph. */
type Live = { words: string; scope: string; def: string };
type Kept = { terms: Term[]; live?: Live[]; model?: string; ms?: number };
const MAX_LIVE = 2000; // kept per lesson, the newest

/** Writes under way, by file: a second request for the same lesson (a reload meanwhile) waits for the first. */
const writing = new Map<string, Promise<Term[]>>();

export async function POST(req: Request) {
  const { course = "", lesson = "", title = "", text = "", add, write = true } = (await req.json().catch(() => ({}))) as Record<string, string> & { add?: Live; write?: boolean };
  if (!(await isCourse(course)) || !/^[\w.-]+$/.test(lesson)) return Response.json({ error: "unknown course or lesson" }, { status: 400 });
  const file = path.join(LEARNING, course, "app-data", "gloss", `${lesson}.json`);
  const read = () => fs.readFile(file, "utf8").then((s) => JSON.parse(s) as Kept, () => null);
  if (add) return keepLive(file, add, read);
  const kept = await read();
  // a file of definitions written live only (a site's, or a page's from before its glossary) has no glossary in it yet
  if (kept?.terms.length) return Response.json({ terms: kept.terms, live: kept.live ?? [], cached: true });
  if (!write || lesson.startsWith("web-")) return Response.json({ terms: [], live: kept?.live ?? [], cached: true, none: true });
  if (!text.trim()) return Response.json({ error: "no lesson text" }, { status: 400 });

  let job = writing.get(file);
  if (!job) {
    job = writeGlossary(file, course, title, text, read).finally(() => writing.delete(file));
    writing.set(file, job);
  }
  try {
    const terms = await job;
    return Response.json({ terms, live: (await read())?.live ?? [], cached: false });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}

/** Keeps a live definition with the lesson's glossary (one per words and paragraph, the newest). Only once the glossary is there. */
let keeping: Promise<unknown> = Promise.resolve();
function keepLive(file: string, add: Live, read: () => Promise<Kept | null>) {
  const ok = [add.words, add.scope, add.def].every((v) => typeof v === "string" && v.trim()) && add.words.length <= 600 && add.def.length <= 600;
  if (!ok) return Response.json({ error: "a kept definition needs its words, their paragraph and the definition" }, { status: 400 });
  // one write at a time: two definitions kept at once would each write the file without the other
  const job = keeping.then(async () => {
    const kept = (await read()) ?? { terms: [] }; // a site's file, or a page's before its glossary: definitions written live only
    await fs.mkdir(path.dirname(file), { recursive: true });
    const same = (l: Live) => l.scope === add.scope && l.words.toLowerCase() === add.words.toLowerCase();
    const live = [...(kept.live ?? []).filter((l) => !same(l)), { words: add.words, scope: add.scope, def: add.def }].slice(-MAX_LIVE);
    await fs.writeFile(file, JSON.stringify({ ...kept, live }, null, 1));
    return true;
  });
  keeping = job.catch(() => {});
  return job.then(
    (done) => Response.json({ ok: done }),
    (e) => Response.json({ error: String(e) }, { status: 500 }),
  );
}

async function writeGlossary(file: string, course: string, title: string, text: string, read: () => Promise<Kept | null>): Promise<Term[]> {
  const startedAt = Date.now();
  const model = await modelFor("gloss");
  const out = await claudeOnce({ feature: "gloss", course, model, system: SYSTEM, prompt: `Lesson: "${title}"\n\n${text.slice(0, MAX_TEXT)}`, timeoutMs: 240_000 });
  const terms = (JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1)) as Term[]).filter((t) => t && typeof t.term === "string" && typeof t.def === "string");
  if (!terms.length) throw new Error("the glossary came back empty");
  await fs.mkdir(path.dirname(file), { recursive: true });
  // definitions written live before the glossary was (a linked page's) stay with it
  const live = (await read())?.live;
  await fs.writeFile(file, JSON.stringify({ terms, model, ms: Date.now() - startedAt, ...(live?.length ? { live } : {}) }, null, 1));
  return terms;
}
