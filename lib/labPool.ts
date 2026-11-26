import { spawn, type ChildProcess } from "node:child_process";

// A pool of `claude` CLI processes started ahead of time, for the Steer live lab in a canvas note (app/api/lab/complete): Haiku 5.5 on
// the machine's logged-in subscription, never an API key. A fresh `claude -p` takes 2 to 6 s to its first token, most of it the
// CLI starting up. One started with `--input-format stream-json` does its start-up while it waits for a message on stdin, so a
// process left idle for a few seconds has the API answering about 0.6 s after its message (Haiku then thinks before its first word).
// Each process serves one call and is then killed, so no call sees another's conversation (a reused process keeps its history),
// and a replacement starts as soon as one is taken. Calls past the caps get a 429 at once (the lab retries with backoff); a sign
// that the subscription is out of calls or logged out pauses the pool for a few minutes, with quick 503s meanwhile.
// Server only. Node built-ins only, so lib/labPool.test.mjs can run it against a fake `claude` (lib/labPool.fake.mjs).

/** The lab sends a different system prompt for each kind of call, but a process is started before anyone knows which call it
    will serve. So every process starts with this one, and each call's own system prompt goes at the top of its message (`messageOf`).
    Its last sentence is for speed: Haiku 5.5 thinks before it writes, even at `--effort low`, and the reader waits for that. */
const NEUTRAL_SYSTEM =
  "The user message starts with your instructions, in <instructions> tags: follow them exactly, as your system prompt. Everything after </instructions> is the user message they refer to. Start writing your reply at once: don't plan or deliberate first.";

const DEFAULTS = {
  idle: 3, // processes kept started and waiting
  maxActive: 4, // calls at once
  perMinute: 20, // calls a minute, as a token bucket that holds as many
  firstTokenMs: 8_000, // a call with no text by then is killed (504)
  silenceMs: 15_000, // nor any output for this long once it streams
  breakerMs: 180_000, // the pause after a rate limit or login error
  respawnMs: 1_000, // the wait before replacing an idle process that died, doubled for each death in a row
};
const MAX_RESPAWN_MS = 60_000;
/** Used when the body names no max_completion_tokens. */
const DEFAULT_MAX_TOKENS = 2_000;

/** What `log` hears once per call, as it ends (lib/calls.ts's CallMeta, less the feature the route adds). */
export type CallLog = { course: string; startedAt: number; firstTokenAt: number | null; error?: string };

export type LabPoolOptions = Partial<typeof DEFAULTS> & {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** `result` is the CLI's final {"type":"result"} line, or null when the call ended without one. */
  log?: (result: unknown, call: CallLog) => void;
};

export type LabPool = {
  /** Answers one OpenAI-style chat body (`messages`, `max_completion_tokens`; `temperature` is dropped) as the SSE stream the lab
      reads. Resolves once the first text arrives, so a call that fails before then gets a status: 400, 429, 503, 504 or 502. */
  respond(body: unknown, signal: AbortSignal, course?: string): Promise<Response>;
  /** The pids waiting and serving, and whether the pool is paused: for tests and debugging. */
  snapshot(): { idle: number[]; busy: number[]; paused: boolean };
  /** Kills every process and starts no more. Also run as the server process exits. */
  close(): void;
};

/** How the route starts each process: the lean flags of lib/claude.ts, reading its message from stdin and streaming text deltas.
    Measured on claude 2.1.327: `--bare` would start faster but reads only ANTHROPIC_API_KEY, never the subscription login. Haiku 5.5
    thinks for 150 to 450 tokens before its first word at `--effort low`, and for more without it; neither MAX_THINKING_TOKENS=0
    nor `--thinking disabled` stops it. The CLI has no flags for temperature or length. */
export function claudeCommand(model: string) {
  const env = { ...process.env };
  // The subscription login, never an API key: with either of these set, the CLI would use it instead.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model", model,
    "--effort", "low",
    "--system-prompt", NEUTRAL_SYSTEM,
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--disable-slash-commands",
    "--no-session-persistence",
  ];
  return { command: "claude", args, env };
}

