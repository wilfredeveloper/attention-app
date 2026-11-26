"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ShelfCourse } from "@/components/CourseShelf";

/** A bar that stays at the top of the page as it scrolls: type to find a lesson in any course. Empty, the page shows its
    shelf (children); with words in it, every lesson they all appear in (its title, lede or course), in place of the shelf.
    "/" jumps to it, Esc clears it, Enter opens the first lesson found. */
export default function LibrarySearch({ courses, children }: { courses: ShelfCourse[]; children: React.ReactNode }) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const lessons = useMemo(
    () =>
      courses.flatMap((c) =>
        c.lessons.map((l, i) => ({ ...l, n: i + 1, course: c.title, hay: `${l.title} ${l.lede ?? ""} ${c.title}`.toLowerCase() })),
      ),
    [courses],
  );
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length ? lessons.filter((l) => words.every((w) => l.hay.includes(w))) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || t?.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const total = lessons.length;
  return (
    <>
      <div className="lib-search">
        <label className="lib-search-box">
          <span aria-hidden="true">⌕</span>
          <input
            ref={input}
            type="search"
            value={q}
            placeholder="Search lessons and courses"
            aria-label="Search lessons and courses"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQ("");
              if (e.key === "Enter" && found[0]) router.push(found[0].href);
            }}
          />
          {!q && <kbd>/</kbd>}
        </label>
        <span className="lib-search-count">
          {words.length ? `${found.length} of ${total} lessons` : `${courses.length} courses · ${total} lessons`}
        </span>
      </div>

      {!words.length ? (
        children
      ) : found.length ? (
        <div className="index-list lib-results">
          {found.map((l) => (
            <Link key={l.href} href={l.href} className="index-entry">
              <div className="index-type">
                <span className="big-num">{String(l.n).padStart(2, "0")}</span>
                <small>{l.course}</small>
              </div>
              <div className="index-copy">
                <h2>{l.title}</h2>
                {l.lede && <p>{l.lede}</p>}
              </div>
              <div className="index-date">{l.minutes ? <span>{l.minutes} min read</span> : null}</div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="lib-results-none">Nothing matches “{q.trim()}”.</p>
      )}
    </>
  );
}
