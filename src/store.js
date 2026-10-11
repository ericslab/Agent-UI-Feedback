import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The notes queue: one JSON array in the project's fixes.json.
 * Every note holds status (pending or done), the page, the element, the text the page showed,
 * the text wanted and a comment. Read-change-write steps run one at a time so two saves made
 * together both land, and the file is replaced atomically.
 */
export class Store {
  constructor(file) {
    this.file = path.resolve(file);
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const notes = JSON.parse(await readFile(this.file, "utf8"));
      return Array.isArray(notes) ? notes : [];
    } catch {
      return [];
    }
  }

  async write(notes) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(notes, null, 2)}\n`);
    await rename(tmp, this.file);
  }

  update(change) {
    const run = this.queue.then(async () => {
      const notes = await this.read();
      const result = await change(notes);
      await this.write(notes);
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /** Adds a note, or replaces the pending note on the same text of the same page. */
  save(input) {
    return this.update((notes) => {
      const existing = notes.find((n) => n.status === "pending" && n.path === input.path && n.selector === input.selector && n.original === input.original);
      if (existing) {
        Object.assign(existing, input);
        return existing;
      }
      const note = { id: crypto.randomUUID(), status: "pending", createdAt: new Date().toISOString(), ...input };
      notes.push(note);
      return note;
    });
  }

  remove(id) {
    return this.update((notes) => {
      const index = notes.findIndex((n) => n.id === id);
      if (index >= 0) notes.splice(index, 1);
      return index >= 0;
    });
  }
}
