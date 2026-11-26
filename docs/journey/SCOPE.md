# Journey, feedback loop and control room: scope

Three phases. Each ships something usable on its own; nothing in a later phase is needed for an earlier one.

| Phase | What you get | Packages |
|---|---|---|
| **1. Record** | The app silently logs what you study, and what every Claude call costs | WP1–WP4 · **done 2026-11-12** (merged to main, end-to-end pass on scratch data) |
| **2. Loop** | The next lesson adapts to your gaps; four small asks; the Journey page | WP5–WP8 · **done 2026-11-12** (merged, end-to-end pass on scratch data; prototypes archived on `prototype/journey`) |
| **3. Control room** | One page: usage, which model runs where, and the teach skill (view, edit, review) | WP9–WP11 |

Prototypes (throwaway, synthetic data):
- Journey page: `/learn/model-editing/journey-prototype?variant=D` (A–C are the earlier options)
- The four asks: `/learn/model-editing/session-prototype` (right-hand panel shows what is recorded and the time the asks cost)
- Proposed event format: `components/journey-prototype/data.ts`

## Principles

1. **Asks must be learning, not admin.** Every ask is a retrieval or self-explanation act, appears where you
   already are, takes under a minute, is skippable at no cost, and visibly changes what comes next.
   Budget: about 2 minutes of asks per session.
2. **Delayed beats immediate.** Self-ratings are only asked after a gap ("Still clear?" on return); right after
   reading they're overconfident.
3. **The main consumer of the log is the teacher.** The learner never has to read a dashboard for the loop to work.
4. **Local only.** Everything stays in the learning folder; nothing is sent anywhere except the Claude calls the app
   already makes.

## Decisions

| # | Question | Answer |
|---|---|---|
| D1 | Journey layout | **D** (B + C remix) |
| D2 | Record reading time per section | yes (used by the teacher, not shown as a headline) |
| D3 | Backfill old cards and threads | no |
| D4 | Warm-ups from gaps: written by the teacher, or generated live by the app? | **live, by the app** (WP6) |
| D5 | Where the teach skill's history lives | **git repo in `~/.claude/skills/teach/`** (created 2026-11-12, first commit `0278320`, no remote) |

## Shared contract (WP1 lands this first)

**Files** (all append-only JSONL, written only by the app):
- `learning/<course>/app-data/events.jsonl`: study events
- `learning/_shared/app-data/calls.jsonl`: one line per Claude call
- `learning/_shared/app-data/models.json`: which model each feature uses (Phase 3; until then the current hard-coded choices)

**Study event** (`lib/events.ts`):

```ts
type Base = { t: string; lesson: string; view: "canvas" | "reader" | "session" };
type Ev = Base & (
  | { kind: "read"; section: string; secs: number }
  | { kind: "explore"; term: string; from: string | null; section: string; context: string; card: string; seenBefore: boolean }
  | { kind: "deepen"; card: string; term: string; level: 1 | 2 | 3 | 4 }
  | { kind: "ask"; term: string | null; section: string; text: string; level: "simple" | "mid" | "deep" }
  | { kind: "quiz"; section: string; q: string; right: boolean; first: boolean; fromGap: boolean }
  | { kind: "lab"; section: string; lab: string; goal: boolean; detail: string }
  | { kind: "done"; done: boolean }
  // Phase 2 asks
  | { kind: "clear"; term: string; v: boolean | null }              // "Still clear?" on return; null = skipped
  | { kind: "recall"; term: string; card: string; had: boolean | null } // "Recall first?"; null = skipped
  | { kind: "note"; text: string }                                    // end-of-session line
);
```

**Call record** (`lib/calls.ts`), taken from the CLI's final `result` message (verified 2026-11-12:
it carries `duration_ms`, `total_cost_usd`, `usage`, `modelUsage`):

```ts
type Call = { t: string; feature: string /* "explain.1".."explain.4" | "ask.simple|mid|deep" | ... */;
  model: string; course: string; ms_first: number; ms_total: number; in: number; out: number;
  cache_read: number; cost_usd: number /* list-price equivalent; on a subscription not what is billed */;
  ok: boolean; error?: string };
```

**API:** `POST/GET /api/events` (as before), `GET /api/calls?since=` (Phase 3 reads it).
**Client:** `logEvent`, `useDwell`, `useLessonMessages` (stubs from WP1, filled by WP3/WP4).

## Phase 1: Record

