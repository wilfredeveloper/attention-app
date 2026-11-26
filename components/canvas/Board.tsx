"use client";

// The tldraw board itself, kept apart so the canvas around it can re-render (a card streaming,
// a highlight) without re-rendering the editor. Loaded on the client only (see LessonCanvas).

import { memo, useMemo } from "react";
import { DefaultStylePanel, Tldraw, useEditor, useValue, type Editor, type TLComponents, type TLUiOverrides, type TLUiStylePanelProps } from "tldraw";
import "tldraw/tldraw.css";
import { HostCtx, noteVisibility, shapeUtils, type CanvasHost } from "@/components/canvas/shapes";

/** The desk: a dot grid that moves and scales with the board (a coarser one when zoomed far out). */
function Desk() {
  const editor = useEditor();
  const { x, y, z } = useValue("camera", () => editor.getCamera(), [editor]);
  let step = 24;
  while (step * z < 14) step *= 4;
  const size = step * z;
  return <div className="tl-background cv-desk" style={{ backgroundSize: `${size}px ${size}px`, backgroundPosition: `${x * z}px ${y * z}px` }} />;
}

/** tldraw's colour and stroke panel, only while it has something to style: a drawing tool is picked, or a drawing is
    selected. Reading, it stays out of the way. */
const DRAWN = new Set(["draw", "geo", "arrow", "line", "text", "highlight", "frame"]);
function QuietStylePanel(props: TLUiStylePanelProps) {
  const editor = useEditor();
  const show = useValue(
    "style panel",
    () => !["select", "hand", "eraser", "laser", "zoom"].includes(editor.getCurrentToolId()) || editor.getSelectedShapes().some((s) => DRAWN.has(s.type)),
    [editor],
  );
  return show ? <DefaultStylePanel {...props} /> : null;
}

// One page per lesson: the board's pages menu is hidden and new pages are refused. A double-click on
// an empty spot makes a note (LessonCanvas), not tldraw's text box. The colour panel shows only while drawing, and the
// quick-action buttons (undo, redo, delete, duplicate: Ctrl+Z and the keys still work) are gone.
const components: TLComponents = { PageMenu: null, Background: Desk, StylePanel: QuietStylePanel, QuickActions: null, ActionsMenu: null };
const options = { maxPages: 1, createTextOnCanvasDoubleClick: false };

function Board({ host, onMount }: { host: CanvasHost; onMount: (editor: Editor) => void | (() => void) }) {
  // N and the toolbar's note make the canvas's own note, in place of tldraw's sticky note.
  const overrides = useMemo(
    (): TLUiOverrides => ({ tools: (_editor, tools) => ({ ...tools, note: { ...tools.note, onSelect: (source) => host.newNote(source === "kbd"), onDragStart: undefined } }) }),
    [host],
  );
  return (
    <HostCtx.Provider value={host}>
      <Tldraw
        shapeUtils={shapeUtils}
        components={components}
        options={options}
        overrides={overrides}
        getShapeVisibility={noteVisibility}
        onMount={onMount}
        // Free in development. A production build needs a key (tldraw.dev/pricing), or the board stops rendering.
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
      />
    </HostCtx.Provider>
  );
}

export default memo(Board);
