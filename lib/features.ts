import { promises as fs } from "node:fs";
import path from "node:path";

// Features that need more than the claude CLI, and whether this machine has what they need. The app hides
// what it can't run. Server only; read fresh each time, so installing something applies on the next load.
//   watch  narrated videos (scripts/watch-job.mjs): Kokoro (KOKORO_DIR, default kokoro/, with say.py and its models), uv and ffmpeg on PATH
//   steer  the Steer live lab and "Steer from this": OPENROUTER_API_KEY (its decisions and openings run there)

export type Features = { watch: boolean; steer: boolean };

export const KOKORO = process.env.KOKORO_DIR || path.join(process.cwd(), "kokoro");

const exists = (p: string) => fs.access(p).then(() => true, () => false);

async function onPath(bin: string) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) if (dir && (await exists(path.join(dir, bin)))) return true;
  return false;
}

export async function features(): Promise<Features> {
  const [kokoro, uv, ffmpeg] = await Promise.all([exists(path.join(KOKORO, "models", "kokoro-v1.0.onnx")), onPath("uv"), onPath("ffmpeg")]);
  return { watch: kokoro && uv && ffmpeg, steer: !!process.env.OPENROUTER_API_KEY };
}
