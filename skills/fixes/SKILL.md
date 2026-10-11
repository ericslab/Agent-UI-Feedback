---
name: fixes
description: Implement every pending note left on the running app with the fixes tool (click and comment): copy edits made in place and comments on the page, queued in fixes.json. Triggers: "/fixes", "go through my feedback", "implement my notes".
---

# Fixes

The fixes tool is loaded into the app in development. The reader clicks text on a page, rewrites it in place and adds a comment. Each save is queued as a note in `fixes.json` at the project root (or the file the notes server was started with).

A note holds `status` (`pending` or `done`), `path` and `url` (the page), `locale` (the `lang` of the page), `tag` and `selector` (the element), `original` (the text the page showed), `edited` (the text wanted) and `comment` (an instruction, can be empty).

## Procedure

1. Read `fixes.json` and take every note with `status: "pending"`. With none, say there are no pending notes and stop.
2. Find where `original` comes from. Search the source for the fixed words of the text; placeholders such as `{amount}` or `{count}` are already filled in on the page, so match on the words around the values. When the project keeps its strings in message or translation files, the text is there; otherwise it is in a component or template.
3. Write the new copy from `edited`. A blank line inside `edited` is a paragraph break: split the string into separate paragraphs (separate keys and elements) at each blank line. Then follow `comment` when there is one (a note can carry only a comment). Fix spelling, grammar and punctuation, keep a placeholder wherever the edited text still shows its value, and follow the project's copy rules.
4. When the project is translated, put the same change into every other language file, translated. A note left in another language changes that language's string and the source language to match.
5. A note whose text does not come from the code (database rows, user content), or whose comment cannot be done in the source, stays pending; name it and the reason in the reply.
6. Set each implemented note to `status: "done"` with `doneAt` (ISO time), editing the JSON with a short `node -e` script. Never remove notes from the file.
7. Run the project's type check or build.
8. Reply with one line per note: the page and the new text, then the notes left pending with their reason.
