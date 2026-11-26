"use client";

// The tutor margin: an answer about one highlighted passage at a chosen depth, follow-ups,
// and the earlier questions on this lesson. Shared by the reader and the canvas; the view
// calls `ask` (through the ref) when the learner picks a depth on a highlight.
//
// On the canvas it is given `hud` and lays itself out to get to the answer sooner: what was
// highlighted, its one-line definition at once (the one the lesson's margin already shows),
// then a depth handle over the answer. The handle moves the depth in place, and each depth
// read stays, so going back costs nothing. No title, tabs or labels there, and two sounds
// only: a tick when the handle lands, a note when the first words arrive.

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import "katex/dist/katex.min.css";
import { markdownWithMath } from "@/lib/mathMarkdown";
import { useTutor, timeAgo, LEVEL_LABEL, type TutorLevel, type TutorThread } from "@/lib/tutor";
import { logEvent, type View } from "@/lib/events";
import { TUTOR_MIME, type TutorBit } from "@/lib/note";
import { elText, rangeText, wholeMath } from "@/lib/rangeText";
import { DepthRail, type TutorHud } from "@/components/DepthRail";

/** gloss: the passage's one-line definition, when the canvas's HUD had one as it was asked about. */
export type TutorAnchor = { selection: string; heading: string; context: string; level: TutorLevel; gloss?: string };
export type TutorPanelHandle = {
  ask: (a: TutorAnchor) => void;
  open: (threadId: string) => void; // show an earlier thread (a highlight's "A" tag on the canvas)
};
type Turn = { q: string; a: string };

/** Label stored for the automatic first question; not shown as a heading. */
export const FIRST_Q = "Explain this passage";

export function followUps(t: TutorThread): string {
  const n = Math.max(0, t.turns.length - 1);
  return n === 0 ? "No follow-ups" : n === 1 ? "1 follow-up" : `${n} follow-ups`;
}

