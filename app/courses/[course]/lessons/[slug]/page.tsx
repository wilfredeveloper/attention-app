import Link from "next/link";
import { notFound } from "next/navigation";
import { courses, getCourse } from "@/lib/courses";
import { getLesson, getAvailableLessons } from "@/lib/lessons";
import { getConcept } from "@/lib/content";
import LessonComplete from "@/components/LessonComplete";
import { CourseProvider } from "@/components/CourseContext";

export function generateStaticParams() {
  return courses.flatMap((c) =>
    getAvailableLessons(c.slug).map((l) => ({ course: c.slug, slug: l.slug }))
  );
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ course: string; slug: string }>;
}) {
  const { course: courseSlug, slug } = await params;
  const course = getCourse(courseSlug);
  const lesson = getLesson(courseSlug, slug);
  if (!course || !lesson || lesson.status !== "available") notFound();

  // Auto-discovered MDX body (dynamic-import context over content/courses).
  const { default: Body } = await import(
    `../../../../../content/courses/${courseSlug}/lessons/${lesson.file}`
  );

  return (
    <article>
      <Link href={`/courses/${courseSlug}/library`} className="text-sm text-muted no-underline">
        ← {course.title} Library
      </Link>

      <p className="mt-4 text-xs uppercase tracking-widest text-accent">
        Lesson {lesson.number} · {lesson.minutes} min
      </p>
      <h1 className="mt-1 text-4xl font-semibold tracking-tight">{lesson.title}</h1>
      <p className="mt-2 text-lg italic text-muted">{lesson.subtitle}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {lesson.concepts.map((c) => {
          const concept = getConcept(course, c);
          if (!concept) return null;
          return (
            <Link
              key={c}
              href={`/courses/${courseSlug}/concepts/${c}`}
              className="rounded-full border border-rule px-2.5 py-0.5 text-xs text-muted no-underline hover:border-accent hover:text-accent"
            >
              {concept.title}
            </Link>
          );
        })}
      </div>

      <CourseProvider slug={courseSlug}>
        <Body />
      </CourseProvider>

      <div className="mt-10 rounded-xl border border-rule bg-card p-5">
        <p className="mt-0 text-sm text-muted">Primary source to go deeper:</p>
        <a href={lesson.primarySource.url} target="_blank" rel="noreferrer">
          {lesson.primarySource.label}
        </a>
      </div>

      <div className="mt-8 flex items-center justify-between gap-4">
        <LessonComplete course={courseSlug} slug={lesson.slug} />
        <Link href={`/courses/${courseSlug}`} className="text-sm text-muted no-underline">
          Back to overview →
        </Link>
      </div>
    </article>
  );
}
