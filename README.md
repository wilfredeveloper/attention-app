# attention-app

A reading app for learning anything, one course at a time. You say what you want to learn; Claude writes
you a course of interactive lessons, one at a time, and each new lesson is shaped by what you did in the
last one: what you highlighted, asked about, got wrong in a quiz or looked up twice.

You read a lesson on a pan-and-zoom board. Highlight anything you don't follow and:

- **Explore** opens a card explaining it, which you can deepen level by level, right beside the text.
- **Ask** puts the passage to a tutor, at the depth you pick.
- **→ Note** clips it into a sticky note for your own writing.
- **Steer live** *(optional)* writes an explanation live that you steer as you read.
- **▶ Watch** *(optional)* makes a short narrated video about it.

Everything runs on your machine. Courses are plain files in a folder you own, and the AI runs through your
own [Claude Code](https://claude.com/claude-code) login. There is no account and no server.

## Requirements

- Node.js 24+ and [pnpm](https://pnpm.io)
- Claude Code, installed and signed in (`claude` on your PATH)
- Python 3 (builds the library page of your courses)

## Set up

**The easy way:** open [Claude Code](https://claude.com/claude-code) in a terminal and paste:

```
Clone https://github.com/wilfredeveloper/attention-app and set it up for me by following its SETUP.md.
```

Claude checks what you have installed, asks before installing anything, and starts the app.

**By hand:**

```bash
git clone https://github.com/wilfredeveloper/attention-app.git
cd attention-app
pnpm install
pnpm bootstrap
pnpm dev        # http://localhost:3000
```

`pnpm bootstrap` makes your learning folder (a folder named `learning` beside the app, or `LEARNING_DIR`)
from `starter/learning`, links the teach skill into `~/.claude/skills/teach`, and checks for the `claude`
CLI. It never overwrites anything that is already there. Then press **Start a course** in the app.

To use `/teach` in a terminal as well, add the line bootstrap prints (`export LEARNING_DIR=…`) to your
shell profile.

## Optional features

Copy `.env.example` to `.env.local` for these. The app hides each one until its requirements are met.

| Feature | Needs |
|---|---|
| Steer live | `OPENROUTER_API_KEY` ([openrouter.ai](https://openrouter.ai/keys)) |
| Watch | Kokoro text-to-speech: `uv`, `ffmpeg` and two model files (see `kokoro/README.md`) |

## How lessons are made

The **teach skill** (`skills/teach`) is what writes courses. The app runs it in the background
(`scripts/lesson-job.mjs`): **Start a course** writes a draft mission and lesson 1; **Ask for the next
lesson** on a course page writes the next one. Before each lesson it reads a digest of what you did in the
app (`scripts/digest.mjs`), so the lesson goes after your gaps. A lesson run uses Opus and is capped at $5
of usage; it takes a few minutes.

Your learning folder holds:

```
learning/
  CLAUDE.md        the teaching rules every lesson run follows
  LEARNER.md       who you are and how you learn (filled in as it learns about you)
  PROGRESS.md      where each course stands
  _shared/         the lesson stylesheet, shared figures and the library page builder
  <course>/        MISSION.md, NOTES.md, lessons/, reference/ (cheat sheets), app-data/ (what you did)
```

Edit any of these by hand; the next lesson run reads them. The app publishes a course's lessons into
`public/courses/` (`pnpm sync`).

## Other pages

- **Control room** (`/control`): what every Claude call cost, which model each feature uses, and the teach
  skill itself, with edits reviewed before they're saved.
- **Journey** (on each course page): what you studied, and the gaps the next lesson will go after.
- **Harnessing Attention** (on the home page): a short sample course written as MDX
  (`content/courses/attention`), with a breath timer and practice log.

## Notes

- The routes that start lesson runs only answer requests from `localhost`. Run it on your own machine;
  `next dev -H 127.0.0.1` keeps it off your network.
- tldraw (the board) is free in `pnpm dev`. A production build needs `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`
  ([tldraw.dev](https://tldraw.dev)).
- `pnpm test` runs the unit tests.

## Credits

The Steer live lab (`lib/lab`) is adapted from [chuanqisun/spaceship](https://github.com/chuanqisun/spaceship)
(MIT, see `lib/lab/LICENSE`).

## License

MIT, see `LICENSE`.
