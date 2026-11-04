# asn-history

The routing history behind asn.1ms.dog: once a day it reads who announces what, as RIPE NCC's route collectors see it,
and the RPKI ROAs, compares them with the last run and keeps only the changes. The AS and address pages show what it
writes: since when a prefix is announced, its RPKI state and since when, other ASes announcing it now or before, the
latest prefixes an AS started or stopped announcing, and its prefix counts over the last 400 days.

It runs on the 1ms.dog server (a VPS in Tokyo): it needs a disk that keeps yesterday, which a Workers build doesn't
have, and RIPEstat's own history is too large to ask live (AS4134: 38 MB, 52 seconds).

## Sources

| Source | What |
|---|---|
| [RIPE NCC RIS](https://ris.ripe.net/) riswhoisdump (IPv4, IPv6) | origin AS of each prefix; a prefix counts when at least 10 RIS peers see it (as `scripts/data.mjs`) |
| [rpki-client](https://www.rpki-client.org/)'s VRP export, [rpki.cloudflare.com/rpki.json](https://rpki.cloudflare.com/rpki.json) | the validated ROAs; a route is valid, invalid or not found as in RFC 6811 |

About 12 MB downloaded a day (the VRPs come gzipped).

## What it writes

`-out` (on the server `/srv/1ms-data/asn/`, published read-only at `https://data.1ms.dog:2083/asn/`):

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

`-state` (on the server `/var/lib/1ms-asn-history/state.gob.gz`, about 15 MB): every (prefix, origin) as intervals of
days, its RPKI state and since when, and the count points. A route gone for two years and count points older than 400
days are dropped. Every file is written to a temporary name and renamed over the old one.

## On the server

Assigned in 1ms-shell `docs/processes.md` ("专用服务器"): user `1ms-asn`, binary in `/opt/1ms/asn/`, service
`1ms-asn-history` (oneshot, `MemoryMax=200M`), timer at 03:40 UTC. Only errors are logged; each run's figures are in
`meta.json`.

```sh
# build (anywhere with Go), then upload asn-history and the two units with sftp
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o asn-history .
install -m 755 asn-history /opt/1ms/asn/asn-history
cp 1ms-asn-history.service 1ms-asn-history.timer /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now 1ms-asn-history.timer
systemctl start 1ms-asn-history     # a run now
cat /srv/1ms-data/asn/meta.json
```

To try it on any machine: `go run . -state ./st -out ./out` (or `-ris4`, `-ris6`, `-vrp` with local files, and `-day
YYYY-MM-DD` to play several days).
