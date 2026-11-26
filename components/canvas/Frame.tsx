"use client";

// One frame for everything on the board. Cards, notes, linked pages and the lab
// wear the same title bar, with the same controls in the same places, and fold to the same chip:
//
//   [kind] title ……………… [extra] [Pin | Dock] [–] [✕]
//
//   Pin   keeps it on the screen where it is as the board moves (a note docks at the screen's right edge instead)
//   –     folds it to a chip; the chip's ⤢ opens it again
//   ✕     closes it
//
// Double-click the bar to bring it into view, fitted to the screen (Esc goes back). Whatever you touch comes to the front.
// The looks are in app/reader.css (.fr-*).

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { TLShapeId } from "tldraw";

export type FrameKind = "card" | "note" | "page" | "lab" | "video";
const KIND: Record<FrameKind, string> = { card: "Explore", note: "Note", page: "Linked", lab: "Steer live", video: "Watch" };

/** What the canvas does for a frame. The shape utils call `focus` from tldraw's double-click on a shape (its bar). */
export const frameHooks: { focus?: (id: TLShapeId) => void } = {};

type Common = {
  kind: FrameKind;
  title: ReactNode;
  label?: string; // the kind's word, when it isn't the usual one ("Web" for a page opened from a pasted link)
  mine: (e: ReactPointerEvent) => void; // marks a press as the frame's own, so the board doesn't drag it
  live: boolean; // the board is idle: its parts take the pointer
  onClose?: () => void;
  closeLabel: string;
};

export function FrameBar({
  kind, title, label, mine, live, onClose, closeLabel, extra, pinned, dock, onPin, onFold,
}: Common & { extra?: ReactNode; pinned?: boolean; dock?: boolean; onPin?: () => void; onFold?: () => void }) {
  const on = live ? "all" : "none";
  return (
    <header className={`fr-bar fr-${kind}`} title="Drag to move · double-click to bring it into view">
      <span className="fr-kind">{label ?? KIND[kind]}</span>
      <span className="fr-title">{title}</span>
      {extra}
      {onPin && (
        <button
          className={`fr-btn fr-pin${pinned ? " on" : ""}`}
          style={{ pointerEvents: on }}
          onPointerDown={mine}
          onClick={onPin}
          aria-pressed={!!pinned}
          title={dock ? (pinned ? "Docked at the screen's edge: → Note goes here. Click to put it back." : "Dock it at the screen's edge, where → Note goes") : pinned ? "Pinned to the screen. Click to let it go." : "Pin it to the screen as the board moves"}
        >
          {dock ? (pinned ? "Docked" : "Dock") : pinned ? "Pinned" : "Pin"}
        </button>
      )}
      {onFold && (
        <button className="fr-btn fr-fold" style={{ pointerEvents: on }} onPointerDown={mine} onClick={onFold} aria-label="Fold to a chip" title="Fold to a chip">
          –
        </button>
      )}
      {onClose && (
        <button className="fr-btn fr-x" style={{ pointerEvents: on }} onPointerDown={mine} onClick={onClose} aria-label={closeLabel} title={closeLabel}>
          ✕
        </button>
      )}
    </header>
  );
}

/** A folded frame: drag it anywhere; ⤢ opens it again. `badge`: a word on the chip (how many clips a folded note holds). */
export function FrameChip({ kind, title, label, mine, live, onClose, closeLabel, onOpen, badge }: Common & { onOpen: () => void; badge?: ReactNode }) {
  const on = live ? "all" : "none";
  return (
    <div className={`fr-chip fr-${kind}`} title="Drag to move · ⤢ to open">
      <button className="fr-btn fr-open" style={{ pointerEvents: on }} onPointerDown={mine} onClick={onOpen} aria-label="Open it again" title="Open">
        ⤢
      </button>
      <span className="fr-kind">{label ?? KIND[kind]}</span>
      <span className="fr-title">{title}</span>
      {badge && <span className="fr-badge">{badge}</span>}
      {onClose && (
        <button className="fr-btn fr-x" style={{ pointerEvents: on }} onPointerDown={mine} onClick={onClose} aria-label={closeLabel} title={closeLabel}>
          ✕
        </button>
      )}
    </div>
  );
}
