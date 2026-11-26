// Run with: pnpm test   (Node strips the TypeScript types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WEIGHT, OPENING_SYSTEM, appendText, clipFromTutor, clipWeightOf, docBody, docClips, docPlain, docTopic, dropAuthored, dropEcho, dropRun, emptyDoc, hasAuthored, hasOldNotes,
  insertClip, isPin, isSavedLab, labRest, labResume, labStart, noteFromOld, openingMessages, parseOpening, pinOf, pinnedAt, readOpening, removeClip, sameClip, setClipSteer, splitStart, startDoc, withStart,
} from "./note.ts";

const clip = (over) => ({
  id: "c1", quote: "a layer is a table", where: "Weights", around: "In short, a layer is a table of weights.", heading: "Weights",
  card: "", page: "", relX: 10, relY: 200, ...over,
});
const t = (text, by, run) => (by ? { type: "text", text, marks: [{ type: "author", attrs: { by, run: run ?? null } }] } : { type: "text", text });
const p = (...content) => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const h = (...content) => ({ type: "heading", attrs: { level: 1 }, content });
const c = (over) => ({ type: "clip", attrs: clip(over) });
const doc = (...content) => ({ type: "doc", content });

test("the same passage from the same place is one clip, however it was spaced or cased", () => {
  const one = insertClip(emptyDoc(), clip());
  assert.equal(insertClip(one, clip({ id: "c2", quote: "  A layer is\na table " })), one);
  assert.equal(sameClip(clip(), clip({ relY: 900 })), true);
});

test("the same words from another page or card, or other words, are new clips", () => {
  const one = insertClip(emptyDoc(), clip());
  assert.equal(docClips(insertClip(one, clip({ id: "c2", page: "p1" }))).length, 2);
  assert.equal(docClips(insertClip(one, clip({ id: "c2", card: "k1" }))).length, 2);
  assert.deepEqual(docClips(insertClip(one, clip({ id: "c2", quote: "a table of weights" }))).map((x) => x.id), ["c1", "c2"]);
});

test("the same words from a tutor answer are a clip of their own, and one per thread", () => {
  const one = insertClip(emptyDoc(), clip());
  const two = insertClip(one, clip({ id: "c2", thread: "t1" }));
  assert.equal(docClips(two).length, 2);
  assert.equal(insertClip(two, clip({ id: "c3", thread: "t1" })), two);
  assert.equal(docClips(insertClip(two, clip({ id: "c3", thread: "t2" }))).length, 3);
});

test("a tutor passage becomes a clip labelled by what was asked, the answer around it", () => {
  const asked = "Chuanqi Sun's MIT Media Lab thesis proposal, Hold That Thought, starts from a mismatch.";
  const k = clipFromTutor({ quote: " handles are\nobjects ", answer: "In short, handles are objects you grab.", asked, heading: "The anchor", thread: "t1" }, "k1");
  assert.deepEqual(k, {
    id: "k1", quote: "handles are objects", where: "Tutor on “Chuanqi Sun's MIT Media Lab thesis proposal, Ho…”", around: "In short, handles are objects you grab.",
    heading: "The anchor", card: "", page: "", relX: 0, relY: 0, thread: "t1",
  });
  assert.equal(clipFromTutor({ quote: "x", answer: "", asked: "  What is a dial? ", heading: "", thread: "t" }, "k").where, "Tutor on “What is a dial?”");
});

test("a clip's weight reads moderate until it is set, and setClipSteer changes just that clip", () => {
  const two = insertClip(insertClip(emptyDoc(), clip()), clip({ id: "c2", quote: "another passage" }));
  assert.equal(clipWeightOf(docClips(two)[0]), DEFAULT_WEIGHT);
  assert.equal(DEFAULT_WEIGHT, "moderate");
  const after = setClipSteer(two, "c1", { weight: "strong" });
  assert.equal(clipWeightOf(docClips(after)[0]), "strong");
  assert.equal(clipWeightOf(docClips(after)[1]), "moderate"); // the other clip is untouched
  // an id that isn't there leaves the document unchanged (same reference)
  assert.equal(setClipSteer(after, "nope", { weight: "ignore" }), after);
  // setting the same steer again is a no-op (same reference), so a drag that keeps the same option rewrites nothing
  assert.equal(setClipSteer(after, "c1", { weight: "strong" }), after);
});

