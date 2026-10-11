import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";

const widgetFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "widget", "fixes.js");

const limits = { url: 2000, path: 2000, locale: 10, selector: 4000, tag: 20, original: 10_000, edited: 10_000, comment: 10_000 };

function validate(body) {
  if (!body || typeof body !== "object") throw new Error("Expected a JSON object");
  const note = {};
  for (const [key, max] of Object.entries(limits)) {
    const value = body[key];
    if (typeof value !== "string") throw new Error(`${key} must be a string`);
    if (value.length > max) throw new Error(`${key} is longer than ${max} characters`);
    note[key] = value;
  }
  return note;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 100_000) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * The local notes server. Serves the widget at /fixes.js and the queue at /notes, with CORS open so
 * the widget works from any dev server on this machine.
 */
export function createServer({ file }) {
  const store = new Store(file);
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body));
  };
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        return res.end();
      }
      if (req.method === "GET" && url.pathname === "/fixes.js") {
        res.writeHead(200, { "content-type": "text/javascript", "access-control-allow-origin": "*", "cache-control": "no-store" });
        return res.end(await readFile(widgetFile));
      }
      if (url.pathname === "/notes") {
        if (req.method === "GET") return json(res, 200, { notes: await store.read() });
        if (req.method === "POST") {
          const note = await store.save(validate(JSON.parse(await readBody(req))));
          return json(res, 200, { note });
        }
        if (req.method === "DELETE") {
          const id = url.searchParams.get("id");
          if (!id) return json(res, 400, { error: "id is required" });
          return json(res, 200, { ok: await store.remove(id) });
        }
      }
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end(`fixes is running. Add this to your app in development:\n\n<script src="http://localhost:${req.socket.localPort}/fixes.js"></script>\n\nNotes: ${store.file}\n`);
      }
      json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}
