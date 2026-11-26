"use client";

// The board's chat bar: a floating pill above the toolbar where the learner asks the model anything,
// "like a normal chat". On send a frosted sheet rises over the board — the conversation, with a smooth
// moving mesh gradient drawn from the vibe's colours — and streams the answer (the same /api/ask the tutor
// uses, in "chat" mode, told whatever the board can say about what they are reading and have gathered).
// Words selected in a reply go into a note as a clip (→ Note), the way a tutor answer's do.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import { Exchange } from "@/components/TutorPanel";
import { elText, rangeText, wholeMath } from "@/lib/rangeText";
import { useBoardChat, threadTitle, type ChatThread } from "@/lib/boardChat";
import { timeAgo } from "@/lib/tutor";
import type { ChatBit } from "@/lib/note";

type Turn = { q: string; a: string };

/** Where tldraw's tool strip sits on the board (px from the board's top-left), followed as the board or the strip
    resizes, so the chat can sit beside it and take its place, instead of covering the reading above it. */
type Strip = { left: number; top: number; width: number; height: number; boardW: number };
function useToolStrip(): Strip | null {
  const [strip, setStrip] = useState<Strip | null>(null);
  useEffect(() => {
    const board = document.querySelector<HTMLElement>(".cv-board");
    if (!board) return;
    let watched: Element | null = null;
    const ro = new ResizeObserver(() => measure());
    const measure = () => {
      const tools = board.querySelector(".tlui-main-toolbar__tools");
      if (tools && tools !== watched) {
        if (watched) ro.unobserve(watched);
        ro.observe(tools);
        watched = tools;
      }
      if (!tools) return;
      const b = board.getBoundingClientRect();
      const r = tools.getBoundingClientRect();
      const next = { left: Math.round(r.left - b.left), top: Math.round(r.top - b.top), width: Math.round(r.width), height: Math.round(r.height), boardW: Math.round(b.width) };
      setStrip((s) => (s && s.left === next.left && s.top === next.top && s.width === next.width && s.height === next.height && s.boardW === next.boardW ? s : next));
    };
    ro.observe(board);
    // tldraw renders its toolbar after the editor mounts: look again until it is there
    const retry = setInterval(() => (watched ? clearInterval(retry) : measure()), 250);
    measure();
    return () => {
      clearInterval(retry);
      ro.disconnect();
    };
  }, []);
  return strip;
}

/** The light along the sheet's lower edge: a band in the vibe's accent that hugs the bottom and climbs both sides,
    brightest at the edge (a white rim) and fading inward, its inner edge a slow liquid wave. While tokens stream it
    rises and quickens; when they stop it eases back to a slow drift. Drawn at half size on a canvas: it is blurred anyway. */
