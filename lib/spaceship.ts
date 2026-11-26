// The steer-live lab ("spaceship" upstream; lib/lab, shown by components/Lab.tsx): which models its
// server routes call, and what it reports while it runs. Server and client safe: no DOM, no "use client".

/** The models /api/spaceship/complete and /api/spaceship/decide call. */
export const SPACESHIP_TEXT_MODEL = "openai/gpt-oss-120b";
export const SPACESHIP_DECIDE_MODEL = "typesafe/jev-1.14";

/** The lab in a canvas note writes through this route instead. It calls the model picked in the control room's Models tab
    (lib/models.ts `lab`): LAB_CLAUDE_MODEL on the machine's logged-in claude CLI (lib/labPool.ts), or any model on OpenRouter. */
export const LAB_ROUTE = "/api/lab/complete";
export const LAB_CLAUDE_MODEL = "claude-haiku-5-5";

/** An OpenRouter model id: "vendor/model", with an optional ":variant" (deepseek/deepseek-v4-flash, openai/gpt-oss-120b). */
const OPENROUTER_ID = /^~?[a-z0-9][\w.-]*\/[\w.-]+(:[\w-]+)?$/i;
export const isLabModel = (m: unknown): m is string => m === LAB_CLAUDE_MODEL || (typeof m === "string" && OPENROUTER_ID.test(m));

// ---- what the lab reports while it runs ("Steer live" telemetry) ----
// The lab hands these to its host (onEvent in lib/lab/lab.ts), which files them in the study log as
// `steer` events (lib/events.ts); /api/events checks them here.

export type SteerEvent =
  | { type: "launch"; phrase: string }
  /** A dial dropped where it now rests (on), or deleted while still steering (off). */
  | { type: "dial"; on: boolean; dim: string; value: string; position: number; strength: number }
  /** A dial's setting surely delivered by a sentence: it pins beside it. */
  | { type: "pin"; dim: string; sentence: string; confidence: number }
  /** The knob, once at rest, was dragged back past `words` shown words, discarding the text after them. */
  | { type: "dragback"; words: number; discarded: string }
  | { type: "close"; secs: number; words: number; dials: number };

/** What every lab event carries besides itself: the lab's session id, and the version stamps (lib/lab/stamp.ts). Since the lab is
    built with the app, `build` is "app"; events from before carry the hash of its separate build. */
export type SteerEnvelope = { session: string; schema: 1; build: string; prompt: string };

/** The canvas lab's models, as stamped on its steer events: its text model and how it was reached, and the decide model it still
    uses (/api/spaceship/decide). */
export const labModelStamp = (lab: string) =>
  `${lab} via ${lab === LAB_CLAUDE_MODEL ? "claude CLI" : "OpenRouter"}, ${SPACESHIP_DECIDE_MODEL}`;

const str = (v: unknown) => typeof v === "string";
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const bool = (v: unknown) => typeof v === "boolean";
const FIELDS: Record<SteerEvent["type"], Record<string, (v: unknown) => boolean>> = {
  launch: { phrase: str },
  dial: { on: bool, dim: str, value: str, position: num, strength: num },
  pin: { dim: str, sentence: str, confidence: num },
  dragback: { words: num, discarded: str },
  close: { secs: num, words: num, dials: num },
};

export function isSteerEvent(v: unknown): v is SteerEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  const fields = typeof e.type === "string" && Object.hasOwn(FIELDS, e.type) ? FIELDS[e.type as SteerEvent["type"]] : undefined;
  return !!fields && Object.entries(fields).every(([k, ok]) => ok(e[k]));
}
