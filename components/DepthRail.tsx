"use client";

// The tutor window's depth handle on the canvas (TutorPanel with `hud`): a knob on a rail with a stop per depth, Simple / Mid /
// Deep. Its looks are in app/reader.css (.th-rail).

import { useRef, useState } from "react";
import type { Sounds } from "@/lib/lab/text/sound/sounds";
import { LEVEL_LABEL, type TutorLevel } from "@/lib/tutor";

/** What the canvas hands the tutor's window for its HUD: the definition showing for the highlight being asked about, and the
    HUD's sounds (components/canvas/lessonGloss.ts). */
export type TutorHud = { gloss: () => string | undefined; sounds: () => Sounds | undefined };

const LEVELS = Object.keys(LEVEL_LABEL) as TutorLevel[];

/** The tutor's depth handle: Simple / Mid / Deep. have: the depths already read, marked with a dot. */
export function DepthRail({ level, have, onChange }: { level: TutorLevel; have: TutorLevel[]; onChange: (level: TutorLevel) => void }) {
  return (
    <StopRail
      stops={LEVELS.map((l) => LEVEL_LABEL[l])}
      at={LEVELS.indexOf(level)}
      have={LEVELS.flatMap((l, i) => (have.includes(l) ? [i] : []))}
      onChange={(i) => onChange(LEVELS[i])}
      label="How deep the explanation goes"
    />
  );
}

/** A knob on a rail with a stop per choice. Drag it, press a stop, or use ← / →. Nothing happens until it lands on a stop (letting
    go mid-rail takes the nearest). have: the stops already there to read, marked with a dot. Also a card's depth. */
export function StopRail({ stops, at, have, onChange, label }: { stops: string[]; at: number; have: number[]; onChange: (i: number) => void; label: string }) {
  const rail = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null); // 0 to 1 along the rail, while dragged
  const last = stops.length - 1;
  const posOf = (e: { clientX: number }) => {
    const r = rail.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const near = (pos: number) => Math.round(pos * last);
  const land = (i: number) => i !== at && i >= 0 && i <= last && onChange(i);
  const over = drag === null ? at : near(drag);
  return (
    <div
      ref={rail}
      className="th-rail"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={at}
      aria-valuetext={stops[at]}
      data-drag={drag === null ? undefined : ""}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          land(at + (e.key === "ArrowLeft" ? -1 : 1));
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(posOf(e));
      }}
      onPointerMove={(e) => drag !== null && setDrag(posOf(e))}
      onPointerUp={(e) => {
        if (drag === null) return;
        setDrag(null);
        land(near(posOf(e)));
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {stops.map((name, i) => (
        <span key={name} className="th-stop" style={{ left: `${(i / last) * 100}%` }} data-on={i === over ? "" : undefined} data-have={have.includes(i) ? "" : undefined}>
          {name}
        </span>
      ))}
      <i className="th-knob" style={{ left: `${(drag ?? at / last) * 100}%` }} />
    </div>
  );
}
