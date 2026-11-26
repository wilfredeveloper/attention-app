import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ReactNode } from "react";
import BreathTimer from "@/components/BreathTimer";
import Quiz from "@/components/Quiz";

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="my-6 rounded-xl border border-rule bg-accent-soft p-5">
      {children}
    </div>
  );
}

type Column = { title: string; items: string[] };
// Renders **bold** and *italic* inside a comparison bullet (markdown lite).
function inline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.endsWith("*"))
      return <em key={i}>{p.slice(1, -1)}</em>;
    return <span key={i}>{p}</span>;
  });
}
function Compare({ left, right }: { left: Column; right: Column }) {
  return (
    <div className="my-6 grid gap-4 sm:grid-cols-2">
      {[left, right].map((col) => (
        <div key={col.title} className="rounded-xl border border-rule bg-card p-4">
          <h4 className="mb-2 font-semibold text-accent">{col.title}</h4>
          <ul className="list-disc space-y-1.5 pl-4 text-[0.95rem]">
            {col.items.map((it, i) => (
              <li key={i}>{inline(it)}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h2: ({ children }) => (
      <h2 className="mt-10 border-b border-rule pb-1.5 text-lg font-semibold">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-8 text-base font-semibold">{children}</h3>
    ),
    p: ({ children }) => <p className="my-4 leading-relaxed">{children}</p>,
    ul: ({ children }) => (
      <ul className="my-4 list-disc space-y-1 pl-6">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-4 list-decimal space-y-1 pl-6">{children}</ol>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-6 border-l-2 border-accent pl-5 italic">
        {children}
      </blockquote>
    ),
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    hr: () => <hr className="my-8 border-rule" />,
    a: ({ href = "", children, ...props }) => {
      if (href.startsWith("/")) {
        return (
          <Link href={href} {...props}>
            {children}
          </Link>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" {...props}>
          {children}
        </a>
      );
    },
    // Interactive + layout components available inside any lesson MDX:
    BreathTimer,
    Quiz,
    Callout,
    Compare,
    ...components,
  };
}
