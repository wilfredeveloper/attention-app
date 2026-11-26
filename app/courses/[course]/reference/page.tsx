import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/courses";

export default async function ReferencePage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const course = getCourse(slug);
  if (!course) notFound();

  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-accent">
        {course.title} · Reference
      </p>
      <h1 className="mt-1 text-4xl font-semibold tracking-tight">Glossary</h1>
      <p className="mt-2 text-lg italic text-muted">
        The shared vocabulary. Every lesson uses these terms exactly.
      </p>

      <dl className="mt-8">
        {course.concepts.map((c) => (
          <div key={c.slug} className="mt-6">
            <dt className="text-lg font-semibold">
              <Link href={`/courses/${slug}/concepts/${c.slug}`} className="no-underline">
                {c.title}
              </Link>
            </dt>
            <dd className="ml-0 text-ink">{c.body[0]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
