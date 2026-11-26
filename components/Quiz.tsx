"use client";

import { useState } from "react";

export type QuizItem = {
  q: string;
  opts: string[];
  correct: number;
  fb: string;
};

function Question({ item, index }: { item: QuizItem; index: number }) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;

  return (
    <div className="my-6">
      <p className="font-semibold">
        {index + 1}. {item.q}
      </p>
      <div className="mt-2 space-y-2">
        {item.opts.map((opt, oi) => {
          const isCorrect = oi === item.correct;
          const isPicked = oi === picked;
          let cls =
            "block w-full rounded-lg border px-3.5 py-2.5 text-left transition ";
          if (!answered) cls += "border-rule bg-card hover:border-accent cursor-pointer";
          else if (isCorrect) cls += "border-win bg-win/10";
          else if (isPicked) cls += "border-red-400 bg-red-400/10";
          else cls += "border-rule bg-card opacity-60";
          return (
            <button
              key={oi}
              disabled={answered}
              onClick={() => setPicked(oi)}
              className={cls}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {answered && (
        <p className="mt-2 text-sm text-muted">
          {picked === item.correct
            ? `✓ ${item.fb}`
            : `Not quite — the highlighted answer is right. ${item.fb}`}
        </p>
      )}
    </div>
  );
}

export default function Quiz({ items }: { items: QuizItem[] }) {
  return (
    <div>
      {items.map((item, i) => (
        <Question key={i} item={item} index={i} />
      ))}
    </div>
  );
}
