import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/courses";
import { getLessons } from "@/lib/lessons";
import LessonCard from "@/components/LessonCard";

export default async function CourseLibrary({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const course = getCourse(slug);
  if (!course) notFound();
  const lessons = getLessons(slug);

  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-accent">
        {course.title} · Library
      </p>
      <h1 className="mt-1 text-4xl font-semibold tracking-tight">
        Everything, in one place
      </h1>
      <p className="mt-2 text-lg italic text-muted">
        Lessons to do, concepts to review, sources to trust.
      </p>

      <section className="mt-10">
        <h2 className="mb-3 border-b border-rule pb-1.5 text-lg font-semibold">Lessons</h2>
        <div className="space-y-3">
          {lessons.map((l) => (
            <LessonCard key={l.slug} lesson={l} />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 border-b border-rule pb-1.5 text-lg font-semibold">Concepts</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {course.concepts.map((c) => (
            <Link
              key={c.slug}
              href={`/courses/${slug}/concepts/${c.slug}`}
              className="rounded-xl border border-rule bg-card p-4 no-underline transition hover:border-accent"
            >
              <div className="font-semibold text-ink">{c.title}</div>
              <div className="mt-1 text-sm text-muted">{c.summary}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 border-b border-rule pb-1.5 text-lg font-semibold">
          Sources &amp; community
        </h2>
        <ul className="space-y-4">
          {course.resources.map((r) => (
            <li key={r.title}>
              <div className="font-semibold">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {r.title}
                  </a>
                ) : (
                  r.title
                )}
                {r.kind === "community" && (
                  <span className="ml-2 rounded-full border border-rule px-2 py-0.5 text-xs text-muted">
                    community
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted">{r.note}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
