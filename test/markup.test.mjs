// The icons a browser script builds at runtime (#146 一.3). An <svg> written into a template string is parsed into the
// SVG namespace like any other, but the namespace is not an attribute, so `outerHTML` drops it — and an extension that
// reloads a copy of the icon as an image (Safari's Dark Reader) cannot decode one without it. Icons in HTML markup are
// the shell's to fix on the way out (docs/tool-contract.md §3); the ones the page's own script writes are ours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const read = f => readFile(new URL("../" + f, import.meta.url), "utf8");

test("every svg the browser script writes says which namespace it is in", async () => {
  const src = await read("src/app.js");
  const tags = [...src.matchAll(/<svg\b[^>]*>/g)].map(m => m[0]);
  assert.ok(tags.length, "the script writes no svg at all: has the chart moved?");
  const bare = tags.filter(t => !t.includes(NS));
  assert.deepEqual(bare, [], "an svg without xmlns cannot be reloaded as an image");
});
