#!/usr/bin/env node
// Builds the lookup data in public/data/ (not committed: run before deploying) from these public sources:
//   iptoasn.com ip2asn-combined.tsv.gz   which AS announces each address range (PDDL 1.0, refreshed hourly)
//   RIPE NCC RIS riswhoisdump            the prefixes each AS announces, as RIPE's route collectors see them
//   RIPE NCC asn.txt                      every allocated AS number's name and country
//   the five RIRs' delegated-extended     which registry allocated each AS number, when, and to which holder
// and writes
//   data/as/<n>.json        AS numbers n*100 … n*100+99: name, country, registry, date, sibling ASNs, prefixes (the first
//                           SHOWN of each family)
//   data/px/<asn>.json      every prefix of an AS that has more than SHOWN in a family
//   data/names/<n>.json     AS numbers n*1000 … n*1000+999: [name, country]
//   data/ip4/<a>.bin        IPv4 ranges starting with octet a: Uint32 triples (first, last, asn), sorted
//   data/ip6/<h>.bin        IPv6 ranges starting with hextet h: Uint32 × 5 (first 64 bits as hi, lo; last as hi, lo; asn)
//   data/meta.json          counts and when the data was made
//   sitemap.xml, sitemaps/  every announced AS's page in every language (with the language pages)
// Downloads are kept in .cache/ for a day, so reruns are quick.
// Usage: node scripts/data.mjs
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { LANGS } from "../src/langs.mjs";
import { v6big, v4num, parseCidr } from "../src/ip.mjs";

const SITE = (process.env.SITE_URL || "https://asn.1ms.dog").replace(/\/+$/, "");
const root = new URL("../", import.meta.url), pub = new URL("public/", root), cache = new URL(".cache/", root);
const UA = "asn-lookup data build (+https://github.com/yt1988/asn-lookup)";
export const BUCKET = 100;
export const SHOWN = 100;
const SIBLINGS = 24;      // sibling ASNs kept per AS (same holder at the registry)
const SEEN = 10;          // a prefix counts when at least this many RIS peers see it (as RIPEstat does)

const SOURCES = {
  ip2asn: "https://iptoasn.com/data/ip2asn-combined.tsv.gz",
  asnames: "https://ftp.ripe.net/ripe/asnames/asn.txt",
  ris4: "https://www.ris.ripe.net/dumps/riswhoisdump.IPv4.gz",
  ris6: "https://www.ris.ripe.net/dumps/riswhoisdump.IPv6.gz",
  apnic: "https://ftp.apnic.net/stats/apnic/delegated-apnic-extended-latest",
  ripencc: "https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest",
  arin: "https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest",
  lacnic: "https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-extended-latest",
  afrinic: "https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-extended-latest",
};

async function get(id) {
  const f = new URL(id, cache);
  try { if (Date.now() - (await stat(f)).mtimeMs < 86400e3) return await readFile(f); } catch (e) {}
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(SOURCES[id], { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(180e3) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const b = Buffer.from(await r.arrayBuffer());
      await mkdir(cache, { recursive: true }); await writeFile(f, b);
      return b;
    } catch (e) {
      if (i >= 2) throw new Error(`${SOURCES[id]}: ${e.message}`);
      await new Promise(ok => setTimeout(ok, 3000 * (i + 1)));
    }
  }
}

// "4134 CHINANET-BACKBONE No.31,Jin-rong Street, CN" → { h: "CHINANET-BACKBONE", n: "No.31,Jin-rong Street", cc: "CN" }
export function parseName(s) {
  let m = s.match(/^(.*?),\s*([A-Z]{2}|EU|AP|ZZ)\s*$/), cc = null;
  if (m) { s = m[1]; cc = /^[A-Z]{2}$/.test(m[2]) && m[2] !== "ZZ" ? m[2] : null; }
  s = s.trim();
  m = s.match(/^(\S+)\s+(?:-\s+)?(.*)$/);
  const h = m ? m[1] : s, n = m ? m[2].trim() : "";
  return { h, n: n === h ? "" : n, cc };
}

