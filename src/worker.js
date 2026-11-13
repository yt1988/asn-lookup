// asn-lookup Worker. The home page, assets and the lookup data are static files (public/, served without running this
// script); this script answers
//   [/<lang>]/AS<n>             an AS: name, holder, registry, prefixes, siblings (src/render.mjs), from public/data/as
//   [/<lang>]/ip/<ip|prefix>    an address: the AS announcing it and the prefix holding it, from public/data/ip4|ip6
//   [/<lang>]/q?s=<anything>    the search box: sends an AS number, an address or a domain (resolved here) to its page
//   /api/me                     the visitor's own address, looked up
//   /api/ip/<ip>, /api/as/<n>   the same lookups in JSON
//   /api/rdap/as/<n>, /api/rdap/ip/<ip>, /api/nb/<n>
//                               the live parts of a page: the registry's RDAP record (and reverse DNS), the neighbours
//                               RIPE's route collectors see; cached for a day
//   /api/hist/<n>               the AS's routing history (history/), cached until the next daily run
// Pages are rendered into public/tpl/<lang>.html (the home page without its content), so every page has the same head,
// header, help and scripts as the home page.
import { STRINGS } from "./strings.mjs";
import { LANGS, BY_SLUG, SLUG } from "./langs.mjs";
import { family, canon, isPublic, v4num, v6big, v4str, v6str, find4, find6, parseCidr } from "./ip.mjs";
import { asPage, ipPage, findPage, hostPage, topPage, moasPage, browsePage, browseIndexPage, toolsPage, head, esc, path } from "./render.mjs";
import { PREPAINT, csp, HEADERS } from "./csp.mjs";
import { knownName } from "./popular.mjs";

const SITE_DEFAULT = "https://asn.1ms.dog";
const BUCKET = 100, NAMES = 1000;
const DAY = 86400;
const UA = "asn-lookup (+https://github.com/yt1988/asn-lookup)";
const PATHS = Object.fromEntries(LANGS.map(([l, s]) => [l, path(s)]));

/* ---------- static data, kept per isolate ---------- */

const memo = new Map();
function keep(k, v) { if (memo.size > 300) memo.delete(memo.keys().next().value); memo.set(k, v); return v; }
async function asset(env, origin, p, as = "json") {
  const k = as + p, hit = memo.get(k);
  if (hit && (!hit.until || hit.until > Date.now())) return hit.v;
  const r = await env.ASSETS.fetch(new Request(origin + p));
  if (!r.ok) { if (r.status === 404) keep(k, { v: null, until: Date.now() + 600e3 }); return null; }
  const v = as === "json" ? await r.json() : as === "bin" ? new Uint32Array(await r.arrayBuffer()) : { text: await r.text(), etag: r.headers.get("etag") || "" };
  // meta and templates change with a deploy; re-read them now and then
  keep(k, { v, until: p === "/data/meta.json" || p.startsWith("/tpl/") ? Date.now() + 300e3 : 0 });
  return v;
}
const asRec = async (env, o, asn) => ((await asset(env, o, `/data/as/${Math.floor(asn / BUCKET)}.json`)) || {})[asn] || null;
async function names(env, o, list) {
  const files = [...new Set(list.map(a => Math.floor(a / NAMES)))];
  const got = await Promise.all(files.map(f => asset(env, o, `/data/names/${f}.json`)));
  const all = Object.assign({}, ...got.filter(Boolean));
  return a => all[a] || ["", ""];
}

