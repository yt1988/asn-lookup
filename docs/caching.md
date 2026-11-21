# How answers are cached, and why

The Worker renders every AS and address page on request, and the live parts of a page (RDAP, neighbours, the routing
history) are fetched when the page opens. Both are cached, because on asn.1ms.dog 92% of the requests are HTML pages
asked for once — mostly crawlers walking the ~124,000 AS pages in the sitemaps — and the same handful of pages are
asked for again and again by everyone else.

This page is the design and the measurements behind it. The code is `src/worker.js`; `test/worker.test.mjs` pins the
rules.

## What is kept where

| What | Where | Key | Lifetime |
|---|---|---|---|
| A rendered page | the isolate's LRU (16 MB), then the data center's cache | path + the meaningful query (`q`, `host`) + a build stamp + the data's day | until the next deploy or the next day's data |
| A JSON answer (`/api/ip`, `/api/as`, `/api/find`, `/api/host`, `/api/top`, `/api/moas`, `/api/rdap/*`, `/api/nb`, `/api/hist`) | the isolate's LRU (8 MB), then the data center's cache | the request URL | 5 minutes to a day, per endpoint; the routing history until the next daily run |
| A data shard (`/data/...`) | the isolate's LRU (32 MB, least recently used) | the file name | until the isolate goes away; `/data/meta.json` and the templates are re-read every 5 minutes |
| The language tables | a lazy module per language | the language | loaded when a page in that language is first rendered |

Nothing is written to the Cache API on a first sighting. A copy is written on the **second** sighting of the same URL
within an isolate, and the Cache API is consulted only when the isolate has lost its own copy (least recently used).
An isolate's own copy answers every repeat before that.

## Why "second sighting"

Writing every miss measured *worse* than not caching: on 2026-11-21, against 2.58 ms of CPU a request with no page or
JSON cache, writing each miss took the average to 3.34 ms (+29%), because a crawler asks for each page once and the
writes bought nothing. With a copy written only on the first repeat, the same hour came in at **2.32 ms** — below the
uncached figure — while the isolate's LRU still answered the repeats (60 consecutive requests to one page: 56 hits,
4 misses).

The data center's Cache API is cheap to read but not to write, and on 1ms.dog a page is reached through the shell's
service binding, where the cache is per data center. A cache copy is therefore written only where a repeat has already
shown the page is worth one.

## Keys: a deploy or a new day must never serve an older page

A rendered page is keyed by its path (plus `/find`'s `q` and `/ip`'s `host`; other query strings are someone's tracking
parameter and do not make another copy), the build stamp and the data's day:

- **Build stamp**: `scripts/build.mjs` hashes every file in `src/` and writes `<!-- build:<hash> -->` into each
  template. A deploy changes it, so a page rendered by older code is never served — including when only `src/worker.js`
  or `src/render.mjs` changed and no asset hash moved.
- **Data day**: `data/meta.json`'s `at`. A new day's data starts a fresh set.

`/today` adds the time of the next routing-history run to its key, so the page cannot outlive the run it describes.

## What the browser is told

The pages a visitor gets are still `Cache-Control: public, max-age=0, must-revalidate` with an ETag, exactly as before
caching (see `docs/tool-contract.md` in the operations repository for why HTML is never cached by the browser). A
returning browser revalidates and the Worker answers **304 without rendering** — the ETag check happens before the
page is built.

## Not cached

- `/api/me` — it is the visitor's own address, `no-store`.
- `/host/<domain>` — the page holds live DNS answers and is rendered on every request. (`/api/host` keeps its answer
  for five minutes, and the browser was already told to keep it that long.)

A reverse proxy in front of the Worker may rewrite `Cache-Control` on what it caches; that is outside this Worker and
outside this repository.
