// The text of a selection in the page, a card or the tutor: whole formulas, as $TeX$. Shared by the
// canvas (components/LessonCanvas.tsx) and the tutor margin (components/TutorPanel.tsx).

/** Grow a range so it never cuts through a typeset formula. */
export function wholeMath(range: Range): Range {
  const r = range.cloneRange();
  const mathOf = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest(".katex");
  const a = mathOf(r.startContainer);
  const b = mathOf(r.endContainer);
  if (a) r.setStartBefore(a);
  if (b) r.setEndAfter(b);
  return r;
}

/** Elements whose text stands apart from what is around it. */
const BLOCKS = "address,article,aside,blockquote,br,dd,details,div,dl,dt,figcaption,figure,footer,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,summary,table,td,th,tr,ul";
/** The text of a range with each formula as its $TeX$ (KaTeX keeps the source in an annotation),
    instead of the hidden MathML and the drawn glyphs run together. */
export function rangeText(range: Range): string {
  const frag = range.cloneContents();
  for (const k of Array.from(frag.querySelectorAll(".katex"))) {
    const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    const shown = k.querySelector(".katex-html")?.textContent ?? k.textContent ?? "";
    k.replaceWith(k.ownerDocument.createTextNode(tex ? ` $${tex}$ ` : shown));
  }
  // a space after each block, so a highlight across a heading and its paragraph reads "UI Each", not "UIEach"
  for (const b of Array.from(frag.querySelectorAll(BLOCKS))) b.after(" ");
  return (frag.textContent ?? "").replace(/\s+/g, " ").trim();
}
/** An element's text, maths as $TeX$. */
export function elText(el: Element): string {
  const r = el.ownerDocument.createRange();
  r.selectNodeContents(el);
  return rangeText(r);
}