Each package is a brief for one Opus 5.5 subagent in its own git worktree; owned files are exclusive.
Every package: `npx tsc --noEmit` and `npx eslint <owned files>` clean, no new dependencies, plain CSS,
synthetic data in any test, a headless-Chrome check for anything visible.

### WP1: contract, log routes, call logging (first, alone)
- Owns `lib/events.ts`, `lib/calls.ts`, `app/api/events/route.ts`, the hook call sites (one line each) in
  `LessonCanvas.tsx` / `LessonReader.tsx`, and the result-parsing lines in `app/api/explain` and `app/api/ask`.
- Done when: POSTing 3 valid + 1 malformed event appends 3 lines; bad course → 404; a canvas card and a reader
  question each append one `calls.jsonl` line with non-zero tokens and the right feature name.

### WP2: canvas capture (after WP1, parallel)
- Owns `LessonCanvas.tsx` (except WP1 lines), canvas rules in `app/reader.css`.
- Cards get `createdAt`. Logs `explore` (with `seenBefore`), `deepen`. Fills the canvas `getSection`.
- Done when: open, deepen twice, reload → explore + 2 deepen with matching ids.

### WP3: reading time + reader capture (after WP1, parallel)
- Owns `useDwell`, `LessonReader.tsx` (except WP1 line), `LessonComplete.tsx`.
- Done when: two sections read headlessly log `read` within 10 s of the truth; nothing while hidden/idle; one `ask`.

### WP4: quiz + lab hooks (after WP1, parallel)
- Owns `useLessonMessages`; `learning/_shared/assets/quiz.js`, `editlab.js`, other labs with a goal state
  (not under git: back up to `.bak`, then `pnpm sync`). Post to `parent` only when framed.
- Done when: wrong-then-right logs two quiz events (`first` true, false); lab goal logs once; standalone lesson unchanged.

## Phase 2: Loop

### WP5: teacher digest
- A script `scripts/digest.mjs <course>` → `learning/<course>/app-data/digest.md`: terms opened in more than one
  lesson, "not yet" answers, failed recalls, quiz misses after long reads, your tutor questions and session notes
  verbatim, long card chains. Under one page.
- The learning workspace's CLAUDE.md says to run and read it at the start of every teaching session.
- Done when: on the prototype's synthetic events it lists exactly the gaps the prototype shows.

### WP6: the asks (after WP2–WP4)
- **Still clear?** On opening a course after ≥ 2 days away: up to 3 terms from last time, Yes / Not yet / Skip.
- **Recall first?** On opening a card for a term already opened in an earlier session: a question
  (generated once, stored with the old card), Show my card / Skip, then an optional "had it? yes / no".
- **End-of-session line:** a "Done for today" control on the canvas and reader; optional one line.
- **Warm-up from gaps (live):** when a lesson opens, the app picks up to 3 gaps from the log (in order: failed
  recall, "not yet", term opened in 2+ lessons, quiz missed after a long read; never one checked right in the last
  3 days) and asks Claude for one multiple-choice question each, written from your old card's text and the lesson
  context. Options are the same length; the right answer's position is random. Shown as a "From last time" block above
  the lesson (canvas and reader), answered with one click, graded instantly, logged as `quiz` with `fromGap: true`.
  Generated in the background on open, cached per course per day in `app-data/warmup/<date>.json`, so it never
  delays the lesson; if generation fails or there are no gaps, the block doesn't appear. Feature name `warmup` in
  `calls.jsonl` / `models.json` (default Haiku).
- Done when: the session prototype's walk-through works in the real canvas, and total ask time in a normal
  session stays under 2 minutes.

### WP7: canvas uses what it knows (after WP2)
- Cards open at the depth you usually reach for that course (median of your last 20); a term you opened before
  reuses your old card's text instead of a new Claude call.
- Done when: a repeated term makes no new `calls.jsonl` line.

### WP8: Journey page (after WP1, D1)
- `app/learn/[course]/journey/`, variant D rebuilt properly on real events; pure derivations in
  `components/journey/derive.ts`; empty state; a link from the course page.

## Phase 3: Control room

One page at `/control`, three tabs. Prototype it before building (not done yet).

### WP9: Usage
- From `calls.jsonl`: calls, tokens, list-price cost and median first-token time, by day, feature, model and
  course. Slowest and failed calls listed with their error.

### WP10: Models
- `models.json` maps each feature to a model and effort (`explain.1`…`explain.4`, `ask.*`, `warmup`,
  recall-question generation). Routes read it on every request instead of hard-coded names.