test("setClipSteer carries a picked use and clears the weight; a weight later clears the use", () => {
  const one = insertClip(emptyDoc(), clip({ weight: "strong" }));
  const used = setClipSteer(one, "c1", { use: "make it the running example" });
  assert.equal(docClips(used)[0].use, "make it the running example");
  assert.equal(docClips(used)[0].weight, undefined); // the stale weight is gone, so use wins in the prompt
  // a blank use is treated as none (no steer written)
  assert.equal(docClips(setClipSteer(used, "c1", { use: "   " }))[0].use, undefined);
  // going back to a weight clears the use
  const reweighed = setClipSteer(used, "c1", { weight: "slight" });
  assert.equal(reweighed !== used, true);
  assert.equal(docClips(reweighed)[0].use, undefined);
  assert.equal(docClips(reweighed)[0].weight, "slight");
});

test("a clip goes where it was dropped: mid-sentence, under a heading, or at the end", () => {
  const d = doc(h(t("Tables")), p(t("A layer multiplies its input.")));
  // offset 8 in "A layer multiplies…" is just after "A layer "
  assert.deepEqual(insertClip(d, clip(), { block: 1, offset: 8 }).content[1], p(t("A layer "), c(), t("multiplies its input.")));
  assert.deepEqual(insertClip(d, clip(), { block: 1, offset: 0 }).content[1], p(c(), t("A layer multiplies its input.")));
  assert.deepEqual(insertClip(d, clip(), { block: 1, offset: 29 }).content[1], p(t("A layer multiplies its input."), c()));
  assert.deepEqual(insertClip(d, clip(), { block: 0, offset: 3 }).content.map((b) => b.type), ["heading", "paragraph", "paragraph"]);
  assert.deepEqual(insertClip(d, clip(), { block: 0, offset: 3 }).content[1], p(c()));
  assert.deepEqual(insertClip(d, clip()).content.slice(-2), [p(c()), p()]); // no place: the end, with a line after it to write on
  assert.deepEqual(insertClip(emptyDoc(), clip()), doc(p(c()), p())); // an empty last paragraph is taken, and a new one follows
  // an atom counts one: after the first clip, before " and"
  const two = insertClip(doc(p(c(), t(" and more"))), clip({ id: "c2", quote: "other" }), { block: 0, offset: 1 });
  assert.deepEqual(two.content[0].content.map((n) => n.attrs?.id ?? n.text), ["c1", "c2", " and more"]);
});

test("a clip in the learner's sentence is read as a quotation; one on its own line is a source only", () => {
  const d = doc(h(t("Tables")), p(t("As Sun puts it,"), c(), t("handles move.")), p(c({ id: "c2", quote: "alone" })), p(t("Mine.")));
  assert.equal(docTopic(d), "Tables");
  assert.equal(docBody(d), "As Sun puts it, “a layer is a table” handles move.\n\nMine.");
  assert.equal(docPlain(d), "Tables\n\nAs Sun puts it, “a layer is a table” handles move.\n\n“alone”\n\nMine.");
  assert.deepEqual(docClips(d).map((x) => x.id), ["c1", "c2"]);
  assert.equal(docTopic(doc(p(t("No heading")))), "");
});

