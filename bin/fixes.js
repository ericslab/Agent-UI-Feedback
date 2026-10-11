#!/usr/bin/env node
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../src/server.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const help = `fixes: click and comment on a running web app.

  fixes                 start the notes server (port 4777, notes in ./fixes.json)
  fixes --port 4800     another port
  fixes --file notes.json
  fixes install         copy the /fixes skill into this project for Claude Code and Codex
`;

if (args.includes("--help") || args.includes("-h")) {
  console.log(help);
} else if (args[0] === "install") {
  const targets = [".claude/skills/fixes", ".agents/skills/fixes"];
  for (const target of targets) {
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(root, "skills", "fixes"), target, { recursive: true });
    console.log(`copied skills/fixes to ${target}/`);
  }
  console.log("\nClaude Code: /fixes\nCodex: $fixes, or ask it to go through your feedback.");
} else {
  const port = Number(flag("--port", 4777));
  const file = flag("--file", "fixes.json");
  const server = createServer({ file });
  server.listen(port, "127.0.0.1", () => {
    console.log(`fixes is running on http://localhost:${port}\nnotes: ${path.resolve(file)}\n\nAdd this to your app in development:\n\n  <script src="http://localhost:${port}/fixes.js"></script>\n`);
  });
}
