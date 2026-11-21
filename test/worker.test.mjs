// The Worker's cache: a rendered page is kept (isolate first, then the data center's cache), the visitor still gets
// no-cache with an ETag that answers a revalidation with a 304, and a new build or data day starts a fresh set.
// The data comes from public/ (npm run data); skipped on a bare checkout, like the sitemap tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const pub = path.join(ROOT, "public");
const built = existsSync(path.join(pub, "data/meta.json")) && existsSync(path.join(pub, "tpl/en.html"));
const skip = built ? false : "run npm run data first";

// ASSETS serves public/, and the count of files read shows whether a page was rendered or came from a cache
let reads = 0;
const assets = {
  async fetch(req) {
    reads++;
    const p = new URL(req.url).pathname;
    try {
      const b = await readFile(path.join(pub, p));
      return new Response(b, { status: 200, headers: { "content-type": p.endsWith(".json") ? "application/json" : "text/html", etag: '"' + p.length + '"' } });
    } catch { return new Response("Not found", { status: 404 }); }
  },
};
const entries = new Map();   // the data center's cache
globalThis.caches = { default: {
  async match(req) { return entries.get(req.url)?.clone(); },
  async put(req, res) { entries.set(req.url, res.clone()); },
} };
const worker = (await import("../src/worker.js")).default;

const pending = [];
const env = { ASSETS: assets };
const ctx = { waitUntil(p) { pending.push(p); } };
async function get(p, headers = {}, w = worker) {
  const res = await w.fetch(new Request("https://asn.1ms.dog" + p, { headers }), env, ctx);
  while (pending.length) await pending.shift();
  return res;
}

test("a page is rendered once and then served from the isolate's cache", { skip }, async () => {
  const a = await get("/AS13335");
  const before = reads;
  const b = await get("/AS13335");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(await b.text(), await a.text());
  assert.equal(reads, before, "the second request reads no shard or template");
  assert.equal(a.headers.get("x-cache"), "miss");
  assert.equal(b.headers.get("x-cache"), "hit");
  assert.equal(b.headers.get("cache-control"), "public, max-age=0, must-revalidate");
});

test("a tracking parameter on a page is not another copy of it", { skip }, async () => {
  await get("/AS13335");   // the entry every other test has made by now
  const before = entries.size;
  assert.equal((await get("/AS13335?utm_source=newsletter")).status, 200);
  assert.equal(entries.size, before, "the same page, not a second copy");
  // but the search word is part of the page
  const f1 = await get("/find?q=cloudflare"), f2 = await get("/find?q=china");
  assert.equal(f1.status, 200);
  assert.notEqual(await f1.text(), await f2.text());
  assert.equal(entries.size, before + 2);
});

test("the ETag answers a revalidation with a 304 without a body", { skip }, async () => {
  const a = await get("/ip/1.1.1.1");
  const r = await get("/ip/1.1.1.1", { "if-none-match": a.headers.get("etag") });
  assert.equal(r.status, 304);
  assert.equal(await r.text(), "");
  assert.equal(r.headers.get("etag"), a.headers.get("etag"));
});

test("a new data day is a new entry, not yesterday's page", { skip }, async () => {
  const meta = JSON.parse(await readFile(path.join(pub, "data/meta.json"), "utf8"));
  const stale = { ...meta, at: "2026-01-01T00:00:00Z" };
  const old = assets.fetch;
  assets.fetch = async req => new URL(req.url).pathname === "/data/meta.json"
    ? new Response(JSON.stringify(stale), { status: 200, headers: { "content-type": "application/json" } })
    : old(req);
  // a fresh isolate: the memoized meta and the page cache are module state
  const w2 = (await import("../src/worker.js?day=" + Date.now())).default;
  try {
    const r = await get("/AS13335", {}, w2);
    assert.equal(r.status, 200);
    const hit = [...entries.keys()].some(k => k.includes("__pc=") && decodeURIComponent(k).includes("2026-01-01"));
    assert.ok(hit, "an entry keyed by the different day");
  } finally { assets.fetch = old; }
});

test("the JSON lookups are kept in the data center's cache", { skip }, async () => {
  const a = await get("/api/ip/8.8.8.8");
  const j = await a.json();
  const before = reads;
  const b = await get("/api/ip/8.8.8.8");
  assert.equal(b.status, 200);
  assert.deepEqual(await b.json(), j);
  assert.equal(reads, before);
  assert.match(b.headers.get("x-cache") || "", /^hit/);
});

test("the pages a browser gets are still no-cache, and unknown paths stay a plain 404", { skip }, async () => {
  const a = await get("/top");
  assert.equal(a.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  const n = await get("/no/such/path");
  assert.equal(n.status, 404);
  assert.equal((await n.text()), "Not found");
});