test("text added by the model or the lab carries on from the learner's last word, then makes paragraphs", () => {
  const d = doc(p(t("A layer multiplies")));
  assert.deepEqual(appendText(d, "its input by a table.", "model"), doc(p(t("A layer multiplies"), t(" its input by a table.", "model"))));
  assert.deepEqual(appendText(d, ", and adds.", "model").content[0].content[1].text, ", and adds."); // none before punctuation
  assert.deepEqual(appendText(doc(p(t("Ends in a space "))), "then.", "lab").content[0].content[1].text, "then.");
  const two = appendText(d, "on.\n\nA second paragraph.", "lab", "r1");
  assert.deepEqual(two.content[1], p(t("A second paragraph.", "lab", "r1")));
  assert.deepEqual(appendText(doc(p(c())), "After a clip.", "lab").content[1], p(t("After a clip.", "lab"))); // a clip alone isn't carried on
  assert.deepEqual(appendText(emptyDoc(), "Fresh.", "model"), doc(p(t("Fresh.", "model"))));
  assert.equal(appendText(d, "  \n ", "lab"), d);
});

test("a starting point: the model's heading when there is none, and its bridge after the learner's words", () => {
  const d = withStart(doc(p(t("Mine"))), "Tables", "and theirs.");
  assert.deepEqual(d, doc(h(t("Tables", "model")), p(t("Mine"), t(" and theirs.", "model"))));
  // the learner's own heading stays
  assert.equal(docTopic(withStart(doc(h(t("My title")), p(t("x"))), "Theirs", "y")), "My title");
  assert.equal(hasAuthored(d, ["model"]), true);
  assert.equal(hasAuthored(doc(p(t("Mine"))), ["model", "lab"]), false);
});

test("starting over drops what the model and the lab wrote, keeping the learner's words and blank lines", () => {
  const d = doc(h(t("Tables", "model")), p(t("Mine"), t(" and theirs.", "model")), p(), p(t("The lab went on.", "lab", "r1")));
  assert.deepEqual(dropAuthored(d, ["model", "lab"]), doc(p(t("Mine")), p()));
  assert.deepEqual(dropRun(d, "r1"), doc(h(t("Tables", "model")), p(t("Mine"), t(" and theirs.", "model")), p()));
  assert.deepEqual(dropAuthored(doc(p(t("x", "model"))), ["model"]), emptyDoc()); // never no paragraph at all
});

test("a lab session rewrites only its own text as it goes", () => {
  const base = doc(h(t("T")), p(t("Mine.")), p(t("Last time.", "lab", "r0")));
  const first = appendText(dropRun(base, "r1"), "Now one", "lab", "r1");
  const later = appendText(dropRun(first, "r1"), "Now one, then two.", "lab", "r1");
  assert.deepEqual(later, doc(h(t("T")), p(t("Mine.")), p(t("Last time.", "lab", "r0"), t(" Now one, then two.", "lab", "r1"))));
});

test("a note always ends where the learner can write: after a last line of clips alone, an empty paragraph", () => {
  const ends = (d) => d.content.at(-1);
  assert.deepEqual(ends(insertClip(doc(p(t("Mine."))), clip())), p());
  assert.deepEqual(ends(removeClip(doc(p(c()), p(c({ id: "c2", quote: "q" }))), "c2")), p()); // the clip left last gets room after it
  assert.deepEqual(ends(insertClip(doc(p(t("Mine "))), clip(), { block: 0, offset: 5 })), p(t("Mine "), c())); // beside its text: room already
  assert.deepEqual(appendText(insertClip(emptyDoc(), clip()), "Then text.", "lab").content, [p(c()), p(t("Then text.", "lab"))]); // the empty line is written on
});

test("removing a clip takes the paragraph it stood alone in", () => {
  const d = doc(p(c()), p(t("Before "), c({ id: "c2", quote: "q" }), t(" after")));
  assert.deepEqual(removeClip(d, "c1"), doc(p(t("Before "), c({ id: "c2", quote: "q" }), t(" after"))));
  assert.deepEqual(removeClip(d, "c2").content[1], p(t("Before "), t(" after")));
  assert.deepEqual(removeClip(doc(p(c())), "c1"), emptyDoc());
});

