import { notFound } from "next/navigation";
import { courses, getCourse } from "@/lib/courses";

export function generateStaticParams() {
  return courses.map((c) => ({ course: c.slug }));
}

export default async function CourseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const course = getCourse(slug);
  if (!course) notFound();

  return (
    <div
      style={
        {
          "--accent": course.accent,
          "--accent-soft": course.accentSoft,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