/** A call's own system prompt at the top of its user message, since the process was started with NEUTRAL_SYSTEM. The lab's text
    comes last and untagged, so the message ends where that text does: a continuation is asked to go on from its last word, and a
    closing tag after it reads as if the text were finished (the model began a new sentence after one cut mid-sentence). */
export function messageOf(system: string, user: string) {
  return system.trim() ? `<instructions>\n${system.trim()}\n</instructions>\n\n${user}` : user;
}

/** CLI errors that mean the subscription is out of calls or its login is gone: calling again soon won't help. */
const BLOCKED_ERRORS = new Set(["rate_limit", "authentication_failed", "oauth_org_not_allowed", "account_on_hold", "billing_error"]);
/** The same, as a process that died says it on stderr. */
const BLOCKED_TEXT = /rate.?limit|usage limit|log ?in|logged out|authenticat|expired|unauthori[sz]ed|oauth/i;

type Line = {
  type?: string;
  subtype?: string;
  error?: unknown;
  is_error?: boolean;
  result?: unknown;
  rate_limit_info?: { status?: string };
  event?: { type?: string; delta?: { type?: string; text?: unknown } };
};

/** Why a stream-json line says the subscription is blocked, if it does. Never reads what the model wrote: a lesson may be about logins. */
function blockedBy(line: Line): string | undefined {
  if (line.type === "rate_limit_event" && line.rate_limit_info?.status === "rejected") return "rate limit reached";
  const isError = (line.type === "system" && line.subtype === "api_retry") || line.type === "assistant";
  if (isError && typeof line.error === "string" && BLOCKED_ERRORS.has(line.error)) return line.error;
}

type Proc = {
  child: ChildProcess;
  bornAt: number;
  state: "idle" | "busy" | "gone";
  stderr: string;
  /** Set while it serves a call: each stdout line, and its end (it exited, or never started). */
  onLine?: (line: string) => void;
  onGone?: () => void;
};

const enc = new TextEncoder();
const event = (data: string) => enc.encode(`data: ${data}\n\n`);
const plain = (status: number, message: string) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
/** Tokens in `text`, roughly: the CLI can't cap the reply, so the pool cuts it here. */
const tokensIn = (text: string) => Math.ceil(((text.match(/\S+/g)?.length ?? 0) * 4) / 3);