// The AS announcing an address, its record, the shard's range and the announced prefix holding the address
async function lookup(env, o, ip) {
  const f = family(ip);
  if (!f) return null;
  ip = canon(ip);
  if (!isPublic(ip)) return { ip, private: true };
  let hit, range, inPfx;
  if (f === 4) {
    const n = v4num(ip), sh = await asset(env, o, `/data/ip4/${n >>> 24}.bin`, "bin");
    hit = sh && find4(sh, n);
    if (hit) range = v4str(hit.first) + " – " + v4str(hit.last);
    inPfx = p => { const [a, l] = p.split("/"), k = 2 ** (32 - +l); return Math.floor(v4num(a) / k) === Math.floor(n / k); };
  } else {
    const big = v6big(ip), sh = await asset(env, o, `/data/ip6/${Number(big >> 112n).toString(16)}.bin`, "bin");
    hit = sh && find6(sh, big);
    if (hit) range = v6str(hit.first) + " – " + v6str(hit.last);
    inPfx = p => { const [a, l] = p.split("/"), k = BigInt(128 - +l); return (v6big(a) >> k) === (big >> k); };
  }
  if (!hit) return { ip };
  const rec = await asRec(env, o, hit.asn);
  // the most specific announced prefix of that AS holding the address (the full list when the AS file has only the first ones)
  const key = f === 4 ? "p4" : "p6";
  let list = rec && rec[key] || [];
  if (rec && rec.x && !list.some(inPfx)) list = ((await asset(env, o, `/data/px/${hit.asn}.json`)) || {})[key] || list;
  const pfx = list.filter(inPfx).sort((a, b) => +b.split("/")[1] - +a.split("/")[1])[0] || null;
  return { ip, asn: hit.asn, rec, range, pfx };
}

// A search by name: data/find holds word → ASNs, one shard fetched per query (scripts/data.mjs). Every word of the
// query has to appear in the network's name, its holder or its well-known name; the biggest networks come first.
async function findByName(env, o, q) {
  const words = String(q || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(w => w.length >= 2).slice(0, 4);
  if (!words.length) return [];
  const longest = [...words].sort((a, b) => b.length - a.length)[0], k = longest.slice(0, 2);
  if (!/^[a-z0-9]{2}$/.test(k)) return [];
  const shard = (await asset(env, o, `/data/find/${k}.json`)) || {};
  const asns = new Set();
  for (const t in shard) if (t.startsWith(longest)) for (const a of shard[t]) asns.add(a);
  const out = [];
  let checked = 0;
  for (const a of asns) {
    if (++checked > 150) break;
    const rec = await asRec(env, o, a);
    if (!rec) continue;
    const hay = ((rec.h || "") + " " + (rec.n || "") + " " + knownName(a, "en")).toLowerCase();
    if (!words.every(w => hay.includes(w))) continue;
    out.push({ asn: a, h: rec.h || "", n: rec.n || "", cc: rec.cc || "", n4: rec.n4 || 0, n6: rec.n6 || 0 });
  }
  return out.sort((x, y) => (y.n4 + y.n6) - (x.n4 + x.n6) || x.asn - y.asn).slice(0, 30);
}

// A domain in a URL or in the search box → the domain, or "" when it isn't one
function hostOf(s) {
  let host = String(s || "").toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  try { host = new URL("http://" + host).hostname; } catch (e) { return ""; }
  return DOMAIN.test(host) ? host : "";
}

// Every address a domain resolves to, each looked up: a site can sit on several networks
async function hostRows(env, o, host) {
  const ips = [];
  for (const [type, t] of [["A", 1], ["AAAA", 28]]) {
    const j = await doh(host, type).catch(() => null);
    for (const a of (j && j.Answer) || []) if (a.type === t && family(a.data)) ips.push(canon(a.data));
  }
  const uniq = [...new Set(ips)].slice(0, 12);
  return Promise.all(uniq.map(ip => lookup(env, o, ip).then(h => ({ ...(h || { ip }) }))));
}

// The registry block an address was allocated in (data/al4, data/al6, from the five RIRs' delegated files): the
// address page shows it without asking RDAP.
async function allocOf(env, o, ip) {
  const f = family(ip);
  if (f === 4) {
    const n = v4num(ip), sh = await asset(env, o, `/data/al4/${n >>> 24}.bin`, "bin");
    if (!sh) return null;
    let lo = 0, hi = sh.length / 4 - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, i = mid * 4;
      if (n < sh[i]) hi = mid - 1; else if (n > sh[i + 1]) lo = mid + 1;
      else return { rir: RIR_LIST[sh[i + 2]], day: sh[i + 3] };
    }
    return null;
  }
  if (f !== 6) return null;
  const big = v6big(ip), sh = await asset(env, o, `/data/al6/${Number(big >> 112n).toString(16)}.bin`, "bin");
  if (!sh) return null;
  const a = [Number((big >> 96n) & 0xffffffffn), Number((big >> 64n) & 0xffffffffn)];
  const cmp = i => a[0] !== sh[i] ? (a[0] < sh[i] ? -1 : 1) : a[1] !== sh[i + 1] ? (a[1] < sh[i + 1] ? -1 : 1) : 0;
  let lo = 0, hi = sh.length / 6 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, i = mid * 6;
    if (cmp(i) < 0) hi = mid - 1; else if (cmp(i + 2) > 0) lo = mid + 1;
    else return { rir: RIR_LIST[sh[i + 4]], day: sh[i + 5] };
  }
  return null;
}
const dayStr = d => d ? new Date(d * 864e5).toISOString().slice(0, 10) : "";

