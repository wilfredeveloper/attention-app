import Link from "next/link";
import { notFound } from "next/navigation";
import { courses, getCourse } from "@/lib/courses";
import { getConcept } from "@/lib/content";

export function generateStaticParams() {
  return courses.flatMap((c) =>
    c.concepts.map((concept) => ({ course: c.slug, slug: concept.slug }))
  );
}

export default async function ConceptPage({
  params,
}: {
  params: Promise<{ course: string; slug: string }>;
}) {
  const { course: courseSlug, slug } = await params;
  const course = getCourse(courseSlug);
  if (!course) notFound();
  const concept = getConcept(course, slug);
  if (!concept) notFound();

  return (
    <article>
      <Link href={`/courses/${courseSlug}/library`} className="text-sm text-muted no-underline">
        ← {course.title} Library
      </Link>

      <p className="mt-4 text-xs uppercase tracking-widest text-accent">Concept</p>
      <h1 className="mt-1 text-4xl font-semibold tracking-tight">{concept.title}</h1>
      <p className="mt-2 text-lg italic text-muted">{concept.summary}</p>

      <div className="mt-6 space-y-4 leading-relaxed">
        {concept.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {concept.source && (
        <p className="mt-6 text-sm text-muted">
          Source:{" "}
          <a href={concept.source.url} target="_blank" rel="noreferrer">
            {concept.source.label}
          </a>
        </p>
      )}

      {concept.related.length > 0 && (
        <div className="mt-8 border-t border-rule pt-4">
          <p className="mb-2 text-sm text-muted">Related concepts</p>
          <div className="flex flex-wrap gap-2">
            {concept.related.map((r) => {
              const rc = getConcept(course, r);
              if (!rc) return null;
              return (
                <Link
                  key={r}
                  href={`/courses/${courseSlug}/concepts/${r}`}
                  className="rounded-full border border-rule px-2.5 py-0.5 text-xs text-muted no-underline hover:border-accent hover:text-accent"
                >
                  {rc.title}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