function SheetGlow({ live }: { live: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const S = 0.5;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 1, h = 1, raf = 0, last = performance.now(), t = 0, e = 0, frame = 0;
    let accent = "#888";
    const read = () => {
      accent = getComputedStyle(cv).getPropertyValue("--accent").trim() || accent;
    };

    // the lit region: a band along the bottom and a tapering band up each side; k < 1 is a thinner one, nearer the edge
    const shape = (k: number) => {
      const B = (58 + 16 * e) * S * k; // bottom band: its wavy edge rises above the message field
      const A = (11 + 9 * e) * S * k; // the wave on its inner edge
      const up = h * (0.46 + 0.14 * e) * Math.min(1, 0.35 + k); // how far up the sides it climbs
      const tau = Math.PI * 2;
      const bottom = (x: number) => B + A * (0.6 * Math.sin((x / w) * tau * 1.15 + t) + 0.4 * Math.sin((x / w) * tau * 2.4 - t * 1.35));
      const side = (u: number, ph: number) => (B * 0.9 + A * 0.7 * Math.sin(u * 6 + t * 1.1 + ph)) * Math.pow(1 - u, 1.4);
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 3) ctx.lineTo(x, h - bottom(x));
      ctx.lineTo(w, h);
      ctx.closePath();
      for (const [edge, ph] of [[0, 0], [w, 2.1]] as const) {
        ctx.moveTo(edge, h);
        ctx.lineTo(edge, h - up);
        for (let i = 0; i <= 40; i++) {
          const u = 1 - i / 40;
          const d = side(u, ph);
          ctx.lineTo(edge === 0 ? d : w - d, h - u * up);
        }
        ctx.closePath();
      }
    };

    const layer = (k: number, alpha: number, blur: number, fill: string) => {
      ctx.filter = `blur(${(blur * S).toFixed(1)}px)`;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fill;
      shape(k);
      ctx.fill();
    };
    // nested bands, each thinner and stronger, so the light is brightest at the edge and fades inward; one colour
    // (the accent), with a white rim at the very edge so it reads as light
    const paint = () => {
      ctx.clearRect(0, 0, w, h);
      layer(1, 0.14 + 0.12 * e, 8 + 4 * e, accent);
      layer(0.62, 0.2 + 0.15 * e, 6 + 2 * e, accent);
      layer(0.34, 0.28 + 0.18 * e, 4, accent);
      layer(0.2, 0.55 + 0.25 * e, 3, "#fff");
      ctx.globalAlpha = 1;
      ctx.filter = "none";
    };

    const resize = () => {
      const r = cv.getBoundingClientRect();
      w = cv.width = Math.max(1, Math.round(r.width * S));
      h = cv.height = Math.max(1, Math.round(r.height * S));
      read();
      paint();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    resize();
    if (still) return () => ro.disconnect();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = liveRef.current ? 1 : 0;
      e += (target - e) * (1 - Math.exp(-dt / (target > e ? 0.4 : 1.4))); // quick to rise, slow to settle
      t += dt * (0.3 + 1.3 * e);
      if (frame++ % 30 === 0) read(); // the look can change while it is open
      paint();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="bc-glow" aria-hidden="true" />;
}

export default function BoardChat({
  open,
  setOpen,
  courseSlug,
  courseTitle,
  lessonSlug,
  lessonTitle,
  board,
  toNote,
  carry,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseSlug: string;
  courseTitle: string;
  lessonSlug: string;
  lessonTitle: string;
  board: () => string; // a digest of what is on the board right now, read at send time
  toNote: (b: ChatBit) => void; // snip a selection into a note
  carry?: (b: ChatBit, down: PointerEvent) => void; // drag a selection onto a note
}) {
  const [messages, setMessages] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState<Turn | null>(null);
  const [input, setInput] = useState("");
  const [picked, setPicked] = useState<{ bit: ChatBit; range: Range; x: number; y: number } | null>(null);
  const [view, setView] = useState<"chat" | "list">("chat");
  const [activeId, setActiveId] = useState<string | null>(null); // the thread this conversation is saved as
  const busy = streaming !== null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Saved conversations on this lesson, most recently used first (so the chip reopens the last one).
  const { threads, startThread, addTurn, deleteThread } = useBoardChat();
  const lessonThreads = useMemo(
    () => threads.filter((t) => t.course === courseSlug && t.lesson === lessonSlug).sort((a, b) => b.updatedAt - a.updatedAt),
    [threads, courseSlug, lessonSlug],
  );

  const run = useCallback(
    async (question: string, history: Turn[], tid: string) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStreaming({ q: question, a: "" });
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({ mode: "chat", course: courseTitle, courseSlug, lesson: lessonTitle, board: board(), question, history }),
        });
        if (!res.body) throw new Error("No response stream");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          setStreaming({ q: question, a: acc });
        }
        const answer = acc.trim();
        setMessages((m) => [...m, { q: question, a: answer }]);
        addTurn(tid, { q: question, a: answer, at: Date.now() });
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          setMessages((m) => [...m, { q: question, a: `The model didn’t answer (${(e as Error).message}). Check that the \`claude\` CLI is signed in, then ask again.` }]);
      } finally {
        if (abortRef.current === ctrl) setStreaming(null);
      }
    },
    [courseSlug, courseTitle, lessonTitle, board, addTurn],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setTyping(false);
    setOpen(true);
    setView("chat");
    // the first message of a conversation opens a saved thread, named from that question
    let tid = activeId;
    if (!tid) {
      tid = startThread({ course: courseSlug, lesson: lessonSlug, title: threadTitle(q) });
      setActiveId(tid);
    }
    run(q, messages, tid);
  }

  // ---- the bar: a ✦ beside the tool strip; asked for (a click, or /), the strip becomes the message field ----
  const strip = useToolStrip();
  const [typing, setTyping] = useState(false);
  const barField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (typing) barField.current?.focus();
  }, [typing]);
  // the tools step aside while the field stands in their place
  useEffect(() => {
    const board = document.querySelector(".cv-board");
    board?.classList.toggle("bc-typing", typing && !open);
    return () => board?.classList.remove("bc-typing");
  }, [typing, open]);
  // / opens the field, from anywhere that isn't already taking text
  useEffect(() => {
    if (open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      e.stopPropagation();
      setTyping(true);
    };
    document.addEventListener("keydown", onKey, true); // before the board's own shortcuts
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  // New: set the current conversation aside (it stays saved) and start a fresh one.
  function newChat() {
    abortRef.current?.abort();
    setStreaming(null);
    setMessages([]);
    setActiveId(null);
    setInput("");
    setView("chat");
  }

  // Reopen a saved conversation to carry it on.
  function openThread(t: ChatThread) {
    abortRef.current?.abort();
    setStreaming(null);
    setMessages(t.turns.map((x) => ({ q: x.q, a: x.a })));
    setActiveId(t.id);
    setView("chat");
  }

  function removeThread(id: string) {
    deleteThread(id);
    if (id === activeId) newChat();
  }

  // The ✦ chip: with a conversation open or saved, raise the sheet onto the latest one; otherwise the quick bar.
  function fromChip() {
    if (!activeId && lessonThreads.length) openThread(lessonThreads[0]);
    setView("chat");
    setOpen(true);
  }

  // follow the stream to the bottom, unless the learner is selecting (to snip) or has scrolled up
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !window.getSelection()?.isCollapsed) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom || streaming?.a === "") el.scrollTop = el.scrollHeight;
  }, [streaming, messages.length]);

  // Closing, the sheet sinks away before it goes, so the frames it pressed into spring back as it leaves (liquid.ts)
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setOpen(false);
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      setOpen(false);
    }, 320);
  }, [setOpen]);

  // Esc closes the sheet
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && window.getSelection()?.isCollapsed !== false) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // ---- snipping a reply into a note ----
  /** The selection, when it lies in one reply: the words (maths as $TeX$), and the message it answered. */
  function selected(): { bit: ChatBit; range: Range } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = wholeMath(sel.getRangeAt(0));
    const el = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement);
    const answer = el(range.startContainer)?.closest(".rd-a");
    if (!answer || !scrollRef.current?.contains(answer) || el(range.endContainer)?.closest(".rd-a") !== answer) return null;
    const quote = rangeText(range);
    if (quote.length < 2) return null;
    const asked = answer.closest("[data-asked]")?.getAttribute("data-asked") ?? "";
    return { range, bit: { quote, answer: elText(answer), asked, heading: "" } };
  }
  /** → Note under the selection's end, while that is in sight in the sheet. */
  function place(s: { bit: ChatBit; range: Range } | null) {
    const rects = s?.range.getClientRects();
    const last = rects?.[rects.length - 1];
    const box = scrollRef.current?.getBoundingClientRect();
    if (!s || !last || !box || last.bottom < box.top || last.top > box.bottom) return null;
    return { ...s, x: Math.min(last.right - 8, box.right - 96), y: last.bottom + 6 };
  }
  // the bar goes when the selection does
  useEffect(() => {
    if (!picked) return;
    const off = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setPicked(null);
    };
    document.addEventListener("selectionchange", off);
    return () => document.removeEventListener("selectionchange", off);
  }, [picked]);
  const letGo = () => {
    window.getSelection()?.removeAllRanges();
    setPicked(null);
  };
  // true when a press lands on the selected words (so it carries them onto a note instead of reselecting)
  const onSelection = (e: { clientX: number; clientY: number }) =>
    !!picked && Array.from(picked.range.getClientRects()).some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);

  if (!open) {
    if (!strip) return null;
    const CHIP = 44;
    if (!typing) {
      // beside the strip, on its right when there is room, else on its left
      const right = strip.left + strip.width + 10;
      const left = right + CHIP <= strip.boardW - 8 ? right : strip.left - 10 - CHIP;
      return (
        <button
          className="bc-chip"
          style={{ left, top: strip.top + (strip.height - CHIP) / 2, width: CHIP, height: CHIP }}
          onClick={() => (activeId || lessonThreads.length ? fromChip() : setTyping(true))}
          aria-label="Ask the model anything (/)"
          title={activeId || lessonThreads.length ? "Open chat (/)" : "Ask anything (/)"}
        >
          ✦
        </button>
      );
    }
    // in the strip's place: as wide as it, or wider when the board has room, centred on it
    const width = Math.min(Math.max(strip.width, 520), strip.boardW - 32);
    const left = Math.max(16, Math.min(strip.boardW - 16 - width, strip.left + strip.width / 2 - width / 2));
    return (
      <form className="bc-bar" style={{ left, top: strip.top, width, height: strip.height }} onSubmit={submit}>
        <span className="bc-spark" aria-hidden="true">✦</span>
        <input
          ref={barField}
          className="bc-bar-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => !input.trim() && setTyping(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setTyping(false);
            }
          }}
          aria-label="Ask the model anything"
          placeholder="Ask anything…"
        />
        <button type="submit" className="bc-bar-send" disabled={!input.trim()} aria-label="Send">
          ↵
        </button>
      </form>
    );
  }

  return (
    <div
      className={`bc-sheet${busy ? " bc-live" : ""}${closing ? " bc-closing" : ""}`}
      role="dialog"
      aria-label="Chat"
      // the board's frames flow round the sheet as liquid (components/canvas/liquid.ts), and it stays on top of them
      data-lq="chat"
      data-lq-top=""
      data-lq-radius="24"
    >
      <div className="bc-mesh" aria-hidden="true" />
      <SheetGlow live={busy} />
      <div className="bc-sheet-in">
        <header className="bc-head">
          <button className="bc-grab" onClick={close} aria-label="Close chat" title="Close (Esc)" />
          <span className="bc-title">{view === "list" ? "Chats" : "Chat"}</span>
          <button
            className="bc-list-toggle"
            onClick={() => setView((v) => (v === "list" ? "chat" : "list"))}
            title={view === "list" ? "Back to this chat" : "See your chats"}
          >
            {view === "list" ? "Back" : `Chats${lessonThreads.length ? ` (${lessonThreads.length})` : ""}`}
          </button>
          <button className="bc-new" onClick={newChat} title="Start a new chat">
            New
          </button>
          <button className="bc-close" onClick={close} aria-label="Close chat">
            ✕
          </button>
        </header>

        {view === "list" ? (
          <div className="bc-thread">
            {lessonThreads.length === 0 ? (
              <p className="bc-empty">No chats on this lesson yet. Ask anything and it is saved here so you can come back to it.</p>
            ) : (
              <ul className="bc-list-items">
                {lessonThreads.map((t) => (
                  <li key={t.id} className={`bc-list-item${t.id === activeId ? " bc-current" : ""}`}>
                    <button className="bc-list-open" onClick={() => openThread(t)}>
                      <span className="bc-list-title">{t.title}</span>
                      <span className="bc-list-meta">
                        {timeAgo(t.updatedAt)} · {t.turns.length === 1 ? "1 reply" : `${t.turns.length} replies`}
                      </span>
                    </button>
                    <button className="bc-list-remove" onClick={() => removeThread(t.id)} title="Remove this chat" aria-label="Remove this chat">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="bc-thread"
              onMouseUp={() => setPicked(place(selected()))}
              onKeyUp={() => setPicked(place(selected()))}
              onScroll={() => picked && setPicked(place(picked))}
              // a press on the selection carries it onto a note, instead of starting a new selection
              onPointerDownCapture={(e) => {
                if (!picked || !carry || e.button !== 0 || e.altKey || e.shiftKey || e.ctrlKey || e.metaKey || !onSelection(e)) return;
                e.preventDefault();
                e.stopPropagation();
                carry(picked.bit, e.nativeEvent);
              }}
              onMouseDownCapture={(e) => picked && carry && e.button === 0 && onSelection(e) && e.preventDefault()}
              onDragStart={(e) => picked && carry && e.preventDefault()}
            >
              {messages.length === 0 && !streaming ? (
                <p className="bc-empty">Ask anything about what you’re reading — or anything at all. Answers appear here; select any part of one to clip it into a note, or drag it onto one.</p>
              ) : (
                <>
                  {messages.map((t, i) => (
                    <div key={i} className="bc-turn" data-asked={t.q}>
                      <Exchange turn={t} />
                    </div>
                  ))}
                  {streaming && (
                    <div className="bc-turn" data-asked={streaming.q}>
                      <Exchange turn={streaming} live />
                    </div>
                  )}
                </>
              )}
            </div>

            {picked && (
              <div className="rd-pick" style={{ left: picked.x, top: picked.y }} onMouseDown={(e) => e.preventDefault()}>
                <button onClick={() => { toNote(picked.bit); letGo(); }} title="Add these words to your note as a clip of this reply">
                  → Note
                </button>
              </div>
            )}

            <form className="bc-compose" onSubmit={submit}>
              <textarea
                className="bc-field"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) submit(e);
                }}
                rows={1}
                aria-label="Message"
                placeholder="Ask anything…"
              />
              <button type="submit" className="bc-send" disabled={busy || !input.trim()}>
                {busy ? "…" : "Ask"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