/* ---------- live parts ---------- */

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff", ...extra },
});
// fresh: past Cloudflare's cache (what the caller keeps itself, like the RDAP records in cached() below)
async function getJSON(u, ms = 6000, headers = {}, fresh = false) {
  const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json", ...headers }, signal: AbortSignal.timeout(ms),
    ...(fresh ? { cache: "no-store" } : { cf: { cacheTtlByStatus: { "200-299": DAY, "404": 3600, "300-599": 0 }, cacheEverything: true } }) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
// a day in this data center's cache; an error, or a body marked [NOCACHE] (part of it missing), is answered but not kept
const NOCACHE = Symbol("nocache");
async function cached(request, ctx, make, ttl = DAY) {
  const key = new Request(new URL(request.url).toString(), { method: "GET" });
  const c = caches.default, hit = await c.match(key);
  if (hit) return hit;
  let body, ok = true;
  try { body = await make(); } catch (e) { ok = false; body = { error: String(e && e.message || e).slice(0, 80) }; }
  if (body && body[NOCACHE]) ok = false;
  const res = json(body, 200, { "Cache-Control": ok ? `public, max-age=${ttl}` : "no-store" });
  if (ok) ctx.waitUntil(c.put(key, res.clone()));
  return res;
}

// RDAP: the vCard's name and e-mail of the entities with a role, looking into nested entities too
function rdapPick(j) {
  const ents = [];
  const walk = es => (es || []).forEach(e => { ents.push(e); walk(e.entities); });
  walk(j.entities);
  const card = (e, field) => { const v = ((e.vcardArray || [])[1] || []).find(x => x[0] === field); return v ? String(v[3]).trim() : ""; };
  const role = r => ents.find(e => (e.roles || []).includes(r));
  // the registrant organization (RIPE lists its maintainers as registrants too); APNIC has none, its description says who
  const regs = ents.filter(e => (e.roles || []).includes("registrant"));
  const org = regs.find(e => card(e, "kind") === "org") || regs.find(e => /^ORG-/i.test(e.handle || "")) || regs.find(e => !/(^|-)(MNT|RR)(-|$)/i.test(card(e, "fn")));
  const descr = ((j.remarks || []).find(r => r.title === "description") || {}).description;
  const abuse = role("abuse");
  const ev = a => ((j.events || []).find(e => e.eventAction === a) || {}).eventDate;
  return {
    name: j.name || "", org: org ? card(org, "fn") : descr && descr[0] ? String(descr[0]) : "", abuse: abuse ? card(abuse, "email") : "", cc: (j.country || "").toUpperCase(),
    reg: (ev("registration") || "").slice(0, 10), upd: (ev("last changed") || "").slice(0, 10),
    range: j.startAddress && j.endAddress ? `${j.startAddress} – ${j.endAddress}` : "",
  };
}
const RDAP = { Accept: "application/rdap+json, application/json" };
// RDAP servers: the registry that holds the AS (from our data) first, then ARIN (which redirects to the others) and
// rdap.org's bootstrap redirect, so one registry unreachable from Cloudflare (ARIN, HTTP 525, 2026-11) leaves the others
const RIRS = { ARIN: "https://rdap.arin.net/registry/", APNIC: "https://rdap.apnic.net/", RIPE: "https://rdap.db.ripe.net/",
  LACNIC: "https://rdap.lacnic.net/rdap/", AFRINIC: "https://rdap.afrinic.net/rdap/" };
const RIR_LIST = ["APNIC", "RIPE", "ARIN", "LACNIC", "AFRINIC"];
async function rdap(rir, q) {
  let err;
  for (const base of new Set([RIRS[rir], RIRS.ARIN, "https://rdap.org/"].filter(Boolean))) {
    // a registry asking us to slow down (LACNIC: 429) would only be asked again through the redirects
    try { return rdapPick(await getJSON(base + q, 4000, RDAP, true)); } catch (e) { err = e; if (/HTTP 429/.test(e.message)) break; }
  }
  throw err;
}
// DNS over HTTPS (JSON), Cloudflare's resolver first, then Google's
const doh = (name, type) => getJSON(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, 3000, { Accept: "application/dns-json" })
  .catch(() => getJSON(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, 3000));
async function ptr(ip) {
  const f = family(ip);
  const rev = f === 4 ? ip.split(".").reverse().join(".") + ".in-addr.arpa"
    : v6big(ip).toString(16).padStart(32, "0").split("").reverse().join(".") + ".ip6.arpa";
  const j = await doh(rev, "PTR");
  return ((j.Answer || []).find(a => a.type === 12) || {}).data?.replace(/\.$/, "") || "";
}
async function neighbours(env, o, asn) {
  const j = await getJSON(`https://stat.ripe.net/data/asn-neighbours/data.json?resource=AS${asn}&sourceapp=1ms-asn`, 8000);
  const all = (j.data && j.data.neighbours) || [];
  const by = { up: [], down: [], un: [] };
  for (const n of all) (n.type === "left" ? by.up : n.type === "right" ? by.down : by.un).push(n);
  const top = Object.fromEntries(Object.entries(by).map(([k, l]) => [k, l.sort((a, b) => b.power - a.power).slice(0, 8)]));
  const nm = await names(env, o, Object.values(top).flat().map(n => n.asn));
  const out = { n: Object.fromEntries(Object.entries(by).map(([k, l]) => [k, l.length])) };
  for (const k in top) out[k] = top[k].map(n => { const [h, cc] = nm(n.asn); return [n.asn, h, cc, n.power]; });
  return out;
}
// The routing history of an AS (history/README.md), written once a day at 03:40 UTC by asn-history on the 1ms.dog
// server; kept here until the next run's files are in (04:30 UTC). An AS with no history: {}. HISTORY_URL: where the
// files are, "" for none (self-hosting without the server).
const HISTORY = "https://data.1ms.dog:2083/asn/";
async function history(env, asn) {
  const base = env.HISTORY_URL ?? HISTORY;
  if (!base) return {};
  try { return await getJSON(`${base}as/${asn}.json`, 8000, {}, true); } catch (e) { if (/HTTP 404/.test(e.message)) return {}; throw e; }
}
function untilRun(now = Date.now()) {
  const d = new Date(now), next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 4, 30);
  return Math.max(600, Math.round(((next > now ? next : next + DAY * 1000) - now) / 1000));
}

