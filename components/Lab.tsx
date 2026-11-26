"use client";

// The steer-live lab (lib/lab) as a React component: it fills its box, at any size, inside a board that zooms it or a page of its
// own. Several can be mounted at once; only those `active` run, make model calls and make sound, and the others keep what they
// show until they run again.

import "@fontsource-variable/jetbrains-mono/wght.css";
import "@/lib/lab/lab.css";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { createLab, type Lab as LabCore, type LabOptions } from "@/lib/lab/lab";
import type { LabClip } from "@/lib/lab/story/prompt";

/** What a host can read from a lab: its text up to the knob, the text `onText` gives as it changes. React clears the ref as
    the lab unmounts, so read it before then (or keep what onText last gave). */
export type LabHandle = { text(): string };

export function Lab({
  start,
  sources,
  clips,
  onClipSteer,
  resume,
  active = true,
  onText,
  onEvent,
  onEscape,
  onState,
  completeUrl,
  className,
  ref,
}: Omit<LabOptions, "start" | "clips"> & {
  start: string; // read once, as the lab mounts (as are sources, resume and completeUrl): give it a new key to start over
  clips?: LabClip[]; // the clips the dial offers, reached through the "Clips" gateway: read live, so one clipped or re-steered while open reaches the dial
  active?: boolean; // false pauses it: no model calls, no timers that make them, no sound
  className?: string;
  ref?: Ref<LabHandle>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const lab = useRef<LabCore | null>(null);
  const first = useRef({ start, sources, resume, completeUrl });
  const latest = useRef({ onText, onEvent, onEscape, onState, onClipSteer, clips });
  useEffect(() => {
    latest.current = { onText, onEvent, onEscape, onState, onClipSteer, clips };
  });

  useEffect(() => {
    const made = createLab(root.current!, {
      ...first.current,
      clips: () => latest.current.clips ?? [],
      onClipSteer: (id, steer) => latest.current.onClipSteer?.(id, steer),
      onText: (text) => latest.current.onText?.(text),
      onEvent: (event, envelope) => latest.current.onEvent?.(event, envelope),
      onEscape: () => latest.current.onEscape?.(),
      onState: (state) => latest.current.onState?.(state),
    });
    lab.current = made;
    return () => made.destroy();
  }, []);

  useEffect(() => {
    if (active) lab.current?.resume();
    else lab.current?.pause();
  }, [active]);

  // The note's clips, which the lab keeps to, can change while it is open (a passage clipped or taken out): push the new list
  // in. The lab ignores a list equal to the one in force, so the run as the lab mounts (the same sources it was made with) is a
  // no-op. Compared by value through the key, as the array is a fresh one each render.
  const sourcesKey = JSON.stringify(sources ?? []);
  useEffect(() => {
    lab.current?.setSources(sources ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sources compared by value via sourcesKey
  }, [sourcesKey]);

  useImperativeHandle(ref, () => ({ text: () => lab.current?.text() ?? first.current.start }), []);

  return <div ref={root} className={className} />;
}