export function createLabPool(options: LabPoolOptions): LabPool {
  const { command, args, env = process.env, log } = options;
  const { idle: target, maxActive, perMinute, firstTokenMs, silenceMs, breakerMs, respawnMs } = { ...DEFAULTS, ...options };

  const idle: Proc[] = [];
  const busy = new Set<Proc>();
  let closed = false;
  let deaths = 0; // idle processes that died in a row, for the respawn backoff
  let refillTimer: NodeJS.Timeout | undefined;
  let pausedUntil = 0;
  let resumeTimer: NodeJS.Timeout | undefined;
  let tokens = perMinute;
  let filledAt = Date.now();

  function start(state: "idle" | "busy"): Proc {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env });
    const proc: Proc = { child, bornAt: Date.now(), state, stderr: "" };
    let buffer = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        proc.onLine?.(line);
      }
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => (proc.stderr = (proc.stderr + chunk).slice(-2000)));
    // A process that died takes its pipe with it, so a write to it fails: 'close' says why, and an unheard error would crash the server.
    child.stdin!.on("error", () => {});
    // 'close' rather than 'exit': it comes after the last of stdout, so a result written just before exiting is still read.
    const gone = () => {
      if (proc.state === "gone") return;
      const was = proc.state;
      proc.state = "gone";
      if (was === "busy") proc.onGone?.();
      else diedIdle(proc);
    };
    child.on("close", gone);
    child.on("error", gone); // it never started: no `claude` on PATH, say
    return proc;
  }

  /** Ours to end: marked gone first, so its exit isn't taken for a death. Killed hard if it hasn't gone 2 s later. */
  function kill(proc: Proc) {
    proc.state = "gone";
    proc.onLine = proc.onGone = undefined;
    busy.delete(proc);
    const { child } = proc;
    const alive = () => child.exitCode === null && child.signalCode === null;
    if (!alive()) return;
    child.kill("SIGTERM");
    setTimeout(() => alive() && child.kill("SIGKILL"), 2_000).unref();
  }

  function diedIdle(proc: Proc) {
    const at = idle.indexOf(proc);
    if (at >= 0) idle.splice(at, 1);
    if (BLOCKED_TEXT.test(proc.stderr)) pause(`an idle process said: ${proc.stderr.trim().slice(-200)}`);
    deaths++;
    refillIn(Math.min(MAX_RESPAWN_MS, respawnMs * 2 ** (deaths - 1)));
  }

  /** Starts processes until `target` wait. Not while closed, paused, or backing off after deaths (refillIn). */
  function refill() {
    if (closed || refillTimer || isPaused()) return;
    while (idle.length < target) idle.push(start("idle"));
  }

  function refillIn(ms: number) {
    if (closed || refillTimer) return;
    refillTimer = setTimeout(() => {
      refillTimer = undefined;
      refill();
    }, ms).unref();
  }

  const isPaused = () => Date.now() < pausedUntil;

  /** The circuit breaker: no new processes and quick 503s for `breakerMs`. The idle ones go too, so the pool starts afresh after,
      under whatever login the machine has by then. */
  function pause(reason: string) {
    pausedUntil = Date.now() + breakerMs;
    console.warn(`[lab pool] paused for ${Math.round(breakerMs / 1000)} s: ${reason}`);
    for (const proc of idle.splice(0)) kill(proc);
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(refill, breakerMs + 10).unref();
  }

  /** The rate cap: a bucket of `perMinute` calls, refilled steadily. */
  function takeToken() {
    const now = Date.now();
    tokens = Math.min(perMinute, tokens + ((now - filledAt) * perMinute) / 60_000);
    filledAt = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  }

  /** The oldest idle process (the one most likely done starting), or a new one when none wait. A replacement starts after. */
  function take(): { proc: Proc; how: string } {
    const proc = idle.shift() ?? start("busy");
    const how = proc.state === "idle" ? `warm, idle ${Date.now() - proc.bornAt} ms` : "cold";
    proc.state = "busy";
    busy.add(proc);
    setImmediate(refill);
    return { proc, how };
  }

  async function respond(body: unknown, signal: AbortSignal, course = ""): Promise<Response> {
    const startedAt = Date.now();
    const request = requestOf(body);
    if (!request) return plain(400, "expected messages with a user message");
    if (signal.aborted) return plain(499, "aborted");
    if (closed) return plain(503, "the lab's claude pool is closed");
    if (isPaused()) return plain(503, `paused for ${Math.ceil((pausedUntil - Date.now()) / 1000)} s more after a rate limit or login error from claude`);
    if (busy.size >= maxActive) return plain(429, `busy: ${busy.size} lab calls are running`);
    if (!takeToken()) return plain(429, `over ${perMinute} lab calls a minute`);

    const { message, maxTokens } = request;
    const { proc, how } = take();
    return new Promise<Response>((resolve) => {
      let result: Line | null = null;
      let firstTokenAt: number | null = null;
      let written = "";
      let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
      let done = false;
      let timer = setTimeout(() => finish(`no first token in ${firstTokenMs} ms`, 504), firstTokenMs);
      const onAbort = () => finish("aborted", 499);
      signal.addEventListener("abort", onAbort, { once: true });

      /** Ends the call once. `status` marks a failure: before any text, the response; after, an error that breaks the stream. Without
          one the stream ends with [DONE], and `error` (a cut, the client leaving) is only logged. */
      function finish(error?: string, status?: number): void {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        kill(proc);
        log?.(result, { course, startedAt, firstTokenAt, error });
        if (!stream) {
          if (status) return resolve(plain(status, error ?? "failed"));
          // a reply with no text in it
          return resolve(
            sse((c) => {
              c.enqueue(event("[DONE]"));
              c.close();
            }),
          );
        }
        try {
          if (status) stream.error(new Error(error));
          else {
            stream.enqueue(event("[DONE]"));
            stream.close();
          }
        } catch {
          /* the client already cancelled the stream */
        }
      }

      function sse(start: (c: ReadableStreamDefaultController<Uint8Array>) => void): Response {
        const body = new ReadableStream<Uint8Array>({ start, cancel: () => finish("aborted", 499) });
        return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Lab-Process": how } });
      }

      function send(text: string) {
        if (!stream) {
          firstTokenAt = Date.now();
          deaths = 0; // processes start and answer: any backoff is over
          resolve(
            sse((c) => {
              stream = c;
            }),
          );
        }
        written += text;
        stream!.enqueue(event(JSON.stringify({ choices: [{ delta: { content: text } }] })));
        if (tokensIn(written) > maxTokens) finish(`cut at max_completion_tokens (${maxTokens})`);
      }

      proc.onLine = (raw) => {
        let line: Line;
        try {
          line = JSON.parse(raw);
        } catch {
          return; // not a JSON line
        }
        const delta = line.type === "stream_event" && line.event?.type === "content_block_delta" ? line.event.delta : undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          if (delta.text) send(delta.text);
        } else if (line.type === "result") {
          result = line;
          if (!line.is_error) return finish();
          const why = `claude: ${String(line.result ?? "error").slice(0, 300)}`;
          pause(why);
          return finish(why, 503);
        } else {
          const blocked = blockedBy(line);
          if (blocked) {
            pause(blocked);
            return finish(`claude: ${blocked}`, 503);
          }
        }
        if (stream && !done) {
          clearTimeout(timer);
          timer = setTimeout(() => finish(`no output for ${silenceMs} ms`, 504), silenceMs);
        }
      };
      proc.onGone = () => {
        const said = proc.stderr.trim().slice(-300);
        if (BLOCKED_TEXT.test(said)) pause(`claude said: ${said}`);
        finish(said || `claude exited (${proc.child.exitCode ?? proc.child.signalCode}) before its result`, 502);
      };
      proc.child.stdin!.write(JSON.stringify({ type: "user", message: { role: "user", content: message } }) + "\n");
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(refillTimer);
    clearTimeout(resumeTimer);
    process.off("exit", close);
    for (const proc of idle.splice(0)) kill(proc);
    // A call still running ends as its process does (its onGone).
    for (const proc of busy) proc.child.kill("SIGTERM");
  }

  process.on("exit", close);
  refill();
  return {
    respond,
    snapshot: () => ({ idle: idle.map((p) => p.child.pid!), busy: [...busy].map((p) => p.child.pid!), paused: isPaused() }),
    close,
  };
}

/** The lab's body as one message for the CLI, with its token cap. Undefined when there is no user message. */
function requestOf(body: unknown): { message: string; maxTokens: number } | undefined {
  const b = (body && typeof body === "object" ? body : {}) as { messages?: unknown; max_completion_tokens?: unknown };
  if (!Array.isArray(b.messages)) return;
  const messages = b.messages as { role?: unknown; content?: unknown }[];
  const textOf = (role: string) =>
    messages
      .filter((m) => m?.role === role && typeof m.content === "string")
      .map((m) => m.content as string)
      .join("\n\n");
  const user = textOf("user");
  if (!user.trim()) return;
  const max = b.max_completion_tokens;
  return { message: messageOf(textOf("system"), user), maxTokens: typeof max === "number" && max > 0 ? max : DEFAULT_MAX_TOKENS };
}
