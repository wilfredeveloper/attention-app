"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { courses } from "@/lib/courses";

export default function Nav() {
  const pathname = usePathname();
  const m = pathname.match(/^\/courses\/([^/]+)/);
  const course = m ? courses.find((c) => c.slug === m[1]) : undefined;

  if (!course) {
    return (
      <header className="border-b border-rule">
        <nav className="lib-topnav">
          <Link href="/">Learn</Link>
          <Link href="/learn/history">Questions</Link>
          <Link href="/control">Control room</Link>
        </nav>
      </header>
    );
  }

  const base = `/courses/${course.slug}`;
  const links = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/library`, label: "Library" },
    { href: `${base}/reference`, label: "Glossary" },
  ];

  return (
    <header
      className="border-b border-rule"
      style={
        {
          "--accent": course.accent,
          "--accent-soft": course.accentSoft,
        } as React.CSSProperties
      }
    >
      <nav className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-6 py-4">
        <Link href={base} className="font-semibold tracking-tight no-underline text-accent">
          {course.title}
        </Link>
        <div className="flex items-center gap-5 text-sm">
          {links.map((l) => {
            const active = l.exact
              ? pathname === l.href
              : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`no-underline ${active ? "text-accent" : "text-muted hover:text-ink"}`}
              >
                {l.label}
              </Link>
            );
          })}
          <Link href="/" className="no-underline text-muted hover:text-ink">
            ↔ Courses
          </Link>
        </div>
      </nav>
    </header>
  );
}