export default function TutorPanel({
  ref,
  courseSlug,
  courseTitle,
  lessonSlug,
  lessonTitle,
  view: from,
  open,
  setOpen,
  toNote,
  carry,
  hud,
}: {
  hud?: TutorHud; // on the canvas: the HUD's layout, with the depth handle
  ref?: Ref<TutorPanelHandle>;
  courseSlug: string;
  courseTitle: string;
  lessonSlug: string;
  lessonTitle: string;
  view: View;
  open: boolean;
  setOpen: (open: boolean) => void;
  // On the canvas: words selected in an answer go into a note, by → Note or dragged onto one.
  toNote?: (b: TutorBit) => void;
  carry?: (b: TutorBit, down: PointerEvent) => void;
}) {
  const [view, setView] = useState<"chat" | "history">("chat");
  const [anchor, setAnchor] = useState<TutorAnchor | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState<Turn | null>(null);
  const [input, setInput] = useState("");
  const busy = streaming !== null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const threadId = useRef<string | null>(null);
  const [picked, setPicked] = useState<{ bit: TutorBit; range: Range; x: number; y: number } | null>(null);
  // with `hud`: the depths already read for this highlight (their thread and turns), so the depth handle goes back to one at once
  const depths = useRef(new Map<TutorLevel, { tid: string | null; turns: Turn[] }>());
  const [have, setHave] = useState<TutorLevel[]>([]);

  const { startThread, addTurn, deleteThread, threads } = useTutor();
  const lessonThreads = useMemo(
    () => threads.filter((t) => t.course === courseSlug && t.lesson === lessonSlug),
    [threads, courseSlug, lessonSlug],
  );

  const run = useCallback(
    async (question: string, a: TutorAnchor, history: Turn[], tid: string | null) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const label = question || FIRST_Q;
      setStreaming({ q: label, a: "" });
      logEvent(courseSlug, {
        kind: "ask",
        lesson: lessonSlug,
        view: from,
        term: a.selection || null,
        section: a.heading,
        text: label,
        level: a.level,
      });
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            course: courseTitle,
            courseSlug, // for the call log; the title above goes into the prompt
            lesson: lessonTitle,
            heading: a.heading,
            selection: a.selection,
            context: a.context,
            level: a.level,
            question,
            history,
          }),
        });
        if (!res.body) throw new Error("No response stream");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (hud && !acc.trim()) hud.sounds()?.menuReady(0.7); // the first words: one note
          acc += dec.decode(value, { stream: true });
          setStreaming({ q: label, a: acc });
        }
        const answer = acc.trim();
        setTurns((t) => [...t, { q: label, a: answer }]);
        if (hud) setHave((h) => (h.includes(a.level) ? h : [...h, a.level]));
        if (tid) addTurn(tid, { q: label, a: answer, at: Date.now() });
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          setTurns((t) => [
            ...t,
            {
              q: label,
              a: `The tutor didn’t answer (${(e as Error).message}). Check that the \`claude\` CLI is signed in, then ask again.`,
            },
          ]);
      } finally {
        if (abortRef.current === ctrl) setStreaming(null); // not when another answer has started meanwhile
      }
    },
    [courseSlug, courseTitle, lessonSlug, lessonTitle, addTurn, from, hud],
  );

  // A new highlight starts a fresh thread.
  useImperativeHandle(
    ref,
    () => ({
      ask(a: TutorAnchor) {
        // asked before at this depth: that answer comes back, as the handle brings it back
        const saved = lessonThreads.find((t) => (t.level ?? "mid") === a.level && t.selection === a.selection && t.context === a.context && t.turns.length > 0);
        if (saved) {
          openThread(saved, hud ? hud.gloss() : a.gloss);
          setOpen(true);
          return;
        }
        const id = startThread({
          course: courseSlug,
          courseTitle,
          lesson: lessonSlug,
          lessonTitle,
          selection: a.selection,
          heading: a.heading,
          context: a.context,
          level: a.level,
        });
        threadId.current = id;
        setHave(recall(a, a.level));
        const anchored = hud ? { ...a, gloss: hud.gloss() } : a;
        setAnchor(anchored);
        setTurns([]);
        setView("chat");
        setOpen(true);
        run("", anchored, [], id);
      },
      open(id: string) {
        const t = threads.find((x) => x.id === id);
        if (!t) return;
        openThread(t);
        setOpen(true);
      },
    }),
    [run, startThread, setOpen, threads, courseSlug, courseTitle, lessonSlug, lessonTitle, hud],
  );

  // A first answer reads from the top (passage, then answer). A follow-up
  // brings its own question to the top of the margin; nothing chases the stream.
  const isLive = streaming !== null;
  useEffect(() => {
    if (!isLive) return;
    if (liveRef.current && turns.length > 0)
      liveRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
    else scrollRef.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive]);

  function submitFollowUp(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || !anchor || busy) return;
    setInput("");
    run(q, anchor, turns, threadId.current);
  }

  /** The depth handle landed on another depth. One read before comes back as it was; a new one is asked (its own
      thread, as an Ask at that depth always was). An answer cut short by the move is dropped. */
  function toDepth(level: TutorLevel) {
    if (!anchor || level === anchor.level) return;
    hud?.sounds()?.sector((Object.keys(LEVEL_LABEL) as TutorLevel[]).indexOf(level), 0.7);
    // the depth being left: kept with what it has, unless its first answer was still being written (that thread goes)
    if (streaming && turns.length === 0) {
      if (threadId.current) deleteThread(threadId.current);
    } else depths.current.set(anchor.level, { tid: threadId.current, turns });
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(null);
    const a = { ...anchor, level };
    setAnchor(a);
    const kept = depths.current.get(level);
    if (kept) {
      threadId.current = kept.tid;
      setTurns(kept.turns);
      return;
    }
    const id = startThread({ course: courseSlug, courseTitle, lesson: lessonSlug, lessonTitle, selection: a.selection, heading: a.heading, context: a.context, level });
    threadId.current = id;
    setTurns([]);
    run("", a, [], id);
  }

  /** The depths saved before for this passage (each its own thread, the newest answered one per depth), so the handle goes
      back to them instead of asking again. */
  function recall(a: { selection: string; context: string }, skip: TutorLevel): TutorLevel[] {
    depths.current.clear();
    for (const t of lessonThreads) {
      const l = t.level ?? "mid";
      if (l === skip || depths.current.has(l) || t.selection !== a.selection || t.context !== a.context || t.turns.length === 0) continue;
      depths.current.set(l, { tid: t.id, turns: t.turns.map((x) => ({ q: x.q, a: x.a })) });
    }
    return [...depths.current.keys()];
  }

  function openThread(t: TutorThread, gloss?: string) {
    abortRef.current?.abort();
    setStreaming(null);
    setHave([t.level ?? "mid", ...recall(t, t.level ?? "mid")]);
    threadId.current = t.id;
    setAnchor({
      selection: t.selection,
      heading: t.heading,
      context: t.context,
      level: t.level ?? "mid",
      gloss,
    });
    setTurns(t.turns.map((x) => ({ q: x.q, a: x.a })));
    setView("chat");
  }

  /** The selection, when it lies in one answer: the words, maths as $TeX$, and where they are from. */
  function selected(): { bit: TutorBit; range: Range } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !anchor || !threadId.current) return null;
    const range = wholeMath(sel.getRangeAt(0));
    const el = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement);
    const answer = el(range.startContainer)?.closest(".rd-a");
    if (!answer || !scrollRef.current?.contains(answer) || el(range.endContainer)?.closest(".rd-a") !== answer) return null;
    const quote = rangeText(range);
    if (quote.length < 2) return null;
    return { range, bit: { quote, answer: elText(answer), asked: anchor.selection, heading: anchor.heading, thread: threadId.current } };
  }
  /** → Note under the selection's end, while that is in sight in the margin. */
  function place(s: { bit: TutorBit; range: Range } | null) {
    const rects = s?.range.getClientRects();
    const last = rects?.[rects.length - 1];
    const box = scrollRef.current?.getBoundingClientRect();
    if (!s || !last || !box || last.bottom < box.top || last.top > box.bottom) return null;
    return { ...s, x: Math.min(last.right - 8, box.right - 96), y: last.bottom + 6 };
  }
  const onSelection = (e: { clientX: number; clientY: number }) =>
    !!picked && Array.from(picked.range.getClientRects()).some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
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

  if (!open) return null;
  return (
    <aside className={hud ? "rd-panel th" : "rd-panel"} aria-label="Tutor">
      <div className="rd-head">
        {hud ? (
          // no title or tabs: one quiet way to the earlier questions and back
          <button className="th-earlier" onClick={() => setView(view === "chat" ? "history" : "chat")}>
            {view === "chat" ? `Earlier${lessonThreads.length ? ` (${lessonThreads.length})` : ""}` : "Back to this passage"}
          </button>
        ) : (
          <>
            <h2>Tutor</h2>
            <div className="rd-tabs" role="tablist">
              <button className="rd-tab" role="tab" aria-selected={view === "chat"} onClick={() => setView("chat")}>
                This passage
              </button>
              <button className="rd-tab" role="tab" aria-selected={view === "history"} onClick={() => setView("history")}>
                Earlier{lessonThreads.length ? ` (${lessonThreads.length})` : ""}
              </button>
            </div>
          </>
        )}
        <button className="rd-close" onClick={() => setOpen(false)} aria-label="Close tutor">
          ✕
        </button>
      </div>

      {view === "history" ? (
        <div className="rd-scroll">
          {lessonThreads.length === 0 ? (
            <div className="rd-empty">
              <p className="rd-hint">Nothing asked on this lesson yet. Select a sentence in the lesson to start.</p>
            </div>
          ) : (
            <ul className="rd-threads">
              {lessonThreads.map((t) => (
                <li key={t.id} className="rd-thread">
                  <button className="rd-thread-open" onClick={() => openThread(t)}>
                    <p className="rd-excerpt">{t.selection}</p>
                  </button>
                  <div className="rd-thread-meta">
                    <span>{timeAgo(t.createdAt)}</span>
                    <span>{LEVEL_LABEL[t.level ?? "mid"]}</span>
                    <span>{followUps(t)}</span>
                    <button className="rd-remove" onClick={() => deleteThread(t.id)}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="rd-scroll"
            onMouseUp={() => toNote && setPicked(place(selected()))}
            onKeyUp={() => toNote && setPicked(place(selected()))}
            onScroll={() => picked && setPicked(place(picked))}
            // a press on the selection carries it (onto a note), instead of starting a new selection
            onPointerDownCapture={(e) => {
              if (!picked || !carry || e.button !== 0 || e.altKey || e.shiftKey || e.ctrlKey || e.metaKey || !onSelection(e)) return;
              e.preventDefault();
              e.stopPropagation();
              carry(picked.bit, e.nativeEvent);
            }}
            onMouseDownCapture={(e) => picked && carry && e.button === 0 && onSelection(e) && e.preventDefault()}
            onDragStart={(e) => picked && carry && e.preventDefault()}
            // a copy carries the words as a clip of this answer too, which a note takes on paste;
            // formulas as $TeX$, not their glyphs and hidden MathML run together
            onCopy={(e) => {
              const s = selected();
              if (!s) return;
              e.preventDefault();
              const box = document.createElement("div");
              box.append(s.range.cloneContents());
              e.clipboardData.setData("text/html", box.innerHTML);
              e.clipboardData.setData("text/plain", box.querySelector(".katex") ? s.bit.quote : s.range.toString());
              e.clipboardData.setData(TUTOR_MIME, JSON.stringify(s.bit));
              // the board copies its selected shapes on any copy outside a text box, after this and over it
              e.nativeEvent.stopImmediatePropagation();
            }}
          >
            {!anchor ? (
              <div className="rd-empty">
                <p>
                  Select any sentence in the lesson and pick a depth (Simple, Mid or Deep). The answer appears here,
                  written for that exact passage.
                </p>
                <p className="rd-hint">You can keep asking follow-ups about it afterwards.</p>
                {lessonThreads.length > 0 && (
                  <button className="rd-link" onClick={() => setView("history")}>
                    Reopen an earlier question
                  </button>
                )}
              </div>
            ) : (
              <>
                {hud ? (
                  // what was highlighted, its definition at once, then the depth handle over the answer
                  <>
                    <div className="th-lock" title={anchor.selection}>
                      <div>
                        <Quote text={anchor.selection} />
                      </div>
                    </div>
                    {anchor.heading && <p className="th-where">{anchor.heading}</p>}
                    {anchor.gloss && <p className="th-gloss">{anchor.gloss}</p>}
                    <DepthRail level={anchor.level} have={have} onChange={toDepth} />
                  </>
                ) : (
                  <>
                    <p className="rd-label">You highlighted</p>
                    <blockquote className="rd-quote">
                      <Quote text={anchor.selection} />
                    </blockquote>
                    <p className="rd-where">
                      {anchor.heading ? `In “${anchor.heading}” · ` : ""}
                      {LEVEL_LABEL[anchor.level]} explanation
                    </p>
                  </>
                )}

                {turns.map((t, i) => (
                  <Exchange key={i} turn={t} />
                ))}
                {streaming && (
                  <div ref={liveRef} className="rd-turn">
                    <Exchange turn={streaming} live bare wait={hud ? <div className="th-scan" /> : undefined} />
                  </div>
                )}
              </>
            )}
          </div>

          {picked && toNote && (
            <div className="rd-pick" style={{ left: picked.x, top: picked.y }} onMouseDown={(e) => e.preventDefault()}>
              <button
                onClick={() => {
                  toNote(picked.bit);
                  letGo();
                }}
                title="Add these words to the note you last used, as a clip of this answer (or drag them onto a note)"
              >
                → Note
              </button>
            </div>
          )}

          {anchor && (
            <form onSubmit={submitFollowUp} className="rd-compose">
              <textarea
                className="rd-field"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) submitFollowUp(e);
                }}
                rows={1}
                aria-label="Follow-up question"
                placeholder="Ask a follow-up about this passage"
                disabled={busy}
              />
              <button type="submit" className="rd-send" disabled={busy || !input.trim()}>
                {busy ? "Answering" : "Ask"}
              </button>
            </form>
          )}
        </>
      )}
    </aside>
  );
}

/** The highlighted passage; maths highlighted on the canvas arrives as $TeX$ and is typeset. */
function Quote({ text }: { text: string }) {
  // one object per text: React sets innerHTML again whenever it is a new one, which drops a selection in it
  const html = useMemo(() => (text.includes("$") ? { __html: markdownWithMath(text).replace(/^<p>|<\/p>\s*$/g, "") } : null), [text]);
  return html ? <span dangerouslySetInnerHTML={html} /> : <span>{text}</span>;
}

export function Exchange({ turn, live, bare, wait }: { turn: Turn; live?: boolean; bare?: boolean; wait?: ReactNode }) {
  // one object per answer: React sets innerHTML again whenever it is a new one, which drops a selection in it
  const html = useMemo(() => ({ __html: markdownWithMath(turn.a) + (live ? '<span class="rd-caret"></span>' : "") }), [turn.a, live]);
  return (
    <div className={bare ? undefined : "rd-turn"}>
      {turn.q !== FIRST_Q && <p className="rd-q">{turn.q}</p>}
      {turn.a ? (
        <div className="rd-a" dangerouslySetInnerHTML={html} />
      ) : (
        live && (wait ?? <p className="rd-wait">Reading the passage…</p>)
      )}
    </div>
  );
}
