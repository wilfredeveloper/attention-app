"use client";

// The board chat's saved threads: each "Ask anything" conversation on a lesson, kept in this browser so
// the ✦ bar reopens the last one and the sheet can list them. Parallel to lib/tutor.ts (which saves the
// passage-anchored tutor threads); kept separate because a chat has no passage, depth or heading — just a
// generated name and its turns.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

const safeStorage = createJSONStorage(() =>
  typeof window !== "undefined"
    ? window.localStorage
    : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
);

export type ChatTurn = { q: string; a: string; at: number };

export type ChatThread = {
  id: string;
  course: string; // slug
  lesson: string; // slug
  title: string; // a short name from the first question (threadTitle)
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
};

type NewThread = { course: string; lesson: string; title: string };

type ChatState = {
  threads: ChatThread[];
  startThread: (t: NewThread) => string;
  addTurn: (id: string, turn: ChatTurn) => void;
  deleteThread: (id: string) => void;
};

function makeId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(36).slice(2);
}

export const useBoardChat = create<ChatState>()(
  persist(
    (set) => ({
      threads: [],
      startThread: (t) => {
        const id = makeId();
        const now = Date.now();
        set((s) => ({ threads: [{ ...t, id, createdAt: now, updatedAt: now, turns: [] }, ...s.threads] }));
        return id;
      },
      addTurn: (id, turn) =>
        set((s) => ({
          threads: s.threads.map((th) =>
            th.id === id ? { ...th, updatedAt: Date.now(), turns: [...th.turns, turn] } : th,
          ),
        })),
      deleteThread: (id) => set((s) => ({ threads: s.threads.filter((th) => th.id !== id) })),
    }),
    { name: "learn.boardChat.v1", storage: safeStorage },
  ),
);

/** A short name for a thread, from the first question asked in it. Collapses whitespace, strips a leading
    maths delimiter and trailing punctuation, and caps it at ~40 chars on a word boundary with an ellipsis.
    An empty or wordless question falls back to "New chat". */
export function threadTitle(firstQuestion: string): string {
  const trail = /[?!.,;:\s"'”’)]+$/;
  const q = firstQuestion.replace(/\s+/g, " ").trim().replace(/^["'“‘(]+/, "");
  if (!q) return "New chat";
  if (q.length <= 40) return q.replace(trail, "") || "New chat";
  const cut = q.slice(0, 40);
  const sp = cut.lastIndexOf(" ");
  const head = (sp > 20 ? cut.slice(0, sp) : cut).replace(trail, "");
  return `${head}…`;
}
