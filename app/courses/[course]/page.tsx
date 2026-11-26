import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/courses";
import { getLessons } from "@/lib/lessons";
import ProgressStats from "@/components/ProgressStats";
import TodayPractice from "@/components/TodayPractice";
import LessonCard from "@/components/LessonCard";

export default async function CourseDashboard({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const course = getCourse(slug);
  if (!course) notFound();

  const lessons = getLessons(slug);
  const totalAvailable = lessons.filter((l) => l.status === "available").length;

  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-accent">Course</p>
      <h1 className="mt-1 text-4xl font-semibold tracking-tight">{course.title}</h1>
      <p className="mt-2 text-lg italic text-muted">{course.tagline}</p>

      <ProgressStats
        course={slug}
        totalLessons={totalAvailable}
        hasPractice={!!course.practice}
      />

      {course.practice && (
        <section>
          <h2 className="mb-3 border-b border-rule pb-1.5 text-lg font-semibold">
            Today&apos;s practice
          </h2>
          <TodayPractice course={slug} prompt={course.practice.prompt} />
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-3 border-b border-rule pb-1.5 text-lg font-semibold">
          Lessons
        </h2>
        <div className="space-y-3">
          {lessons.map((l) => (
            <LessonCard key={l.slug} lesson={l} />
          ))}
        </div>
        <p className="mt-4 text-sm text-muted">
          Browse concepts and sources in the{" "}
          <Link href={`/courses/${slug}/library`}>library</Link>.
        </p>
      </section>
    </div>
  );
}