/* ---------- search ---------- */

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
async function resolve(host) {
  for (const type of ["A", "AAAA"]) {
    const j = await doh(host, type).catch(() => null);
    const a = j && (j.Answer || []).find(x => x.type === (type === "A" ? 1 : 28));
    if (a) return a.data;
  }
  return null;
}
async function search(s, home) {
  s = String(s || "").trim();
  // an AS number, plain or in asdot form (AS1.10 and 1.10 are both 65546)
  let m = /^as\s*(\d{1,10})(?:\.(\d{1,5}))?$/i.exec(s) || (!family(s) && /^(\d{1,10})(?:\.(\d{1,5}))?$/.exec(s));
  if (m && +(m[2] || 0) < 65536) {
    const n = +m[1] * (m[2] ? 65536 : 1) + +(m[2] || 0);
    if (n < 2 ** 32) return `${home}AS${n}`;
  }
  const c = parseCidr(s);
  if (c) return `${home}ip/${c.len === (c.f === 4 ? 32 : 128) ? canon(s.split("/")[0]) : c.ip + "/" + c.len}`;
  const host = hostOf(s);
  if (!host) {
    // not an address or a domain: a network name ("Cloudflare", "China Telecom")
    if (/^[\d.:/]+$/.test(s) || s.length < 2) return `${home}?e=bad&s=${encodeURIComponent(s.slice(0, 100))}`;
    return `${home}find?q=${encodeURIComponent(s.replace(/[<>"&]/g, "").slice(0, 60))}`;
  }
  const ip = await resolve(host);
  return ip ? `${home}host/${host}` : `${home}?e=dns&s=${encodeURIComponent(s.slice(0, 100))}`;
}

