"use client";

// A note's text (NoteView in shapes.tsx): a TipTap editor over the note's one document (lib/note.ts),
// the learner's writing with the clips where they were dropped, a heading, and what the model and the
// lab wrote, tinted by who wrote it. Typing goes into the note outside the board's undo (the editor
// keeps its own); a change from outside (a clip dropped in, a starting point, the lab writing) comes in
// as a new document, and the editor takes it without counting it as the learner's.

import { Extension, Mark, Node, mergeAttributes, type Editor as TipTap, type JSONContent } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, type MouseEvent } from "react";
import { AUTHOR, CLIP, DEFAULT_WEIGHT, TUTOR_MIME, clipFromTutor, type Clip, type DocNode, type TutorBit } from "@/lib/note";

/** Set on a transaction that brings in the note as it changed outside the editor. */
const EXTERNAL = "noteExternal";

const CLIP_FIELDS: (keyof Clip)[] = ["id", "quote", "where", "around", "heading", "card", "page", "relX", "relY", "thread", "weight", "use"];

/** A clip: a passage from the board, inline in the text where it was dropped. Its ↗ goes to where it
    came from, its ✕ takes it out (data-act, answered by NoteDoc's onAct). */
const ClipNode = Node.create({
  name: CLIP,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return Object.fromEntries(CLIP_FIELDS.map((k) => [k, { default: k === "relX" || k === "relY" ? 0 : k === "weight" ? DEFAULT_WEIGHT : "", rendered: false }]));
  },
  parseHTML() {
    return []; // a pasted clip comes in as its words: what finds its passage again isn't in the HTML
  },
  renderHTML({ node }) {
    const c = node.attrs as Clip;
    return [
      "span",
      { class: "cv-clip", "data-clip": c.id, contenteditable: "false" },
      ["span", { class: "cv-clip-q" }, c.quote],
      [
        "span",
        { class: "cv-clip-at" },
        ["span", { class: "cv-clip-where" }, c.where],
        ["button", { type: "button", "data-act": "go", title: "Go to where it came from", "aria-label": "Go to where this clip came from" }, "↗"],
        ["button", { type: "button", "data-act": "x", title: "Remove this clip", "aria-label": "Remove this clip" }, "✕"],
      ],
    ];
  },
  renderText({ node }) {
    return `“${(node.attrs as Clip).quote}”`;
  },
});

/** Who wrote a run of text, when it wasn't the learner: the model (a starting point) or the lab. */
const AuthorMark = Mark.create({
  name: AUTHOR,
  inclusive: false,
  addAttributes() {
    return {
      by: { default: "model", parseHTML: (el) => el.getAttribute("data-by"), renderHTML: (a) => ({ "data-by": a.by }) },
      run: { default: null, rendered: false }, // which lab session wrote it (lib/note.ts dropRun)
    };
  },
  parseHTML() {
    return [{ tag: "span[data-by]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "cv-by" }, HTMLAttributes), 0];
  },
});

/** What the learner puts in is theirs: text typed (or pasted) inside the model's or the lab's words
    loses their mark. Not a change from outside, nor an undo (which puts back what was there). */
const MineWhenTyped = Extension.create({
  name: "mineWhenTyped",
  addProseMirrorPlugins() {
    const author = () => this.editor.schema.marks[AUTHOR];
    return [
      new Plugin({
        key: new PluginKey("mineWhenTyped"),
        appendTransaction: (trs, _old, state) => {
          const added: [number, number][] = [];
          trs.forEach((tr, ti) => {
            if (!tr.docChanged || tr.getMeta(EXTERNAL) || tr.getMeta("history$")) return;
            const maps = tr.mapping.maps;
            maps.forEach((map, mi) =>
              map.forEach((_a, _b, from, to) => {
                // where the new content ends up once the rest of this and the later transactions apply
                let f = from;
                let t = to;
                for (let j = mi + 1; j < maps.length; j++) {
                  f = maps[j].map(f, 1);
                  t = maps[j].map(t, -1);
                }
                for (let k = ti + 1; k < trs.length; k++) {
                  f = trs[k].mapping.map(f, 1);
                  t = trs[k].mapping.map(t, -1);
                }
                if (t > f) added.push([f, t]);
              }),
            );
          });
          if (!added.length) return null;
          const tr = state.tr;
          for (const [f, t] of added) tr.removeMark(f, t, author());
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});

export function NoteDoc({
  value,
  onChange,
  onEditor,
  onAct,
  placeholder,
}: {
  value: DocNode;
  onChange: (doc: DocNode) => void; // the learner changed it
  onEditor?: (editor: TipTap | null) => void; // the editor once made, and null as it goes
  onAct: (act: "go" | "x", clip: string) => void; // ↗ or ✕ on a clip
  placeholder: string;
}) {
  const last = useRef(JSON.stringify(value)); // the document as the editor last gave or took it
  const latest = useRef({ onChange, onAct, onEditor });
  const plain = useRef(false); // this paste is Ctrl + Shift + V: words only
  useEffect(() => {
    latest.current = { onChange, onAct, onEditor };
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: false, codeBlock: false, horizontalRule: false, heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      ClipNode,
      AuthorMark,
      MineWhenTyped,
    ],
    content: value as JSONContent,
    editorProps: {
      attributes: { class: "cv-note-doc", "aria-label": "Your note" },
      handleKeyDown: (_view, e) => {
        plain.current = e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v";
        return false;
      },
      // Words copied from a tutor answer come in as a clip of that answer, where the caret is; with
      // Ctrl + Shift + V, as plain words.
      handlePaste: (view, e) => {
        const raw = plain.current ? "" : e.clipboardData?.getData(TUTOR_MIME);
        plain.current = false;
        if (!raw) return false;
        let bit: TutorBit;
        try {
          bit = JSON.parse(raw);
        } catch {
          return false;
        }
        const clip = clipFromTutor(bit, Math.random().toString(36).slice(2, 10));
        view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes[CLIP].create(clip)).scrollIntoView());
        return true;
      },
    },
    onUpdate: ({ editor: e, transaction }) => {
      if (transaction.getMeta(EXTERNAL)) return;
      const doc = e.getJSON() as DocNode;
      last.current = JSON.stringify(doc);
      latest.current.onChange(doc);
    },
  });

  // The note changed from outside: the editor takes it, outside its own undo and not as the learner's.
  useEffect(() => {
    if (!editor) return;
    const s = JSON.stringify(value);
    if (s === last.current) return;
    last.current = s;
    editor.chain().setMeta(EXTERNAL, true).setMeta("addToHistory", false).setContent(value as JSONContent, { emitUpdate: false }).run();
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    latest.current.onEditor?.(editor);
    return () => latest.current.onEditor?.(null);
  }, [editor]);

  /** A press on a clip's ↗ or ✕ is the button's, not the text's: no caret, no selection. */
  const act = (e: MouseEvent, run: boolean) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    const id = b?.closest<HTMLElement>("[data-clip]")?.dataset.clip;
    if (!b || !id) return;
    e.preventDefault();
    e.stopPropagation();
    if (run) latest.current.onAct(b.dataset.act as "go" | "x", id);
  };
  return (
    <div className="cv-note-text" onMouseDownCapture={(e) => act(e, false)} onClickCapture={(e) => act(e, true)}>
      <EditorContent editor={editor} />
    </div>
  );
}
