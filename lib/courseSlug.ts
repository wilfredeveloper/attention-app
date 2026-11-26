// A course folder's name, from the topic the learner typed. Pure; shared by lib/newCourse.ts and its test.

const MAX_SLUG = 40;

/** "How Transformers work?" -> "how-transformers-work". Empty when the topic has no letters or digits. */
export function slugOf(topic: string): string {
  const words = topic.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  let slug = "";
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > MAX_SLUG) break;
    slug = next;
  }
  return slug || (words[0] ?? "").slice(0, MAX_SLUG);
}
