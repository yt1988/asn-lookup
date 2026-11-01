# ASN Lookup

**English** · [简体中文](README.zh-CN.md)

Who owns this IP? Who is AS4134? [ASN Lookup](https://asn.1ms.dog) gives every IP address and every AS number a page: the AS announcing it, the prefix holding it, the registry record, and for each AS every IPv4 and IPv6 prefix, its upstreams and downstreams, and the other ASNs of the same holder.

**Use it:** https://asn.1ms.dog

## What you get

- **Any IP or prefix** (`/ip/8.8.8.8`, `/ip/1.0.0.0/24`): the AS announcing it, the announced prefix holding it, the range, the country; the registry's RDAP record (network name, organization, abuse e-mail) and reverse DNS.
- **Any AS** (`/AS4134`): name, holder, country, registry and allocation date; how many prefixes and addresses it announces; every prefix (copy them all in one click, for a firewall or proxy rules); the upstreams, downstreams and peers RIPE's collectors see; other ASNs of the same holder.
- **A domain**: type it in the search box and it is resolved, then looked up.
- **Your own IP**: the home page shows the AS and prefix of your connection.

Every AS page is rendered on the server, complete in the HTML, in 10 languages, and listed in the sitemaps (about 88,000 routed ASes).

## Data

| Source | What | When |
|---|---|---|
| [RIPE NCC RIS](https://ris.ripe.net/) (riswhoisdump) | the prefixes each AS announces; a prefix counts when at least 10 RIS peers see it | at build |
| [iptoasn.com](https://iptoasn.com/) (PDDL, public domain) | address to AS | at build |
| RIPE NCC [asn.txt](https://ftp.ripe.net/ripe/asnames/asn.txt) | every allocated AS number's name and country | at build |
| The five RIRs' delegated-extended files | registry, allocation date, and AS numbers of the same holder | at build |
| RDAP (rdap.arin.net, redirecting to the right RIR) | organization, abuse e-mail, last change | when a page opens, cached a day |
| [RIPEstat](https://stat.ripe.net/) asn-neighbours | upstreams, downstreams, peers | when a page opens, cached a day |
| Cloudflare / Google DNS over HTTPS | reverse DNS, domains | live |

`npm run data` downloads the files above and writes shards to `public/data/` (not committed):

```
data/as/<n>.json      AS numbers n*100 … n*100+99: name, country, RIR, date, sibling ASNs, the first 100 prefixes
data/px/<asn>.json    every prefix of an AS with more than 100
data/names/<n>.json   names of AS numbers n*1000 … n*1000+999 (for neighbour lists)
data/ip4/<a>.bin      IPv4 ranges starting with a: Uint32 triples (first, last, AS)
data/ip6/<h>.bin      IPv6 ranges starting with h: first 64 bits (first, last) and AS
```

The Worker reads only these static files; a request parses one or two small shards.

## API

```
GET /api/me                 your own address
GET /api/ip/<address>       the AS announcing it, the prefix, the range
GET /api/as/<asn>           the AS's record with every prefix
GET /api/rdap/as/<asn>      the registry record (RDAP)
GET /api/rdap/ip/<address>  the registry record and reverse DNS
GET /api/nb/<asn>           upstreams, downstreams and peers (top 8 each) with counts
```

All JSON, with CORS.

## Self-hosting

```bash
git clone https://github.com/yt1988/asn-lookup
cd asn-lookup
npm install
npm run data        # download and build the lookup data (about 20 s, about 100 MB)
npx wrangler login
npx wrangler deploy
```

One Worker: pages and data are static assets (free, unmetered); `src/worker.js` renders the AS and address pages and answers `/api/*`. `wrangler.toml` turns off `*.workers.dev` and preview URLs; bind your own domain under **Workers & Pages → asn-lookup → Settings → Domains & Routes**, or set `workers_dev = true` to try it.

For canonical links, hreflang and sitemaps on your own domain:

```bash
SITE_URL=https://asn.example.com npm run data
SITE_URL=https://asn.example.com npm run build
```

and set the same `SITE_URL` under `[vars]` in `wrangler.toml`.

**Daily data**: `.github/workflows/refresh.yml` commits `data.stamp` once a day, and the push makes Cloudflare Workers Builds rebuild (build command `npm ci && npm run data && npm test`). Without Workers Builds, run `npm run data && npx wrangler deploy` on a schedule.

## Development

```bash
npm run data     # once; downloads in .cache/ are reused for a day
npm run build    # the pages, templates and assets in public/
npm run dev      # http://localhost:8798
npm test         # public/ up to date + unit tests
npm run og       # link-preview images and icons
```

## License

MIT. The data follows its sources' terms: RIPE NCC's [terms of use](https://www.ripe.net/about-us/legal/ripestat-service-terms-and-conditions/) for RIPE NCC data, PDDL 1.0 for iptoasn.com.
