"use client";

import { createContext, useContext, type ReactNode } from "react";

// Lets components embedded in lesson MDX (e.g. BreathTimer) know their course
// without threading props through MDX.
const CourseCtx = createContext<string>("");

export function CourseProvider({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  return <CourseCtx.Provider value={slug}>{children}</CourseCtx.Provider>;
}

export function useCourseSlug(): string {
  return useContext(CourseCtx);
}