export async function build() {
  const t0 = Date.now();
  const [tsvGz, names, ris4, ris6, ...dele] = await Promise.all(["ip2asn", "asnames", "ris4", "ris6", "apnic", "ripencc", "arin", "lacnic", "afrinic"].map(get));
  console.log(`downloaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const AS = new Map();       // asn → record
  const rec = a => { let r = AS.get(a); if (!r) AS.set(a, r = { p4: [], p6: [], c4: 0, c6: 0 }); return r; };

  for (const line of names.toString("utf8").split("\n")) {
    const m = line.match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const { h, n, cc } = parseName(m[2]);
    Object.assign(rec(+m[1]), { h, n, cc });
  }

  // registries: who allocated each AS number and when; the opaque id ties a holder's numbers together
  const holders = new Map();
  for (const buf of dele) for (const line of buf.toString("utf8").split("\n")) {
    const f = line.split("|");
    if (f[2] !== "asn" || !/^\d+$/.test(f[3]) || !/^(allocated|assigned)$/.test(f[6])) continue;
    const rir = f[0] === "ripencc" ? "RIPE" : f[0].toUpperCase(), start = +f[3], count = +f[4];
    const d = /^\d{8}$/.test(f[5]) ? `${f[5].slice(0, 4)}-${f[5].slice(4, 6)}-${f[5].slice(6, 8)}` : null;
    const key = f[7] ? rir + "|" + f[7] : null;
    for (let a = start; a < start + count && a - start < 100000; a++) {
      const r = rec(a);
      r.r = rir; if (d) r.d = d; if (!r.cc && /^[A-Z]{2}$/.test(f[1]) && f[1] !== "ZZ") r.cc = f[1];
      if (key) { let s = holders.get(key); if (!s) holders.set(key, s = []); s.push(a); r.k = key; }
    }
  }

  // routed ranges: per AS prefixes, and the address shards
  const v4 = Array.from({ length: 256 }, () => []), v6 = new Map();
  let rows = 0;
  for (const line of gunzipSync(tsvGz).toString("utf8").split("\n")) {
    const f = line.split("\t");
    if (f.length < 3) continue;
    const asn = +f[2];
    if (!asn) continue;          // 0: not routed
    rows++;
    const r = rec(asn);
    if (!r.h && f[4] && f[4] !== "Not routed") Object.assign(r, parseName(f[4] + (f[3] && f[3] !== "None" ? ", " + f[3] : "")), r.cc ? { cc: r.cc } : {});
    if (f[0].includes(":")) {
      const a = v6big(f[0]), b = v6big(f[1]);
      if (a === null || b === null) continue;
      r.c6 += Number(((b - a) >> 80n) + 1n);
      // the shards keep the first 64 bits; a range is split where its first hextet changes
      let s = a >> 64n; const e = b >> 64n;
      while (s <= e) {
        const h = Number(s >> 48n), end = ((BigInt(h) + 1n) << 48n) - 1n, last = e < end ? e : end;
        let arr = v6.get(h); if (!arr) v6.set(h, arr = []);
        arr.push([Number(s >> 32n), Number(s & 0xffffffffn), Number(last >> 32n), Number(last & 0xffffffffn), asn]);
        s = last + 1n;
      }
    } else {
      const a = v4num(f[0]), b = v4num(f[1]);
      if (a === null || b === null) continue;
      r.c4 += b - a + 1;
      for (let s = a; s <= b;) {
        const o = s >>> 24, last = Math.min(b, ((o + 1) * 2 ** 24) - 1);
        v4[o].push([s, last, asn]);
        s = last + 1;
      }
    }
  }
  // announced prefixes, per origin AS (AS sets like {1,2} are left out)
  let pfx = 0;
  for (const [buf, key] of [[ris4, "p4"], [ris6, "p6"]]) {
    const seen = new Set();
    for (const line of gunzipSync(buf).toString("utf8").split("\n")) {
      const f = line.split("\t");
      if (f.length < 3 || !/^\d+$/.test(f[0]) || +f[2] < SEEN) continue;
      const c = parseCidr(f[1]);
      if (!c || c.len === 0 || seen.has(f[0] + " " + f[1])) continue;
      seen.add(f[0] + " " + f[1]);
      rec(+f[0])[key].push(c.ip + "/" + c.len);
      pfx++;
    }
  }
  const k4 = p => { const [ip, l] = p.split("/"); return v4num(ip) * 64 + +l; };
  const k6 = p => { const [ip, l] = p.split("/"); return v6big(ip) * 256n + BigInt(l); };
  for (const r of AS.values()) {
    if (r.p4.length > 1) r.p4 = r.p4.map(p => [k4(p), p]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    if (r.p6.length > 1) r.p6 = r.p6.map(p => [k6(p), p]).sort((a, b) => a[0] < b[0] ? -1 : 1).map(x => x[1]);
  }
  console.log(`${rows} routed ranges, ${pfx} announced prefixes, ${AS.size} AS numbers`);

  await rm(new URL("data/", pub), { recursive: true, force: true });
  await rm(new URL("sitemaps/", pub), { recursive: true, force: true });
  for (const d of ["data/as/", "data/px/", "data/names/", "data/ip4/", "data/ip6/", "sitemaps/"]) await mkdir(new URL(d, pub), { recursive: true });

  for (let o = 0; o < 256; o++) {
    if (!v4[o].length) continue;
    const a = new Uint32Array(v4[o].length * 3);
    v4[o].sort((x, y) => x[0] - y[0]).forEach((r, i) => a.set(r, i * 3));
    await writeFile(new URL(`data/ip4/${o}.bin`, pub), Buffer.from(a.buffer));
  }
  for (const [h, list] of v6) {
    const a = new Uint32Array(list.length * 5);
    list.sort((x, y) => x[0] - y[0] || x[1] - y[1]).forEach((r, i) => a.set(r, i * 5));
    await writeFile(new URL(`data/ip6/${h.toString(16)}.bin`, pub), Buffer.from(a.buffer));
  }

  // AS records, a hundred numbers a file
  const announced = [];
  const buckets = new Map();
  for (const [a, r] of [...AS].sort((x, y) => x[0] - y[0])) {
    if (!r.h && !r.r && !r.p4.length && !r.p6.length) continue;
    if (a >= 4200000000 || (a >= 64512 && a <= 65535) || a === 23456) continue;   // private and reserved
    const out = {};
    if (r.h) out.h = r.h;
    if (r.n) out.n = r.n;
    if (r.cc) out.cc = r.cc;
    if (r.r) out.r = r.r;
    if (r.d) out.d = r.d;
    if (r.k) {
      const sib = holders.get(r.k).filter(x => x !== a);
      if (sib.length) {
        // announced ones first, then by number
        const routed = x => { const s = AS.get(x); return s && (s.p4.length || s.p6.length) ? 0 : 1; };
        out.o = sib.sort((x, y) => routed(x) - routed(y) || x - y).slice(0, SIBLINGS).map(x => [x, (AS.get(x) || {}).h || ""]);
        if (sib.length > SIBLINGS) out.on = sib.length;
      }
    }
    if (r.p4.length || r.p6.length || r.c4 || r.c6) {
      out.c4 = r.c4; out.c6 = r.c6; out.n4 = r.p4.length; out.n6 = r.p6.length;
      // a long list goes in a file of its own: the AS file keeps the first SHOWN of each, which the page lists
      out.p4 = r.p4.slice(0, SHOWN); out.p6 = r.p6.slice(0, SHOWN);
      if (r.p4.length > SHOWN || r.p6.length > SHOWN) { out.x = 1; await writeFile(new URL(`data/px/${a}.json`, pub), JSON.stringify({ p4: r.p4, p6: r.p6 })); }
      announced.push(a);
    }
    const b = Math.floor(a / BUCKET);
    let m = buckets.get(b); if (!m) buckets.set(b, m = {});
    m[a] = out;
  }
  // names only, a thousand numbers a file (neighbour lists look up many ASNs at once)
  const byName = new Map();
  for (const m of buckets.values()) for (const a in m) if (m[a].h) {
    const b = Math.floor(a / 1000);
    let x = byName.get(b); if (!x) byName.set(b, x = {});
    x[a] = [m[a].h, m[a].cc || ""];
  }
  for (const [b, x] of byName) await writeFile(new URL(`data/names/${b}.json`, pub), JSON.stringify(x));
  let bytes = 0, biggest = 0;
  for (const [b, m] of buckets) {
    const s = JSON.stringify(m);
    bytes += s.length; biggest = Math.max(biggest, s.length);
    await writeFile(new URL(`data/as/${b}.json`, pub), s);
  }
  console.log(`${buckets.size} AS files, ${(bytes / 1e6).toFixed(1)} MB, largest ${(biggest / 1e3).toFixed(0)} KB; ${announced.length} announced`);

  const at = new Date().toISOString();
  await writeFile(new URL("data/meta.json", pub), JSON.stringify({ at, announced: announced.length, numbers: [...buckets.values()].reduce((n, m) => n + Object.keys(m).length, 0), ranges: rows, sources: SOURCES }));

  // sitemaps: the language pages with their alternates, then every announced AS per language (50,000 URLs a file at most)
  const day = at.slice(0, 10), path = slug => "/" + (slug ? slug + "/" : "");
  const files = ["sitemaps/pages.xml"];
  await writeFile(new URL("sitemaps/pages.xml", pub), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    LANGS.map(([, s]) => `  <url>\n    <loc>${SITE + path(s)}</loc>\n` + LANGS.map(([l, s2]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE + path(s2)}"/>`).join("\n") +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>\n  </url>`).join("\n") + "\n</urlset>\n");
  const PER = 45000;
  for (const [, slug] of LANGS) for (let i = 0; i * PER < announced.length; i++) {
    const f = `sitemaps/as-${slug || "en"}-${i + 1}.xml`;
    files.push(f);
    await writeFile(new URL(f, pub), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      announced.slice(i * PER, (i + 1) * PER).map(a => `<url><loc>${SITE}${path(slug)}AS${a}</loc></url>`).join("\n") + "\n</urlset>\n");
  }
  await writeFile(new URL("sitemap.xml", pub), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    files.map(f => `  <sitemap><loc>${SITE}/${f}</loc><lastmod>${day}</lastmod></sitemap>`).join("\n") + "\n</sitemapindex>\n");
  console.log(`${files.length} sitemaps; done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await build();
