import type { Metadata } from "next";
import { Lab } from "@/components/Lab";
import { headingOf } from "@/lib/lab/story/prompt";
import { features } from "@/lib/features";

export const metadata: Metadata = { title: "Steer live — an explanation you steer as you read" };

// The lab full-window, over the site's nav and footer. ?topic=… starts a live explanation of that topic, as a heading the
// text continues after; with none, the lab starts on its default topic.
export default async function SteerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { topic } = await searchParams;
  const first = (Array.isArray(topic) ? topic[0] : topic)?.trim() ?? "";
  if (!(await features()).steer)
    return (
      <div className="mx-auto max-w-xl p-8 font-sans">
        <h1 className="text-xl font-semibold">Steer live needs an OpenRouter key</h1>
        <p className="mt-3">
          Add <code>OPENROUTER_API_KEY=…</code> to <code>.env.local</code> (see <code>.env.example</code>) and restart the app.
        </p>
      </div>
    );
  return (
    <div className="fixed inset-0 z-50 bg-black">
      <Lab key={first} start={headingOf(first)} className="h-full w-full" />
    </div>
  );
}
