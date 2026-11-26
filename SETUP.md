# Setting up attention-app (instructions for Claude)

You are setting up attention-app on the user's own computer. Work through these steps in order. Say
what you are doing in plain words as you go. **Ask before installing anything system-wide** (Node,
pnpm, Python, uv, ffmpeg) and before editing a shell profile. Never put an API key in a file other than
`.env.local`, and never print one back.

## 1. Check what's installed

Run each and note what's missing:

- `node --version`: needs 24 or newer.
- `pnpm --version`: if missing and Node is there, `corepack enable pnpm` usually provides it.
- `python3 --version`: needs 3.x (it builds the library page of the user's courses).
- `claude --version`: Claude Code. You are probably running in it; if this is another tool, the user
  needs Claude Code installed and signed in (https://claude.com/claude-code), because the app's tutor and
  lesson writer run through the `claude` CLI on this machine.

For anything missing, give the user the install command for their OS and ask whether to run it.

## 2. Get the code

If the current folder isn't already an attention-app checkout, ask where to put it (default: the home
folder), then:

```bash
git clone https://github.com/wilfredeveloper/attention-app.git
cd attention-app
```

## 3. Install and bootstrap

```bash
pnpm install
pnpm bootstrap
```

`pnpm bootstrap` makes the learning folder (a folder named `learning` beside the app), links the teach
skill into `~/.claude/skills/teach`, and checks for the `claude` CLI. It never overwrites anything. Read
its output:

- If it says `~/.claude/skills/teach` already exists and isn't this app's skill, tell the user and ask
  before replacing it (it prints the command).
- It prints an `export LEARNING_DIR=…` line. Offer to add it to the user's shell profile (`~/.zshrc` on
  macOS, usually `~/.bashrc` on Linux), so `/teach` finds their courses from any terminal.

## 4. Optional features

Ask the user whether they want either; skip both if they're unsure (they can add them later).

- **Steer live** (an explanation they steer as they read) needs an OpenRouter key. Ask them to create one
  at https://openrouter.ai/keys and paste it. Copy `.env.example` to `.env.local` if it doesn't exist and
  set `OPENROUTER_API_KEY=` there.
- **Watch** (a short narrated video about a highlight) needs `uv`, `ffmpeg` and about 350 MB of model
  files. Follow `kokoro/README.md`.

## 5. Start it

```bash
pnpm dev -H 127.0.0.1
```

Give the user the link (http://localhost:3000) and tell them: press **Start a course**, type what they
want to learn, and the first lesson is ready in a few minutes. Highlighting anything in a lesson opens
Explore, Ask and Note. Lesson writing runs on their own Claude Code usage.

If something fails, read the error, fix what you can, and explain anything you couldn't fix.
