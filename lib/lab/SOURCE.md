# The steer-live lab (vendored, patched)

From https://github.com/chuanqisun/spaceship (MIT, see LICENSE), commit 4ddd4d1: its "text" app,
an explanation written live by a model that you read by dragging a knob and steer as it goes.
It used to be a separate Vite build in labs/spaceship, shown in a frame; it is now part of the app.

What changed from upstream:

- Runs inside the app, not as a page of its own. `createLab(root, options)` in lab.ts (upstream's
  src/text/main.ts) builds its markup in any element and returns pause / resume / text / destroy;
  components/Lab.tsx wraps it for React. Several labs can be on a page: each listens only inside
  its own box, keeps its own CSS highlights inside shared ones (highlights.ts), and plays through
  its own output on one shared AudioContext (text/sound/engine.ts). A paused lab makes no model
  calls (they wait, gated in lab.ts), runs no timers that would make them, and is silent.
- Positions are in lab units (space.ts): read from the lab's own box, the zoom of any CSS
  transform above it divided out, so it works at any size and on a board that zooms it.
- Styles: upstream's page-wide styles from index.html are lab.css, all under `.steer-lab`.
- Model calls go to the app's routes, with the keys on the server (OPENROUTER_API_KEY):
  llm/cerebras.ts -> /api/spaceship/complete (gpt-oss-120b on Cerebras), llm/decisions.ts ->
  /api/spaceship/decide (Jev decision model). A host can send the text calls to another route
  that answers alike (`completeUrl`): the lab in a canvas note uses /api/lab/complete (Haiku 5.5
  through the claude CLI, lib/labPool.ts, or an OpenRouter model, as picked in the Models tab).
- Teaches a topic instead of writing fiction: the prompts in story/prompt.ts and text/live-*.ts
  (learning knobs: depth, grounding, audience, mode, focus = sub-concepts, language, angle, pace,
  pitfalls).
- Writes math as plain text: the prompts ask for it, and text/plain-math.ts turns any LaTeX that still comes into plain text as
  it streams, since the lab shows its text as it is and sends it back as the text so far.
- Starts from a given text (a topic heading, maybe the learner's draft), shown with the knob after
  it, instead of a `topic` URL parameter; and may be given sources, passages the learner clipped,
  which every continuation is asked to keep to (the SOURCES block in story/prompt.ts).
- Reports what the learner does (launch, dials set and deleted, pins, drag backs, close) to its
  host through `onEvent`, stamped with a hash of its prompts (stamp.ts); the app files them as
  `steer` events in the study log (lib/events.ts, lib/spaceship.ts).
- Pauses and picks up again: `state()` (and `onState`, as it settles, pauses and goes) gives what it
  shows: its text past the knob too, the knob's place, the attention boxes and the dials (pinned
  ones with their sentence); `resume` starts a lab from that. Resumed text past `start` is the
  lab's own, so the knob can go back into it. The canvas keeps it on the note (lib/note.ts labStart).
- Removed: sim mode (the canned story and its simulated sources), the mode toggle, the launch
  dialog, the extra/ pages, and the separate build with its stale-build check.
