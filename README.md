# agent-ui-feedback

Click and comment on your running web app. Claude Code or Codex implements the notes.

## The problem

Giving feedback on a web app to an AI agent means describing where things are. "The second paragraph under the pricing heading, the one that starts with 'Start for free', change it to..." Then the agent edits the wrong string, or the right string in the wrong language file, and you describe it again. Every round trip is a paragraph of directions for a change you could have typed in two seconds. It is tedious, and it is prone to mistakes on both sides.

## The fix: click and comment

Turn the tool on, click the text on the page, rewrite it in place, add a comment if you want, press Enter. The note is queued in `fixes.json` with the page, the element, the text the page showed and the text you want. Run `/fixes` in Claude Code (or ask Codex) and every pending note is implemented in the source, translations included.

The edit stays visible on the page, highlighted, until it is implemented. Links and buttons keep working on a plain click; Alt+click edits their text.

## Setup

1. Start the notes server in your project folder:

```sh
npx github:ericslab/agent-ui-feedback
```

   It runs on port 4777 and writes notes to `./fixes.json`. Use `--port` and `--file` to change either.

2. Load the widget in your app in development only. One script tag, in your root layout or `index.html`:

```html
<script src="http://localhost:4777/fixes.js"></script>
```

   Next.js, in `app/layout.tsx`:

```tsx
{process.env.NODE_ENV === "development" && <script src="http://localhost:4777/fixes.js" />}
```

   Vite, in `index.html`:

```html
<script>
  if (import.meta.env.DEV) document.write('<script src="http://localhost:4777/fixes.js"><\/script>');
</script>
```

3. Install the skill into your project:

```sh
npx github:ericslab/agent-ui-feedback install
```

   This copies `skills/fixes` to `.claude/skills/fixes` (Claude Code) and `.agents/skills/fixes` (Codex).

   The command is `/fixes`. If that is too generic for your project (another skill or command already uses the name), rename the copied folder and the `name:` line at the top of its `SKILL.md`, for example to `ui-feedback`, and invoke that instead.

## Use

- Toggle at the bottom right turns the tool on and off. It remembers the setting per browser.
- Click text to edit it in place. Enter saves, Escape cancels, Shift+Enter adds a line break. A blank line is a paragraph break and the fix splits the string there.
- Type a comment in the box under the text for an instruction the edit alone does not say ("make this friendlier", "this number is wrong"). A note can be a comment with no edit.
- The Fixes button lists the pending notes; the × on a row deletes it.
- A second edit of the same text replaces the pending note instead of adding one.

Then in Claude Code:

```
/fixes
```

The skill reads every pending note, finds the string in the source (message files first, then components), writes the new copy following the comment, translates it into the other language files when the project has them, marks the note `done` in `fixes.json` and runs the project's type check. Notes whose text does not come from the code (database rows, user content) stay pending and are named in the reply.

## The note

```json
{
  "id": "51e5ac99-755b-4bf3-86e3-d45a93d3899d",
  "status": "pending",
  "createdAt": "2026-10-11T18:04:50.725Z",
  "url": "http://localhost:3000/pricing",
  "path": "/pricing",
  "locale": "en",
  "selector": "body > main:nth-of-type(1) > p:nth-of-type(2)",
  "tag": "p",
  "original": "Start for free, upgrade when you grow.",
  "edited": "Start free. Upgrade when you grow.",
  "comment": "shorter"
}
```

`status` becomes `done` with a `doneAt` time when the note is implemented. Notes are never removed by the skill, so `fixes.json` is also the history of your feedback. Commit it or ignore it as you prefer.

## Layout

- `bin/fixes.js`: the CLI (`fixes`, `fixes install`).
- `src/server.js`, `src/store.js`: the local notes server and the JSON queue. No dependencies.
- `widget/fixes.js`: the browser widget, plain JavaScript in a shadow root so your app's CSS and the widget's do not touch.
- `skills/fixes/SKILL.md`: the skill, the same file for Claude Code and Codex.
- `example/index.html`: a page to try it on (`npx agent-ui-feedback` in one terminal, `python3 -m http.server 4778` in `example/` in another).

Tests: `npm test`.
