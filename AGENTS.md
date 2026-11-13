# AGENTS.md

For anyone working in this repository, people and AI agents alike. What the tool shows and where its data comes from
are in [README.md](README.md); the technical reasons behind the routing history, and what was measured, are in
[docs/history.md](docs/history.md). 1ms.dog's operations notes are in the private repository 1ms-shell.

## What this is

ASN Lookup answers "who owns this IP?" and "what is this AS?". It has three parts:

- **The data** (`scripts/data.mjs`): downloads RIPE NCC RIS, iptoasn.com, RIPE's asn.txt and the five RIRs'
  delegated files, and writes small shards into `public/data/` (not committed): the lookup shards, the name index,
  the leaderboards, the country and registry lists, the co-announced prefixes, and which registry allocated which
  address block and when. The site's build runs it once a day.
- **The site** (one Cloudflare Worker): pages and data are static assets in `public/` (`scripts/build.mjs` writes the
  templates, assets, robots.txt and sitemaps); `src/worker.js` renders the AS and address pages on request
  (`src/render.mjs`), plus the pages that are not one AS or one address — `/find`, `/today`, `/top`, `/moas`,
  `/country`, `/rir`, `/tools`, `/host/<domain>` — and answers `/api/*`. `src/app.js` is the browser script: it fills
  in the live parts (RDAP, neighbours, routing history, the AS health line) and runs the bulk lookup and prefix merge on
  `/tools`. Strings are in `src/i18n/<lang>.mjs`, ten languages.
- **The routing history** (`history/`, Go, standard library only): a separate program that runs once a day on a
  machine with a disk, keeps who announced what day by day with its RPKI state, and writes one JSON file per AS. The
  Worker fetches those files from `HISTORY_URL` (`/api/hist/<asn>`). Without it the site works the same, minus the
  routing-history card and rows.

## Run it locally

```bash
npm ci
npm run data     # once (about 20 s, about 100 MB); downloads in .cache/ are reused for a day
npm run build    # src/ → public/; commit public/ with your change (hashed file names: git add -A)
npm run dev      # http://localhost:8798 (wrangler dev: pages, API and static files)
```

The routing history locally: run the program, serve its output, and point the Worker at it.

```bash
cd history
go vet . && go run . -state ./st -out ./out                  # today, from the live sources
go run . -state ./st -out ./out -day 2026-01-02 -ris4 r4.gz  # a later day, from a file you edited, to test the merge
```

`./out` then holds `meta.json` and `as/<asn>.json`; serve it over HTTP and run `npx wrangler dev --var
HISTORY_URL:http://127.0.0.1:<port>/`.

## Test by what you changed

| You changed | Run |
|---|---|
| strings (`src/i18n/*.mjs`) | `npm run build && npm test` (every language has every key with the same placeholders; plural forms `key_one`, `key_few`, `key_many` are allowed beside a key). Read the sentence in Chinese and Russian at 375 px wide |
| the page (`src/app.js`, `render.mjs`, `page.html`, `style.css`) | `npm run build && npm test`, then open an AS page (`/AS13335`) and an address page (`/ip/1.1.1.1`) at full width and at 375 px |
| the Worker (`src/worker.js`, `ip.mjs`) | `npm test`, then the same two pages and the API routes it touches under `npm run dev` |
| the data (`scripts/data.mjs`) | `npm run data && npm test`, and look up an address and an AS whose numbers you know |
| the build (`scripts/build.mjs`, robots, sitemaps) | `npm test` (`public/ is up to date`) |
| the routing history (`history/`) | `go vet .` in `history/`; run two days locally (above) and read an AS file; on the server, the checks under "The routing history, self-hosted" |

`npm test` is what the deploy runs; it must pass.

## Deploy

- **The site**: pushing `main` deploys it (Cloudflare Workers Builds runs `npm ci && npm run data && npm test`, then
  `npx wrangler deploy`). By hand: `npm run data && npx wrangler deploy`. Bind your domain to the Worker in the
  Cloudflare dashboard; `wrangler.toml` turns off `*.workers.dev` and preview URLs.
- **Your own address**: `SITE_URL=https://<your-domain> npm run data && SITE_URL=https://<your-domain> npm run build`,
  and the same `SITE_URL` under `[vars]` in `wrangler.toml`.
- **Daily data**: `.github/workflows/refresh.yml` commits `data.stamp` once a day, and the push rebuilds the site.
  Without Workers Builds, run `npm run data && npx wrangler deploy` on a schedule.
- **The routing history**: by hand, as below; a push doesn't deploy it, it only publishes a new Release of the
  program when `history/` changed. Set `HISTORY_URL = ""` under `[vars]` to leave it out.

## The routing history, self-hosted

It needs a Linux machine with systemd and about 200 MB of memory and 1 GB of disk for it, and a way to publish a
directory read-only over HTTPS (any web server; the Worker fetches the files and keeps each until 04:30 UTC).

1. **A user and directories**
   ```bash
   useradd --system --no-create-home --shell /usr/sbin/nologin <user>
   mkdir -p /opt/<app> /srv/<data-dir> && chown <user>: /srv/<data-dir>
   ```
2. **The program**: download the published one (no Go needed), on the machine:
   ```bash
   cd /tmp
   curl -fLO https://github.com/yt1988/asn-lookup/releases/latest/download/asn-history
   curl -fLO https://github.com/yt1988/asn-lookup/releases/latest/download/SHA256SUMS
   sha256sum -c SHA256SUMS            # must print "asn-history: OK"
   install -o root -g root -m 755 asn-history /opt/<app>/asn-history
   ```
   Every change to `history/` that lands on `main` is built by `.github/workflows/history.yml` (static linux/amd64,
   `CGO_ENABLED=0 -trimpath -ldflags="-s -w"`) and published as the Release `server-<short commit>`, marked latest; an
   older one is at `releases/download/server-<short commit>/asn-history`. Or build it yourself, anywhere with Go:
   ```bash
   cd history
   CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o asn-history .
   ```
   and upload it to `/opt/<app>/asn-history`, owned by root, mode 755.
3. **The service and timer**: `history/1ms-asn-history.service` and `.timer` are 1ms.dog's; copy them under your own
   names and change `User`, `Group`, the paths in `ExecStart` and `ReadWritePaths`. Keep `MemoryMax=200M`,
   `GOMEMLIMIT=120MiB` and `StandardOutput=null` (only errors reach the journal). The timer's time must be before
   04:30 UTC, when the Worker lets its copies go.
4. `systemctl daemon-reload && systemctl enable --now <name>.timer`, then `systemctl start <name>` for a first run.
5. **Publish** `/srv/<data-dir>/` read-only with CORS (`Access-Control-Allow-Origin: *`) and a short cache, and set
   `HISTORY_URL = "https://<data-host>/<path>/"` (with the trailing slash) in `wrangler.toml`.

**Verify**: `cat /srv/<data-dir>/meta.json` (`day` is today, `took` and `peak_mb` that run's figures); then
`https://<your-domain>/api/hist/13335` returns that AS's file, and the AS page shows the routing-history card.

**Back up** `<state-dir>/state.bin.gz` (StateDirectory, about 5 MB): it is the whole history, and it can't be
downloaded again. The JSON files are made from it: with the state back in place, the next run writes them all again.

## Before you commit

- `npm run build`, then `git add -A` (asset names carry hashes, old ones are deleted).
- No 1ms.dog-only content in this repository (navigation, analytics, its own server's details): the 1ms.dog shell adds
  those, and its operations notes live in 1ms-shell.
- The "More from 1ms.dog" block in both READMEs is generated by 1ms-shell; don't edit it by hand.