/* ---------- pages ---------- */

let SHA = null;
async function prepaintSha() {
  if (!SHA) SHA = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PREPAINT)))));
  return SHA;
}
const djb2 = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

async function render(request, env, o, lang, site, r, page) {
  const tpl = await asset(env, o, `/tpl/${lang === "en" ? "en" : SLUG[lang]}.html`, "text");
  if (!tpl) return new Response("Not built", { status: 503 });
  const meta = await asset(env, o, "/data/meta.json");
  const etag = `W/"${djb2([tpl.etag, meta && meta.at, lang, r.rest, r.status, r.hostKey || "", r.data && r.data.shared || ""].join("|"))}"`;
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate", ETag: etag,
    "Content-Security-Policy": csp(await prepaintSha()), ...HEADERS };
  if (r.status === 200 && (request.headers.get("if-none-match") || "").split(",").map(s => s.trim()).includes(etag)) return new Response(null, { status: 304, headers });
  const T = k => STRINGS[lang][k];
  const html = tpl.text
    .replace("{{rootAttr}}", lang === "en" ? " data-root" : "")
    .replace("{{head}}", () => head({ T, lang, site, rest: r.rest, title: r.title, desc: r.desc, robots: r.robots, graph: r.graph || [] }))
    .replace("{{main}}", () => r.main)
    .replace("{{foot}}", () => esc(r.foot || T("foot_home")))
    .replace("{{data}}", () => JSON.stringify({ lang, paths: PATHS, page, rest: r.rest, ...r.data }).replace(/</g, "\\u003c"));
  return new Response(html, { status: r.status, headers });
}

