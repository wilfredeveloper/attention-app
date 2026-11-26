// Shared content types for the multi-course platform.
// Concrete course data lives in content/courses/<slug>/course.ts.

export type Source = { label: string; url: string };

export type Concept = {
  slug: string;
  title: string;
  summary: string;
  body: string[];
  related: string[]; // concept slugs (same course)
  source?: Source;
};

export type Resource = {
  title: string;
  url?: string;
  note: string;
  kind: "knowledge" | "community";
};

export type Course = {
  slug: string;
  title: string;
  tagline: string; // the mission line, shown on the course dashboard
  blurb: string; // one-liner for the course-picker card
  accent: string; // hex — themes the course (overrides --accent)
  accentSoft: string; // hex — soft background tint
  practice?: { prompt: string }; // presence-style courses only (daily rep + streak)
  concepts: Concept[];
  resources: Resource[];
};

export function getConcept(
  course: Course,
  slug: string
): Concept | undefined {
  return course.concepts.find((c) => c.slug === slug);
}
