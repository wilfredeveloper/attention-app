import { promises as fs } from "node:fs";
import path from "node:path";
import { isCourse } from "@/lib/paths";
import { validId, videoDir } from "@/lib/watchJobs";

// GET ?course=&id=&name= -> one file of a video: a scene's frame or voice, video.mp4 or captions.vtt.
// Byte ranges are honoured, so the player can seek in video.mp4. A frame is model-written SVG: it is
// cleaned as it is saved (lib/watch.ts cleanSvg) and sent with a policy that lets nothing in it run
// or load, for when its address is opened as a page.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAME = /^(?:scene-\d+\.(svg|wav)|video\.(mp4)|captions\.(vtt))$/;
const TYPE: Record<string, string> = { svg: "image/svg+xml", wav: "audio/wav", mp4: "video/mp4", vtt: "text/vtt; charset=utf-8" };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const course = q.get("course") ?? "";
  const id = q.get("id") ?? "";
  const m = NAME.exec(q.get("name") ?? "");
  if (!m || !validId(id) || !(await isCourse(course))) return new Response("Not found", { status: 404 });
  const ext = m[1] ?? m[2] ?? m[3];
  const fh = await fs.open(path.join(videoDir(course, id), m[0]), "r").catch(() => null);
  if (!fh) return new Response("Not found", { status: 404 });
  try {
    const { size } = await fh.stat();
    const headers: Record<string, string> = {
      "Content-Type": TYPE[ext],
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable", // a video's files never change once written
      ...(ext === "svg" ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
    };
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
    let start = 0;
    let end = size - 1;
    if (r && (r[1] || r[2])) {
      start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2]));
      end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    const buf = Buffer.alloc(end - start + 1);
    await fh.read(buf, 0, buf.length, start);
    return new Response(buf, { status: r && (r[1] || r[2]) ? 206 : 200, headers: { ...headers, "Content-Length": String(buf.length) } });
  } finally {
    await fh.close();
  }
}
