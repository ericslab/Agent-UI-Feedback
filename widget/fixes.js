/**
 * fixes: click and comment on a running web app.
 *
 * Loaded from the local notes server (<script src="http://localhost:4777/fixes.js">). While the toggle at the
 * bottom right is on, clicking any text makes it editable in place; the edit and an optional comment are saved as
 * a note in the project's fixes.json, stay visible on the page, and /fixes in Claude Code or Codex implements every
 * pending note in the source. Links and buttons keep working on a plain click; Alt+click edits their text.
 */
(() => {
  if (window.__fixes) return;
  window.__fixes = true;

  const script = document.currentScript;
  const API = script && script.src ? new URL(script.src).origin : "http://localhost:4777";
  const STORAGE_KEY = "fixes-on";
  const INTERACTIVE = "a, button, [role=button], [role=tab], [role=switch], summary, label";
  const SKIP = "input, textarea, select, svg, canvas, video, iframe, fixes-root";

  const clean = (text) => (text || "").replace(/\s+/g, " ").trim();
  /** Like clean, but keeps line breaks: a blank line in the edited text is a paragraph break the fix is asked to keep. */
  const cleanLines = (text) =>
    (text || "")
      .replace(/[^\S\n]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  function hasOwnText(el) {
    return Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && clean(n.nodeValue) !== "");
  }

  /** The nearest element (up to four levels above the click) that holds text of its own. */
  function textTarget(start, alt) {
    if (!start || !(start instanceof Element) || start.closest(SKIP)) return null;
    if (!alt && start.closest(INTERACTIVE)) return null;
    let el = start;
    for (let depth = 0; el && el !== document.body && depth < 4; depth++, el = el.parentElement) {
      if (el instanceof HTMLElement && hasOwnText(el)) return el;
    }
    return null;
  }

  function selectorFor(el) {
    const parts = [];
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      const index = parent ? Array.from(parent.children).filter((c) => c.tagName === node.tagName).indexOf(node) + 1 : 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
    }
    return `body > ${parts.join(" > ")}`;
  }

  /**
   * Normalised text of an element and, for each of its characters, the text node and offset it came from. Runs of
   * whitespace become one space, except on an element that renders line breaks (pre-wrap, as an edited element does),
   * where a run holding newlines becomes one or two newlines so an existing paragraph break stays where it is.
   */
  function textMap(el) {
    const keepLines = getComputedStyle(el).whiteSpace.startsWith("pre");
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    let text = "";
    const at = [];
    let run = null;
    let breaks = [];
    const flush = () => {
      if (!run) return;
      if (keepLines && breaks.length) {
        for (const b of breaks.slice(0, 2)) {
          text += "\n";
          at.push(b);
        }
      } else {
        text += " ";
        at.push(run[0]);
      }
      run = null;
      breaks = [];
    };
    for (const node of nodes) {
      const value = node.nodeValue || "";
      for (let i = 0; i < value.length; i++) {
        if (/\s/.test(value[i])) {
          if (!text) continue;
          run = run || [];
          run.push({ node, offset: i });
          if (value[i] === "\n") breaks.push({ node, offset: i });
        } else {
          flush();
          text += value[i];
          at.push({ node, offset: i });
        }
      }
    }
    return { text, at };
  }

  /**
   * Rewrites the changed stretch of an element's text in place, editing the text nodes the app rendered rather than
   * replacing them, so links and other elements inside the text stay as they are.
   */
  function replaceText(el, from, to) {
    const { text, at } = textMap(el);
    if (text !== from || from === to || at.length === 0) return;
    let start = 0;
    while (start < from.length && start < to.length && from[start] === to[start]) start++;
    let end = 0;
    while (end < from.length - start && end < to.length - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++;
    const insert = to.slice(start, to.length - end);
    const removeEnd = from.length - end;
    const first = start < from.length ? at[start] : { node: at[at.length - 1].node, offset: at[at.length - 1].offset + 1 };
    const removed = new Map();
    for (let i = start; i < removeEnd; i++) removed.set(at[i].node, [...(removed.get(at[i].node) || []), at[i].offset]);
    const nodes = new Set([first.node, ...removed.keys()]);
    for (const node of nodes) {
      const value = node.nodeValue || "";
      const gone = new Set(removed.get(node) || []);
      let next = "";
      for (let i = 0; i <= value.length; i++) {
        if (node === first.node && i === first.offset) next += insert;
        if (i < value.length && !gone.has(i)) next += value[i];
      }
      node.nodeValue = next;
    }
  }

  /** Every node under an element as the app rendered it, so an edit in place can be undone exactly. */
  function snapshot(el) {
    const parents = [];
    const texts = [];
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) texts.push([node, node.nodeValue]);
      if (node.childNodes.length) parents.push([node, Array.from(node.childNodes)]);
      node.childNodes.forEach(visit);
    };
    visit(el);
    return { parents, texts };
  }

  function restore({ parents, texts }) {
    for (const [parent, children] of parents) {
      const now = Array.from(parent.childNodes);
      if (now.length !== children.length || now.some((n, i) => n !== children[i])) parent.replaceChildren(...children);
    }
    for (const [node, value] of texts) node.nodeValue = value;
  }

  function findNoteElement(note) {
    let el = null;
    try {
      el = document.querySelector(note.selector);
    } catch {}
    const matches = (e) => !!e && (clean(e.textContent) === note.original || clean(e.textContent) === clean(note.edited));
    if (matches(el)) return el;
    return Array.from(document.querySelectorAll(note.tag)).find(matches) || null;
  }

  // ---- state ----
  let on = false;
  let notes = [];
  let editing = null; // { el, original, shown, before, existing }
  let listOpen = false;
  let saveError = null;
  const pending = () => notes.filter((n) => n.status === "pending");
  const here = () => location.pathname;

  // ---- UI ----
  const root = document.createElement("fixes-root");
  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; inset: 0; width: 0; height: 0; z-index: 2147483000; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 14px; color: #eef0f4; }
      * { box-sizing: border-box; }
      button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
      .hover { position: fixed; pointer-events: none; border-radius: 3px; outline: 2px dashed rgba(59, 134, 255, 0.7); outline-offset: 2px; }
      .popover { position: fixed; display: flex; gap: 8px; align-items: center; width: 360px; padding: 8px; border-radius: 10px; background: #22262e; box-shadow: 0 12px 32px rgba(0,0,0,0.45); animation: in .14s ease-out; }
      .popover input { flex: 1; min-width: 0; padding: 8px 12px; border: 0; border-radius: 6px; background: #2b303a; color: #eef0f4; font: inherit; font-weight: 500; outline: none; }
      .popover input::placeholder { color: #636976; }
      .cancel { padding: 8px 12px; border-radius: 6px; font-weight: 700; color: #9aa0ac; }
      .cancel:hover { background: #2b303a; }
      .save { padding: 8px 12px; border-radius: 6px; font-weight: 700; background: #3b86ff; color: #fff; }
      .dock { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
      .list { width: 380px; max-height: 60vh; overflow-y: auto; border-radius: 10px; background: #22262e; box-shadow: 0 12px 32px rgba(0,0,0,0.45); animation: in .14s ease-out; }
      .empty { margin: 0; padding: 12px 16px; font-weight: 500; color: #9aa0ac; }
      .note { display: flex; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #2a2e37; }
      .note:last-child { border-bottom: 0; }
      .note > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .note p { margin: 0; overflow-wrap: anywhere; }
      .path { font-size: 12px; font-weight: 600; color: #636976; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .original { font-weight: 500; color: #9aa0ac; text-decoration: line-through; }
      .edited { font-weight: 600; white-space: pre-wrap; }
      .comment { font-weight: 500; color: #ffb224; }
      .delete { width: 28px; height: 28px; flex-shrink: 0; border-radius: 6px; color: #9aa0ac; font-size: 16px; line-height: 1; }
      .delete:hover { background: #2b303a; }
      .pill { display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 16px; border-radius: 999px; background: #22262e; box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
      .open { display: flex; align-items: center; gap: 8px; font-weight: 700; }
      .count { padding: 0 8px; border-radius: 999px; background: #3a3122; color: #ffb224; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
      .error { max-width: 260px; padding: 0 8px; border-radius: 999px; background: #3a2226; color: #ff5d5d; font-size: 12px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .toggle { position: relative; width: 36px; height: 20px; flex-shrink: 0; border-radius: 999px; background: #2b303a; transition: background .15s; }
      .toggle[aria-checked="true"] { background: #3b86ff; }
      .toggle span { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 999px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: left .15s; }
      .toggle[aria-checked="true"] span { left: 18px; }
      @keyframes in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    </style>
    <div class="hover" hidden></div>
    <div class="popover" hidden>
      <input placeholder="Comment" />
      <button class="cancel" type="button">Cancel</button>
      <button class="save" type="button">Save</button>
    </div>
    <div class="dock">
      <div class="list" hidden></div>
      <div class="pill">
        <button class="open" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>
          Fixes
          <span class="count" hidden></span>
        </button>
        <span class="error" hidden></span>
        <button class="toggle" type="button" role="switch" aria-checked="false" aria-label="Fixes"><span></span></button>
      </div>
    </div>
  `;
  const $ = (sel) => shadow.querySelector(sel);
  const hoverBox = $(".hover");
  const popover = $(".popover");
  const commentInput = $(".popover input");
  const list = $(".list");
  const countBadge = $(".count");
  const errorBadge = $(".error");
  const toggleButton = $(".toggle");

  const pageStyle = document.createElement("style");
  pageStyle.textContent = `
    [data-fixes="pending"]{background:rgba(255,178,36,0.18);box-shadow:inset 0 -2px 0 #ffb224;border-radius:2px}
    [data-fixes-editing]{outline:2px solid #3b86ff;outline-offset:3px;border-radius:2px;cursor:text;white-space:pre-wrap}
  `;

  const mount = () => {
    document.head.appendChild(pageStyle);
    document.body.appendChild(root);
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  function setHover(rect) {
    if (!rect) return (hoverBox.hidden = true);
    hoverBox.hidden = false;
    Object.assign(hoverBox.style, { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }

  function placePopover() {
    if (!editing) return (popover.hidden = true);
    const box = editing.el.getBoundingClientRect();
    popover.hidden = false;
    popover.style.top = `${Math.min(box.bottom + 8, window.innerHeight - 64)}px`;
    popover.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - 368))}px`;
  }

  function render() {
    toggleButton.setAttribute("aria-checked", String(on));
    const count = pending().length;
    countBadge.hidden = count === 0;
    countBadge.textContent = String(count);
    errorBadge.hidden = !saveError;
    errorBadge.textContent = saveError || "";
    errorBadge.title = saveError || "";
    list.hidden = !listOpen;
    if (listOpen) {
      list.replaceChildren();
      if (count === 0) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No pending notes";
        list.appendChild(p);
      }
      for (const note of pending()) {
        const row = document.createElement("div");
        row.className = "note";
        const body = document.createElement("div");
        const add = (cls, text) => {
          const p = document.createElement("p");
          p.className = cls;
          p.textContent = text;
          body.appendChild(p);
        };
        add("path", note.path);
        add("original", note.original);
        if (note.edited !== note.original) add("edited", note.edited);
        if (note.comment) add("comment", note.comment);
        const del = document.createElement("button");
        del.type = "button";
        del.className = "delete";
        del.setAttribute("aria-label", "Delete note");
        del.textContent = "×";
        del.addEventListener("click", () => remove(note));
        row.append(body, del);
        list.appendChild(row);
      }
    }
  }

  // ---- notes ----
  async function load() {
    try {
      const res = await fetch(`${API}/notes`);
      const data = await res.json();
      notes = data.notes || [];
      saveError = null;
    } catch {
      saveError = `Not connected to ${API}`;
    }
    render();
    applyPending();
  }

  /** Shows every pending note of this page in place, so an edit stays visible across reloads until it is implemented. */
  function applyPending() {
    const shown = new Set();
    for (const note of pending()) {
      if (note.path !== here()) continue;
      const el = findNoteElement(note);
      if (!el || shown.has(el)) continue;
      shown.add(el);
      if (editing && editing.el === el) continue;
      replaceText(el, note.original, note.edited);
      el.setAttribute("data-fixes", "pending");
      if (note.edited.includes("\n")) el.style.whiteSpace = "pre-wrap";
    }
  }

  let pollTimer = null;
  let observer = null;
  function watch() {
    if (observer) observer.disconnect();
    clearInterval(pollTimer);
    observer = null;
    if (!on) {
      document.querySelectorAll("[data-fixes]").forEach((el) => el.removeAttribute("data-fixes"));
      return;
    }
    applyPending();
    pollTimer = setInterval(applyPending, 500);
    let timer;
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(applyPending, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  async function remove(note) {
    await fetch(`${API}/notes?id=${encodeURIComponent(note.id)}`, { method: "DELETE" }).catch(() => {});
    notes = notes.filter((n) => n.id !== note.id);
    if (note.path === here()) {
      const el = findNoteElement(note);
      if (el) {
        replaceText(el, note.edited, note.original);
        el.removeAttribute("data-fixes");
      }
    }
    render();
  }

  // ---- editing ----
  function start(el, x, y) {
    const existing = pending().find((n) => n.path === here() && findNoteElement(n) === el);
    const shown = textMap(el).text;
    const original = existing ? existing.original : shown;
    const before = snapshot(el);
    el.setAttribute("contenteditable", "plaintext-only");
    el.setAttribute("data-fixes-editing", "");
    el.focus({ preventScroll: true });
    const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
    const range = pos ? document.createRange() : document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    if (pos && range) range.setStart(pos.offsetNode, pos.offset);
    if (range && el.contains(range.startContainer)) {
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    editing = { el, original, shown, before, existing };
    commentInput.value = existing ? existing.comment : "";
    setHover(null);
    placePopover();
  }

  function finish(save) {
    const current = editing;
    if (!current) return;
    const { el, original, shown, before, existing } = current;
    const edited = cleanLines(el.innerText);
    const text = commentInput.value.trim();
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-fixes-editing");
    editing = null;
    commentInput.value = "";
    placePopover();
    // Put back the exact nodes the app rendered, then write the result into them.
    restore(before);
    const changed = edited !== (existing ? existing.edited : shown) || text !== (existing ? existing.comment : "");
    if (!save || !changed) return;
    if (edited === original && !text) {
      replaceText(el, shown, original);
      el.removeAttribute("data-fixes");
      if (existing) remove(existing);
      return;
    }
    replaceText(el, shown, edited);
    el.setAttribute("data-fixes", "pending");
    if (edited.includes("\n")) el.style.whiteSpace = "pre-wrap";
    const body = {
      url: location.href,
      path: here(),
      locale: document.documentElement.lang || "en",
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      original,
      edited,
      comment: text,
    };
    fetch(`${API}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.note) throw new Error(data.error || `HTTP ${r.status}`);
        notes = [...notes.filter((n) => n.id !== data.note.id), data.note];
        saveError = null;
        render();
      })
      .catch((e) => {
        // Nothing stays on the page that is not in the queue.
        replaceText(el, edited, shown);
        if (!existing) el.removeAttribute("data-fixes");
        saveError = `Not saved: ${e instanceof Error ? e.message : "network error"}`;
        render();
      });
  }

  // ---- events ----
  const onClick = (e) => {
    if (!on) return;
    const target = e.composedPath()[0];
    if (root.contains(target) || e.composedPath().includes(root)) return;
    if (editing) {
      if (editing.el.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      finish(true);
      return;
    }
    const el = textTarget(target, e.altKey);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    start(el, e.clientX, e.clientY);
  };
  const onMove = (e) => {
    if (!on || editing) return;
    const el = textTarget(e.target, e.altKey);
    setHover(el ? el.getBoundingClientRect() : null);
  };
  const onKey = (e) => {
    if (!editing) return;
    const target = e.composedPath()[0];
    const inField = editing.el.contains(target) || popover.contains(target);
    if (!inField) return;
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finish(true);
    }
  };
  const onScroll = () => {
    setHover(null);
    placePopover();
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);
  // Keeps the editor box on the element while its text grows.
  document.addEventListener("input", () => editing && placePopover(), true);

  $(".cancel").addEventListener("click", () => finish(false));
  $(".save").addEventListener("click", () => finish(true));
  $(".open").addEventListener("click", () => {
    listOpen = !listOpen;
    render();
  });
  toggleButton.addEventListener("click", () => {
    on = !on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {}
    if (!on) {
      if (editing) finish(false);
      setHover(null);
    }
    render();
    watch();
  });

  try {
    on = localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    on = true;
  }
  render();
  load().then(watch);
})();
