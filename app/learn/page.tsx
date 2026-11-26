import Link from "next/link";
import { embeddedCourses } from "@/lib/embedded";
import CourseShelf, { type ShelfCourse } from "@/components/CourseShelf";
import LibrarySearch from "@/components/LibrarySearch";
import NewCourse from "@/components/NewCourse";
import { features } from "@/lib/features";

export const metadata = { title: "The library — Learn" };
export const dynamic = "force-dynamic"; // features() reads this machine, not the build's

export default async function LearnIndex() {
  const can = await features();
  const shelf: ShelfCourse[] = embeddedCourses.map((c) => ({
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

  return (
    <div className="lib-breakout">
      <div className="lib">
        <header className="lib-titlebar">
          <div>
            <p className="lib-eyebrow">Notebook</p>
            <h1>The library</h1>
          </div>
          <div>
            <p>
              Interactive lessons, one course at a time. Highlight anything you don&apos;t follow and
              ask the tutor, right in the page.
            </p>
            <Link
              href="/learn/history"
              className="mt-3 inline-block font-sans text-sm font-medium text-accent no-underline hover:underline"
            >
              Your tutor questions →
            </Link>
            {can.steer && (
              <Link
                href="/steer"
                className="mt-1 block font-sans text-sm font-medium text-accent no-underline hover:underline"
              >
                Steer live: an explanation you steer as you read →
              </Link>
            )}
          </div>
        </header>

        <NewCourse empty={shelf.length === 0} />

        <LibrarySearch courses={shelf}>
          <CourseShelf courses={shelf} />
        </LibrarySearch>
      </div>
    </div>
  );
}