test("a new note: the learner's heading, then a paragraph per clip", () => {
  assert.deepEqual(startDoc("Softmax", [clip()]), doc(h(t("Softmax")), p(c()), p()));
  assert.deepEqual(startDoc(" ", [clip()]), doc(p(c()), p()));
});

test("an old note becomes one document, nothing lost", () => {
  const old = { w: 340, h: 300, sized: false, draft: "", clips: [clip()], topic: "", text: "", made: null, createdAt: 5 };
  assert.deepEqual(noteFromOld(old), { w: 340, h: 300, sized: false, createdAt: 5, doc: doc(p(c()), p()) });
  assert.deepEqual(noteFromOld({ ...old, clips: [], draft: "One\n\nTwo" }).doc, doc(p(t("One")), p(t("Two"))));
  // a starting point still as made: the model's heading and bridge, the learner's draft, then the lab
  const made = { ...old, draft: "Mine", topic: "Tables", text: "Mine and theirs.", made: { topic: "Tables", draft: "Mine", bridge: "and theirs." }, ran: "The lab went on." };
  assert.deepEqual(noteFromOld(made).doc, doc(h(t("Tables", "model")), p(c()), p(t("Mine"), t(" and theirs.", "model"), t(" The lab went on.", "lab"))));
  // edited since: the heading and the text are the learner's; a draft changed since the start is kept too
  const edited = { ...made, topic: "My tables", text: "Mine and my own.", draft: "Mine, rewritten", ran: "" };
  assert.deepEqual(noteFromOld(edited).doc, doc(h(t("My tables")), p(c()), p(t("Mine, rewritten")), p(t("Mine and my own."))));
  // the screenshot's note: three clips, an empty draft, a starting point from the clips alone
  const fromClips = { ...old, clips: [clip(), clip({ id: "c2", quote: "q" })], topic: "Loop", text: "The loop has four steps.", made: { topic: "Loop", draft: "", bridge: "The loop has four steps." } };
  assert.deepEqual(noteFromOld(fromClips).doc, doc(h(t("Loop", "model")), p(c()), p(c({ id: "c2", quote: "q" })), p(t("The loop has four steps.", "model"))));
});

test("a board with a note from before the document is one to convert", () => {
  const board = (props) => ({ store: { "shape:n": { typeName: "shape", type: "lesson-note", props }, "page:p": { typeName: "page" } } });
  assert.equal(hasOldNotes(board({ draft: "", clips: [] })), true);
  assert.equal(hasOldNotes(board({ doc: emptyDoc() })), false);
  assert.equal(hasOldNotes(undefined), false);
});

test("the starting text carries on from the draft's last word", () => {
  assert.deepEqual(splitStart("A layer multiplies", "its input by a table."), ["A layer multiplies", " its input by a table."]);
  assert.deepEqual(splitStart("It stops here  \n", ", and then it goes on."), ["It stops here", ", and then it goes on."]);
  assert.deepEqual(splitStart("", "  Two opening sentences. "), ["", "Two opening sentences."]);
});

test("what a lab wrote is its text past the note's heading and starting text, counted by words", () => {
  const prefix = "Why one head can't hold two things: So is softmax the reason";
  assert.equal(labRest(`${prefix} giving more to one word takes from the rest.`, prefix), "giving more to one word takes from the rest.");
  // the lab keeps the start's line breaks; the words are what count
  assert.equal(labRest("Why one head can't hold two things:\nSo is softmax the reason  it adds to one.", prefix), "it adds to one.");
  assert.equal(labRest(prefix, prefix), "");
  assert.equal(labRest("Heading: and on", ""), "Heading: and on");
});