- The tab shows each feature's current model next to its measured speed and cost, with a dropdown to change it.
- Also holds the **"Prefetch pictures"** toggle (default on): when off, the canvas never fetches level 4 ahead;
  it generates only when the learner zooms to it. The tab shows what prefetching has cost so far
  (`explain.4` calls made ahead and never opened).
- Done when: switching `explain.4` to Haiku changes the next card's `calls.jsonl` model with no restart.

### WP11: Teach skill
- View `~/.claude/skills/teach/` (SKILL.md and the format files) rendered; edit in place with a diff before
  saving; every save is a git commit in that folder (D5), and revert is `git revert` of a chosen commit.
  The history tab lists commits with their diffs. Edits made outside the app (by hand or by Claude) show up as
  uncommitted changes, which the tab offers to commit with a message.
- **Review:** a button that asks Claude to critique the edit against the learning records and house rules
  (conflicts, vaguer instructions, things it would stop doing), shown beside the diff. Saving stays your call.
- Guardrails: writes only inside that one folder; never saves without the diff shown; local only.
- Done when: an edit, its review, a save and a revert all round-trip, and `git log` (or the history folder)
  shows both versions.

## Order

```
Phase 1:  WP1 ──┬── WP2 ──┐
                ├── WP3 ──┼──► Phase 2:  WP5 (digest) · WP6 (asks) · WP7 · WP8 (journey)
                └── WP4 ──┘
                                Phase 3:  WP9 (usage) ─ WP10 (models) ─ WP11 (skill)   [after a prototype]
WP1 already records calls, so Phase 3's numbers exist from day one.
```

Last step for each phase: the lead merges, runs one end-to-end headless pass, and moves that phase's
prototype code to a `prototype/*` branch.

## Follow-ups found during Phase 1 (not yet fixed)

- `/api/ask` runs on the session's default model (currently Opus) with the full Claude Code context:
  ~$0.18 and 8–11 s per question vs. ~$0.0004 and 1.5–3 s for a canvas definition. WP10 fixes routing; a one-line pin is possible sooner.
- Alt+click picks one word and splits at commas ("1,024-dimensional" → "024-dimensional").
- Card `context` uses `innerText`, so KaTeX's hidden MathML copy duplicates formulas (quiz.js already strips it).
- In dev, a Claude call can keep running (and be logged ok) after the page that started it is gone.
- `seenBefore` only knows explores from before the page loaded.
- Events land as JSONL per course; there is no rotation. Fine for years of one learner, worth revisiting if it ever isn't.

## Follow-ups found during Phase 2 (not yet fixed)

- **Fetch-ahead on reopened lessons:** saved cards prefetch their next level, including the Sonnet picture level
  (~$0.035, ~21 s each). Decided 2026-11-12: keep it; add an on/off toggle in WP10.
- The "From last time" panel sits over the top-left of the lesson in the canvas until answered or collapsed.
- Warm-up gaps never retire: an old failed recall comes back whenever it hasn't been answered right in the last 3 days.
- A warm-up can still ask about a term tapped "still clear" seconds earlier (the tap may not have reached the log yet).
- Haiku writes 13–17-word options although the prompt asks for ≤10 (still near-equal length).
- "Done for today ✓" isn't remembered after a reload.
- `.lib-breakout { width: 100vw }` gives library pages a few-pixel horizontal scrollbar (pre-existing).
- Contract additions made during Phase 2: `explore.level` (depth the card opened at), `quiz.term` (the gap a warm-up tests).

## WP12: ask for the next lesson from the app (added 2026-11-12)

A button on the course page starts the `/teach` workflow unattended and tells the learner when the lesson is ready.
- Decisions: **Opus 5.5**, hard cap **$5 list price** per lesson (`--max-budget-usd`); notify by **in-app banner +
  browser notification**; the dev server stays reachable on the LAN, so the lesson and skill routes accept only
  requests whose Host is localhost (stops other devices' browsers, not a deliberate forger; binding to 127.0.0.1 would).
- Runs as a detached job (`scripts/lesson-job.mjs`) so it survives app reloads: `claude -p` in the course folder with
  edit permission limited to the learning folder, a short tool allowlist, the learner's optional note, and an
  "unattended: don't ask, use the digest" instruction. On success it publishes with `scripts/sync-courses.mjs`.
- Job files: `learning/<course>/app-data/jobs/<id>.json` (+ `.log`). One job per course at a time.
