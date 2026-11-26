# Learning library (all /teach courses live here)

This folder is the single home for everything the `/teach` skill makes. Any session can resume any
course from these files alone; nothing depends on old chat history.

## Start of every teaching session
1. Read `LEARNER.md` (who the learner is, how they like to learn, house style).
2. Read `PROGRESS.md` to see where each course stands and what's next.
3. Open the course folder and read its `MISSION.md`, `NOTES.md` and `learning-records/` before teaching.
   The course folder is the teach workspace (MISSION, RESOURCES, NOTES, learning-records, lessons, reference, assets).
   Also read `app-data/` if it exists: the attention-app writes what the learner did there —
   `canvas/<lesson>.json` (every term they opened a card on, how deep they went), `tutor.json` (highlight
   questions and answers), `progress.json` (lessons done, rep days). Terms they had to look up are evidence of
   gaps; use them to pick the next lesson. These files are written by the app; don't hand-edit them.
4. Run `node {{APP}}/scripts/digest.mjs <course>` and read `app-data/digest.md` before choosing
   the next lesson: ranked gaps (failed recalls, "not yet" answers, terms opened again, quiz misses after long
   reads), the learner's questions and notes verbatim, long card chains (a skipped prerequisite) and quiz misses.
5. If the learner owes answers from the last lesson (quiz results, "your turn" prompts), ask for those first,
   then write a learning record. Then build ONE lesson per request.
6. At the end, update the course's `NOTES.md` log, its `index.html`, and the course's row in `PROGRESS.md`,
   then rebuild the library front page: `python3 {{LEARNING}}/_shared/build_library.py`.

## Courses
| Folder | Course | Style |
|---|---|---|

New course: `mkdir <slug>`, then `ln -s ../_shared/assets <slug>/assets`, and link `../assets/course.css`
from lessons (`assets/course.css` from the course's `index.html`). Add a row above and in `PROGRESS.md`.

## The library front page
`index.html` here is the library, with three views switched by the URL hash:
`#` course cards (one per course folder), `#<folder>` one course's lessons in order plus its cheat sheets,
and `#all` every lesson newest first.
It is generated: never edit it by hand, run `_shared/build_library.py`. The script reads each lesson's
`<h1>`, `.lede`, `.eyebrow` and `<b>N min</b>`, and the course name from the course `index.html` `<h1>`
(or `MISSION.md`). Its own styles are in `_shared/assets/library.css`.

## House style (shared assets)
- Look: a calm article page. Centred 760px column, Inter headings, Georgia prose (Gelasio as the web
  fallback), IBM Plex Mono labels, sage paper #f4f6f2, ultramarine accent #234be7, lime highlight #ddf59e,
  square-ish rules and borders, sidenotes in the right margin. All of it is in `_shared/assets/course.css`.
- Every lesson head links the fonts:
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;700&family=Gelasio:ital,wght@0,400;0,600;1,400&display=swap">`
  and lessons/reference pages start their `.crumbs` nav with `<a href="../../index.html">Library</a>`.
- `_shared/assets/` is the one copy of `course.css` and `quiz.js`. Each course has
  `assets -> ../_shared/assets`, so relative links work locally and in the app.
- Add reusable components (interactive figures) there. Never restyle an existing class in a way that
  changes other courses' lessons; add a new class instead.

## Formulas
When a lesson needs maths, typeset it with KaTeX and define **every symbol in words** in a `.gloss` line
right beside the equation. Display math goes in `<div class="eq">\[ … \]</div>`; inline is `\( … \)`.
Head lines (jsDelivr CDN, no SRI):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js" crossorigin="anonymous"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js" crossorigin="anonymous" onload="renderMathInElement(document.body,{delimiters:[{left:'\\[',right:'\\]',display:true},{left:'\\(',right:'\\)',display:false}],throwOnError:false});"></script>
```

and in the lesson's `<style>`:

```css
.eq { margin: 1rem 0; padding: 0.3rem 0; overflow-x: auto; overflow-y: hidden; }
.gloss { font-size: var(--step--1); color: var(--muted); margin: -0.4rem 0 1.1rem; }
.gloss b { color: var(--ink); }
```

Do NOT enable `$…$` as a delimiter (prices in prose use `$`). How much maths a course carries depends on
the learner: see `LEARNER.md`.