test("the opening request: the rules, then LESSON, CLIPS and DRAFT", () => {
  const [system, user] = openingMessages({ course: "Inside small models", lesson: "A layer", clips: [clip()], draft: "So a layer" });
  assert.equal(system.role, "system");
  assert.equal(system.content, OPENING_SYSTEM);
  assert.match(system.content, /Never rewrite/);
  assert.equal(user.role, "user");
  assert.equal(
    user.content,
    'LESSON\nInside small models · A layer\n\nCLIPS\n1. "a layer is a table"\n   From: Weights\n   Around it: In short, a layer is a table of weights.\n\nDRAFT\nSo a layer',
  );
  assert.match(openingMessages({ course: "", lesson: "", clips: [clip()], draft: "" })[1].content, /DRAFT\n\(empty\)$/);
});

test("a request body is read with its strings capped; one with nothing to go on is refused", () => {
  const o = readOpening({ course: "C", lesson: "L", draft: " mine\n\nmore ", clips: [{ quote: " q ", where: "w", around: "x".repeat(5000) }, { quote: "" }, null] });
  assert.equal(o.draft, "mine\n\nmore");
  assert.equal(o.clips.length, 1);
  assert.equal(o.clips[0].quote, "q");
  assert.equal(o.clips[0].around.length, 1200);
  assert.equal(readOpening({ clips: [], draft: "  " }), null);
  assert.equal(readOpening({ draft: "x" }), null);
  assert.equal(readOpening(null), null);
});

test("the model's reply: TOPIC and BRIDGE, without the trimmings", () => {
  assert.deepEqual(parseOpening("TOPIC: Why layers need a bend.\nBRIDGE: and that is why a bend\nmatters."), {
    topic: "Why layers need a bend",
    bridge: "and that is why a bend matters.",
  });
  assert.deepEqual(parseOpening('**TOPIC:** "Tables of weights"\n\n**BRIDGE:** It starts here.'), { topic: "Tables of weights", bridge: "It starts here." });
  assert.deepEqual(parseOpening("TOPIC: Why a bend is needed  \nthe two matrices collapse into one."), { topic: "Why a bend is needed", bridge: "the two matrices collapse into one." });
  assert.equal(parseOpening("Sorry, I can't help."), null);
});

test("the opening's labels are read without their colons too, as the model sometimes writes them", () => {
  // both shapes seen from gpt-oss on a note of three clips and no draft (3 replies in 8)
  assert.deepEqual(parseOpening("TOPIC Just-in-time reading interface loop and handles\nBRIDGE The loop has four steps."), {
    topic: "Just-in-time reading interface loop and handles",
    bridge: "The loop has four steps.",
  });
  assert.deepEqual(parseOpening("TOPIC Just-in-time reading with handles\nThe loop has four steps."), {
    topic: "Just-in-time reading with handles",
    bridge: "The loop has four steps.",
  });
  assert.deepEqual(parseOpening("TOPIC - Reading on demand\nBRIDGE — It starts here."), { topic: "Reading on demand", bridge: "It starts here." });
  // without a colon only the capitalised label counts, so a reply that merely starts with the word isn't split
  assert.equal(parseOpening("Topics like this one are hard."), null);
  assert.equal(parseOpening("Topic modelling groups words.\nBridges are built."), null);
});

test("a bridge that repeats the draft, or its last words, loses the repeat", () => {
  const draft = "I think the bend matters because without it";
  assert.equal(dropEcho(draft, "I think the bend matters because without it the two matrices collapse."), "the two matrices collapse.");
  assert.equal(dropEcho(draft, "Because without it, the two matrices collapse."), "the two matrices collapse.");
  assert.equal(dropEcho(draft, "the two matrices collapse into one."), "the two matrices collapse into one.");
  assert.equal(dropEcho(draft, "it collapses."), "it collapses."); // one shared word is not an echo
  assert.equal(dropEcho("Hi", "hi there."), "there.");
  assert.equal(dropEcho("", "Two opening sentences."), "Two opening sentences.");
});

// ---- pinning a note to the screen ----
const cam = (x, y, z) => ({ x, y, z });

