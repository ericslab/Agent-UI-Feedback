import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";

const note = { url: "http://localhost:3000/pricing", path: "/pricing", locale: "en", selector: "body > main:nth-of-type(1) > p:nth-of-type(1)", tag: "p", original: "Start for free", edited: "Start free", comment: "" };

test("notes are saved, replaced on the same text, listed and deleted", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fixes-"));
  const file = path.join(dir, "fixes.json");
  const server = createServer({ file });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

  const first = await post(note);
  assert.equal(first.note.status, "pending");
  const second = await post({ ...note, edited: "Start for free today" });
  assert.equal(second.note.id, first.note.id);
  const other = await post({ ...note, original: "Pricing" });
  assert.notEqual(other.note.id, first.note.id);

  const listed = await fetch(`${base}/notes`).then((r) => r.json());
  assert.equal(listed.notes.length, 2);
  assert.equal(listed.notes[0].edited, "Start for free today");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).map((n) => n.original), ["Start for free", "Pricing"]);

  const bad = await fetch(`${base}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...note, tag: 5 }) });
  assert.equal(bad.status, 400);

  await fetch(`${base}/notes?id=${first.note.id}`, { method: "DELETE" });
  const after = await fetch(`${base}/notes`).then((r) => r.json());
  assert.deepEqual(after.notes.map((n) => n.original), ["Pricing"]);

  const widget = await fetch(`${base}/fixes.js`);
  assert.equal(widget.headers.get("content-type"), "text/javascript");
  assert.match(await widget.text(), /fixes-root/);
  server.close();
});
