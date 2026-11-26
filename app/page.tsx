import { courses } from "@/lib/courses";
import { getLessons } from "@/lib/lessons";
import { embeddedCourses } from "@/lib/embedded";
import CourseShelf, { type ShelfCourse } from "@/components/CourseShelf";
import LibrarySearch from "@/components/LibrarySearch";
import NewCourse from "@/components/NewCourse";

export default function Home() {
  const mdx: ShelfCourse[] = courses.map((c) => {
    const lessons = getLessons(c.slug).filter((l) => l.status === "available");
    return {
      slug: c.slug,
      href: `/courses/${c.slug}`,
      title: c.title,
      blurb: c.blurb,
      meta: [`${lessons.length} lessons`],
      lessons: lessons.map((l) => ({
        title: l.title,
        href: `/courses/${c.slug}/lessons/${l.slug}`,
        minutes: l.minutes,
        lede: l.subtitle,
      })),
    };
  });
  const built: ShelfCourse[] = embeddedCourses.map((c) => ({
    slug: c.slug,
    href: `/learn/${c.slug}`,
    title: c.title,
    blurb: c.lessons[0]?.lede ?? "",
    meta: [`${c.lessons.length} lessons`, `${c.reference.length} cheat sheets`],
    lessons: c.lessons.map((l) => ({
      title: l.title,
      href: `/learn/${c.slug}/${l.slug}`,
      minutes: l.minutes,
      lede: l.lede,
    })),
  }));
  const all = [...built, ...mdx];

  return (
    <div className="lib-breakout">
      <div className="lib">
        <header className="lib-titlebar">
          <div>
            <p className="lib-eyebrow">Your notebook</p>
            <h1>Learn</h1>
          </div>
          <p>
            Lessons written for one reader, one course at a time, on whatever you want to learn.
            Pick up where you left off.
          </p>
        </header>

        <NewCourse empty={all.length === 0} />

        <LibrarySearch courses={all}>
          <CourseShelf courses={all} />
        </LibrarySearch>
      </div>
    </div>
  );
}