test("a pinned note keeps its spot on the screen as the board scrolls", () => {
  const pin = pinOf({ x: 100, y: 300 }, cam(40, -200, 1));
  assert.deepEqual(pin, { x: 140, y: 100, z: 1 }); // screen = (page + camera) * zoom
  assert.deepEqual(pinnedAt(pin, cam(40, -1200, 1)), { x: 100, y: 1300 }); // scrolled down 1000 px: the note went with it
  assert.deepEqual(pinnedAt(pin, cam(40, -200, 1)), { x: 100, y: 300 }); // and back
});

test("zooming keeps the note's corner on the same screen spot", () => {
  const pin = pinOf({ x: 100, y: 300 }, cam(0, 0, 1));
  const c = cam(-50, -100, 1.5);
  const at = pinnedAt(pin, c);
  assert.deepEqual({ x: (at.x + c.x) * c.z, y: (at.y + c.y) * c.z }, { x: 100, y: 300 });
});

test("zooming out below 60% of the zoom it was pinned at unpins it; zooming in never does", () => {
  const pin = pinOf({ x: 0, y: 0 }, cam(0, 0, 1.2));
  assert.notEqual(pinnedAt(pin, cam(0, 0, 0.72)), null); // exactly 60%
  assert.equal(pinnedAt(pin, cam(0, 0, 0.71)), null);
  assert.notEqual(pinnedAt(pin, cam(0, 0, 4)), null);
});

test("only a well-formed pin counts as one (a board's meta is loose JSON)", () => {
  assert.equal(isPin({ x: 1, y: 2, z: 1 }), true);
  for (const v of [undefined, null, {}, { x: 1, y: 2 }, { x: 1, y: 2, z: 0 }, { x: "1", y: 2, z: 1 }]) assert.equal(isPin(v), false, JSON.stringify(v));
});

// ---- the lab, paused on its note ----

const prefixOf = (d) => `${docTopic(d) || "Topic"}: ${docBody(d)}`.trim();

test("a lab opens again as the same run when the note, without its text, starts as it did", () => {
  const d = doc(h(t("Dials")), p(t("A dial sets a value."), t(" The lab went on.", "lab", "r1")));
  const saved = { run: "r1", start: "Dials: A dial sets a value.", state: { text: "Dials: A dial sets a value. The lab went on and on.", words: 9 } };
  assert.deepEqual(labStart(d, saved, prefixOf, "new"), { run: "r1", start: "Dials: A dial sets a value." });
  assert.equal(labResume(saved, "r1", "Dials: A dial sets a value."), saved.state);
});

test("a note changed under its lab starts a new run from all of it, keeping only the dials", () => {
  const d = doc(h(t("Dials")), p(t("A dial sets a value. And mine."), t(" The lab went on.", "lab", "r1")));
  const saved = { run: "r1", start: "Dials: A dial sets a value.", state: { text: "Dials: A dial sets a value. The lab went on.", words: 9, dials: [{ x: 1 }] } };
  const { run, start } = labStart(d, saved, prefixOf, "new");
  assert.deepEqual({ run, start }, { run: "new", start: "Dials: A dial sets a value. And mine. The lab went on." });
  assert.deepEqual(labResume(saved, run, start), { words: 9, dials: [{ x: 1 }] });
});

test("a note never launched opens a new run with nothing to resume", () => {
  const d = doc(h(t("Dials")), p(t("A dial.")));
  assert.deepEqual(labStart(d, undefined, prefixOf, "new"), { run: "new", start: "Dials: A dial." });
  assert.equal(labResume(undefined, "new", "Dials: A dial."), undefined);
});

test("only a well-formed saved lab counts as one (a shape's meta is loose JSON)", () => {
  assert.equal(isSavedLab({ run: "r", start: "s", state: { text: "s t" } }), true);
  for (const bad of [null, "x", {}, { run: "r", start: "s" }, { run: 1, start: "s", state: { text: "" } }]) assert.equal(isSavedLab(bad), false);
});
