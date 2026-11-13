# The routing history: why it is built this way

What `history/` does and the files it writes are in [history/README.md](../history/README.md); how to run it is in
[AGENTS.md](../AGENTS.md). This page is the reasoning behind it and what was measured (November 2026, on a 2-core,
1 GB Linux VM).

## Why a separate program on a machine with a disk

- **RIPEstat's own history is too large to ask when a page opens.** `routing-history` for AS4134 returned 38 MB in
  52 s; for AS13335, 46 MB in 39 s. A Worker can't wait for that, and caching it per AS would still make the first
  visitor wait.
- **A Workers build keeps nothing between runs.** Each daily build starts from an empty machine, so it can't compare
  today with yesterday. Something has to keep yesterday.
- **Current RPKI state alone would not need the machine**: the build could download the VRPs. Keeping how the state
  changed does.

## Sources and rules

- **RIS riswhoisdump** (IPv4 about 5.7 MB, IPv6 about 1.3 MB gzipped): origin AS, prefix and how many RIS peers see
  it. A prefix counts when at least 10 peers see it, as in `scripts/data.mjs`, so the counts match the AS page. Origins
  that are AS sets are left out. IPv6 prefixes longer than /64 are left out; at 10 peers there are none.
- **rpki-client's VRP export** (`rpki.cloudflare.com/rpki.json`, about 1.03 million VRPs): 107 MB as JSON, about
  5 MB when fetched gzipped. It is read one ROA at a time, never held whole.
- **RPKI validation is RFC 6811**: a route is valid when a VRP covering its prefix has its origin (not AS0) and a max
  length at least the route's length; invalid when VRPs cover it but none matches; not found when none covers it. The
  VRPs are sorted by prefix, and for each route only the prefix lengths that occur in the VRPs are tried.
- **Upstream changes are not kept**: riswhoisdump has origins only, no AS paths. Upstreams would need RIS's full
  table dumps (MRT), far heavier.

## What is kept

- **Each (prefix, origin AS) as intervals of days.** A route seen on the last run goes on; one not seen then starts a
  new interval. "The last run", not "yesterday": a missed day doesn't read as everything going away and coming back.
  Running twice on one day changes nothing.
- **Its RPKI state on its last day, and the day that state began.**
- **Each AS's IPv4 and IPv6 prefix counts, a point on each day they changed**, for 400 days, plus the last point
  before the window (what the count was when it opens).
- **A run with too little data stops before keeping anything** (under 500,000 IPv4 routes, 50,000 IPv6 routes or
  200,000 VRPs): a download cut short would otherwise read as half the Internet going away.
- **Every file is written to a temporary name and renamed**, so a reader never sees half a file. Only the state is
  synced to disk before the rename; the AS files are written again by every run. Syncing all 87,000 took several
  minutes instead of seconds.
- **The run's totals in `meta.json`**: routes announced, added and gone since the run before, VRPs, ASes, and when
  each source was made. The site's `/today` page reads them (and the newest allocations from the build's own data),
  so it costs the Worker one more small fetch, cached until 04:30 UTC like the AS files.

## Memory, measured

The program's limit is 200 MB. The process's own peak (VmHWM), on 1.41 million routes and 1.03 million VRPs:

| Version | First day | Second day (with a history to merge) |
|---|---|---|
| first try: every AS file built in memory, then written | 830 MB (Windows, rough) | — |
| AS files written one at a time; 32-byte routes; gob state | 175 MB | — |
| 24-byte routes, 16-byte routes for today, VRPs let go before the history is loaded, the state streamed | 113 MB | 151 MB |

What made the difference:

- **Write one AS file at a time.** The routes are ordered by AS through an index (4 bytes a route), and each file is
  built, written and dropped.
- **Spell the prefix out in the route.** A route with a prefix struct inside was 32 bytes with padding; with its fields
  laid out flat it is 24 (today's routes, without days, are 16).
- **Order the work**: read today's routes and check them against the VRPs first, drop the VRPs, and only then load
  the history and merge. The VRPs and the history are never in memory together.
- **No gob.** gob encodes a value whole in memory before writing it; the state is now a plain binary stream (20 bytes
  a route), read straight into a slice of the right size.
- `GOMEMLIMIT=120MiB` makes the collector work harder near the top. systemd's "memory peak" for the service reads
  200M because it counts the page cache of the downloads and the files written; that cache is given back, the
  process itself is the figure above.

## How long to keep routes that went away: the estimate

While merging, the history is in memory twice (the old slice and the new one), so **each interval costs about
48 bytes**. The history grows by one interval for every route that starts (a new one, or one back after going away),
and shrinks only when old ones pass the retention, so:

```
extra memory after N days ≈ (intervals added per day) × N × 48 bytes
```

`meta.json` gives the numbers: `kept` (intervals in the history), `added` and `gone` (since the last run). The
average growth per day is `(kept today − kept on the first day) ÷ days`. Examples: 2,000 a day kept 730 days is about
1.46 million intervals, about 70 MB more; 5,000 a day is about 175 MB more, past the limit. Kept 180 days, the same
5,000 a day is about 43 MB.

The routes that went away are used only for an AS's "stopped announcing" events and an address's earlier origins. The
retention is the constant `keep` in `history/main.go`; shortening it drops the older intervals on the next run.

## Disk

87,039 AS files hold 77 MB, but take 381 MB on disk: most are under 4 KB and each takes a whole block. They grow
only for ASes whose counts change often (at most 400 points, about 25 bytes each) and with earlier origins; about
0.5 GB after a year is a fair guess. The state is about 5 MB gzipped. About 12 MB is downloaded a day.
