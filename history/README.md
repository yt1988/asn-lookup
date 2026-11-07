# asn-history

The routing history behind ASN Lookup: once a day it reads who announces what, as RIPE NCC's route collectors see it,
and the RPKI ROAs, compares them with the last run and keeps only the changes. The AS and address pages show what it
writes: since when a prefix is announced, its RPKI state and since when, other ASes announcing it now or before, the
latest prefixes an AS started or stopped announcing, and its prefix counts over the last 400 days.

It runs on a machine with a disk, apart from the Worker: it needs to keep yesterday, which a Workers build can't. Why,
and what was measured: [docs/history.md](../docs/history.md).

## Sources

| Source | What |
|---|---|
| [RIPE NCC RIS](https://ris.ripe.net/) riswhoisdump (IPv4, IPv6) | origin AS of each prefix; a prefix counts when at least 10 RIS peers see it (as `scripts/data.mjs`) |
| [rpki-client](https://www.rpki-client.org/)'s VRP export, [rpki.cloudflare.com/rpki.json](https://rpki.cloudflare.com/rpki.json) | the validated ROAs; a route is valid, invalid or not found as in RFC 6811 |

About 12 MB downloaded a day (the VRPs come gzipped).

## What it writes

`-out` (published read-only over HTTPS; the Worker's `HISTORY_URL` points at it):

```
meta.json        since (the first day recorded), day (the last run), at, ris and vrp_at (when the sources were made),
                 routes (announced today), added and gone (since the last run), kept (intervals in the history:
                 what the memory grows with), vrps, ases, took, peak_mb
as/<asn>.json    one per AS with any history
```

An AS file, every date `YYYY-MM-DD`:

```js
{
  "as": 13335, "since": "2026-11-04", "day": "2026-11-05",
  "n": [["2026-11-04", 1520, 260], …],          // IPv4 and IPv6 prefix counts, a point on each day they changed
  "ev": [["2026-11-05", 1, "203.0.113.0/24"], …],  // newest first, at most 60: 1 started announcing, 0 stopped
  "rpki": [12, 1500, 3],                         // its announced routes now: not found, valid, invalid
  "px": {                                        // every prefix it announces now
    "1.1.1.0/24": ["2026-11-04", "v", "2026-11-04", [64500], [[64501, "2026-11-04", "2026-11-04"]]]
    //             announced since, RPKI (v valid, i invalid, n not found), in that state since,
    //             other origin ASes now, earlier other origins [as, first day, last day] (both only when there are)
  }
}
```

"Since" dates equal to `since` mean "already there when the records began".

## State

`-state/state.bin.gz` (about 5 MB, the only copy of the history: back it up): every (prefix, origin) as intervals of
days, its RPKI state and since when, and the count points. A route gone for two years and count points older than 400
days are dropped. Every file is written to a temporary name and renamed over the old one.

## Build and run

Building, installing it as a systemd service and timer, and verifying it: [AGENTS.md](../AGENTS.md), "The routing
history, self-hosted". Only errors are logged; each run's figures are in `meta.json`.

To try it on any machine: `go run . -state ./st -out ./out` (or `-ris4`, `-ris6`, `-vrp` with local files, and `-day
YYYY-MM-DD` to play several days).