const redirect = (to, status = 301) => new Response(null, { status, headers: { Location: to, "Cache-Control": status === 301 ? "public, max-age=86400" : "no-store" } });
const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), o = url.origin;
    const site = (env.SITE_URL || SITE_DEFAULT).replace(/\/+$/, "");
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    let p = url.pathname;
    try { p = decodeURIComponent(p); } catch (e) { return notFound(); }

    /* API */
    let m;
    if (p === "/api/me") {
      const ip = request.headers.get("cf-connecting-ip") || "";
      const hit = await lookup(env, o, ip);
      const cf = request.cf || {};
      return json({ ...slim(hit, ip), cf: { country: cf.country || null, city: cf.city || null, asn: cf.asn || null, org: cf.asOrganization || null } }, 200, { "Cache-Control": "no-store" });
    }
    if ((m = /^\/api\/ip\/(.+)$/.exec(p))) {
      const hit = await lookup(env, o, m[1]);
      return hit ? json(slim(hit), 200, { "Cache-Control": "public, max-age=3600" }) : json({ error: "not an IP address" }, 400);
    }
    if ((m = /^\/api\/as\/(?:as)?(\d{1,10})$/i.exec(p))) {
      const asn = +m[1], rec = await asRec(env, o, asn);
      if (!rec) return json({ asn, error: "not allocated" }, 404);
      const full = rec.x ? await asset(env, o, `/data/px/${asn}.json`) : null;
      const { x, ...r } = rec;
      return json({ asn, name: knownName(asn, "en") || r.h || null, ...r, ...(full || {}) }, 200, { "Cache-Control": "public, max-age=3600" });
    }
    if ((m = /^\/api\/rdap\/as\/(\d{1,10})$/.exec(p))) return cached(request, ctx, async () => rdap(((await asRec(env, o, +m[1])) || {}).r, `autnum/${m[1]}`));
    if ((m = /^\/api\/rdap\/ip\/(.+)$/.exec(p))) {
      if (!family(m[1]) || !isPublic(canon(m[1]))) return json({ error: "not a public IP address" }, 400);
      const ip = canon(m[1]);
      return cached(request, ctx, async () => {
        // the registry of the AS announcing it first; without a record the reverse DNS is still answered, but not kept
        const [r, h] = await Promise.all([lookup(env, o, ip).then(hit => rdap(hit && hit.rec && hit.rec.r, `ip/${ip}`)).catch(() => null), ptr(ip).catch(() => "")]);
        return r ? { ...r, ptr: h } : { ptr: h, [NOCACHE]: true };
      });
    }
    if ((m = /^\/api\/nb\/(\d{1,10})$/.exec(p))) return cached(request, ctx, () => neighbours(env, o, +m[1]));
    if ((m = /^\/api\/hist\/(\d{1,10})$/.exec(p))) return cached(request, ctx, () => history(env, +m[1]), untilRun());
    if (p === "/api/find") return json(await findByName(env, o, (url.searchParams.get("q") || "").slice(0, 60)), 200, { "Cache-Control": "public, max-age=3600" });
    if ((m = /^\/api\/host\/(.+)$/.exec(p))) {
      const host = hostOf(m[1]);
      if (!host) return json({ error: "not a domain" }, 400);
      const rows = await hostRows(env, o, host);
      return json({ host, rows: rows.map(r => ({ ip: r.ip, asn: r.asn || null, cc: (r.rec && r.rec.cc) || null, prefix: r.pfx || null })) }, 200, { "Cache-Control": "public, max-age=300" });
    }
    if (p === "/api/top") return json((await asset(env, o, "/data/top.json")) || {}, 200, { "Cache-Control": "public, max-age=3600" });
    if (p === "/api/moas") return json((await asset(env, o, "/data/moas.json")) || {}, 200, { "Cache-Control": "public, max-age=3600" });
    if (p.startsWith("/api/")) return json({ error: "not found" }, 404);

    /* pages */
    let lang = "en";
    if ((m = /^\/([a-z]{2}(?:-[a-z]{2})?)(\/.*)$/.exec(p)) && BY_SLUG[m[1]] && m[1]) { lang = BY_SLUG[m[1]]; p = m[2]; }
    const home = PATHS[lang], T = k => STRINGS[lang][k];

    if (p === "/q") return redirect(await search(url.searchParams.get("s"), home), 302);

    // the pages that are not one AS or one address: search results, hosts, leaderboards, countries and registries
    if (p === "/find") {
      const q = (url.searchParams.get("q") || "").slice(0, 60), meta = await asset(env, o, "/data/meta.json");
      return render(request, env, o, lang, site, findPage({ T, lang, site, q, hits: await findByName(env, o, q), meta }), "find");
    }
    if (p === "/tools") {
      return render(request, env, o, lang, site, toolsPage({ T, lang, site, meta: await asset(env, o, "/data/meta.json") }), "tools");
    }
    if (p === "/top" || p === "/moas") {
      const meta = await asset(env, o, "/data/meta.json");
      const r = p === "/top" ? topPage({ T, lang, site, top: (await asset(env, o, "/data/top.json")) || {}, meta })
        : moasPage({ T, lang, site, moas: (await asset(env, o, "/data/moas.json")) || { all: 0, list: [] }, meta });
      return render(request, env, o, lang, site, r, p.slice(1));
    }
    if ((m = /^\/country(?:\/([A-Za-z]{2}))?\/?$/.exec(p))) {
      const meta = await asset(env, o, "/data/meta.json");
      if (!m[1]) return render(request, env, o, lang, site, browseIndexPage({ T, lang, site, kind: "cc", rows: (await asset(env, o, "/data/cc/index.json")) || [], meta }), "cc");
      const cc = m[1].toUpperCase(), rows = await asset(env, o, `/data/cc/${cc}.json`);
      if (!rows) return notFound();
      return render(request, env, o, lang, site, browsePage({ T, lang, site, kind: "cc", key: cc, rows, meta }), "cc");
    }
    if ((m = /^\/rir(?:\/([A-Za-z]{2,7}))?\/?$/.exec(p))) {
      const meta = await asset(env, o, "/data/meta.json");
      if (!m[1]) return render(request, env, o, lang, site, browseIndexPage({ T, lang, site, kind: "rir", rows: (await asset(env, o, "/data/rir/index.json")) || [], meta }), "rir");
      const rir = m[1].toUpperCase();
      if (!RIR_LIST.includes(rir)) return notFound();
      const rows = await asset(env, o, `/data/rir/${rir}.json`);
      if (!rows) return notFound();
      return render(request, env, o, lang, site, browsePage({ T, lang, site, kind: "rir", key: rir, rows, meta }), "rir");
    }
    if ((m = /^\/host\/(.+?)\/?$/.exec(p))) {
      const host = hostOf(m[1]);
      if (!host) return notFound();
      const meta = await asset(env, o, "/data/meta.json");
      return render(request, env, o, lang, site, hostPage({ T, lang, site, host, rows: await hostRows(env, o, host), meta }), "host");
    }

    // A shared result: /r/1~<when shared, ms in base 36>~<the page: AS4134 or ip/…>. It is that page, today's data,
    // not indexed, with the share dialog's banner saying when it was shared. Anything unreadable is a 404.
    let shared = 0;
    if ((m = /^\/r\/(.*)$/.exec(p))) {
      const s = /^1~([0-9a-z]{1,9})~(AS\d{1,10}|ip\/.+)$/.exec(m[1]);
      if (!s) return notFound();
      shared = parseInt(s[1], 36); p = "/" + s[2];
    }
    const share = r => { if (shared && r.status === 200) { r.robots = "noindex, follow"; r.data = { ...r.data, shared }; } return r; };

    // /AS4134 is the page; /as4134, /as/4134, /asn/4134, /4134, a trailing slash or leading zeros redirect to it
    if ((m = /^\/(?:asn?\/?)?(\d{1,10})\/?$/i.exec(p))) {
      const asn = +m[1];
      if (p !== "/AS" + m[1] || String(asn) !== m[1]) return shared ? notFound() : redirect(home + "AS" + asn);
      if (asn >= 2 ** 32) return notFound();
      const meta = await asset(env, o, "/data/meta.json");
      if (!meta) return new Response("Data not built: run npm run data", { status: 503 });
      const rec = await asRec(env, o, asn);
      return render(request, env, o, lang, site, share(asPage({ T, lang, site, asn, rec, meta })), "as");
    }

    if ((m = /^\/ip\/(.+?)\/?$/.exec(p)) || (family(p.slice(1)) && (m = [null, p.slice(1)]))) {
      const c = parseCidr(m[1]);
      if (!c) return notFound();
      const whole = c.len === (c.f === 4 ? 32 : 128), want = whole ? canon(m[1].split("/")[0]) : c.ip + "/" + c.len;
      if (p !== "/ip/" + want) return shared ? notFound() : redirect(home + "ip/" + want + url.search);
      const meta = await asset(env, o, "/data/meta.json");
      if (!meta) return new Response("Data not built: run npm run data", { status: 503 });
      const hit = await lookup(env, o, c.ip);
      const hq = (url.searchParams.get("host") || "").toLowerCase();
      const host = DOMAIN.test(hq) ? hq : "";
      const al = await allocOf(env, o, c.ip);
      const r = ipPage({ T, lang, site, hit: { ...hit, ip: want }, host, meta, alloc: al ? { rir: al.rir, day: dayStr(al.day) } : null });
      r.hostKey = host;
      return render(request, env, o, lang, site, share(r), "ip");
    }
    return notFound();
  },
};

// the JSON answer for an address
function slim(hit, ip) {
  if (!hit) return { ip: ip || null, error: "not an IP address" };
  const r = hit.rec || {};
  return { ip: hit.ip, private: hit.private || undefined, asn: hit.asn || null, name: hit.asn ? knownName(hit.asn, "en") || r.h || null : null,
    holder: r.n || null, cc: r.cc || null, prefix: hit.pfx || null, range: hit.range || null,
    assigned: r.d || null, shared: r.mo || 0, n4: r.n4 || 0, n6: r.n6 || 0 };
}
