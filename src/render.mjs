// The pages' content, shared by the build (the home page per language) and the Worker (every AS and address page).
// Everything is rendered on the server: the page is complete without JavaScript; the browser only adds the live parts
// (the visitor's own address, the registry record, reverse DNS, neighbours) into rows drawn here from the start.
import { GROUPS, knownName } from "./popular.mjs";
import { LANGS, SLUG } from "./langs.mjs";
import { regionName, flagCode } from "./region.mjs";

export const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const fill = (s, v) => { for (const k in v) s = s.split("{" + k + "}").join(v[k]); return s; };
export const path = slug => "/" + (slug ? slug + "/" : "");
const json = o => JSON.stringify(o).replace(/</g, "\\u003c");

export function fmt(lang) {
  const nf = new Intl.NumberFormat(lang), cf = new Intl.NumberFormat(lang, { notation: "compact", maximumSignificantDigits: 3 });
  const pr = new Intl.PluralRules(lang), big = n => n >= 100000 ? cf.format(n) : nf.format(n);
  return {
    num: n => nf.format(n),
    big,
    // n with its noun: key_<plural rule> (key_one, Russian key_few / key_many) when the language has it, else key
    // (docs/translation.md in 1ms-shell, "复数"); compact: big numbers as "2.4M"
    count: (T, key, n, compact = false) => {
      let s;
      try { s = T(key + "_" + pr.select(n)); } catch (e) {}   // the build's T throws on a key the language doesn't have
      return fill(s || T(key), { n: compact ? big(n) : nf.format(n) }).replace(CJK_SP, "$1");   // "243万 个" → "243万个"
    },
    country: cc => { if (!cc) return ""; try { return regionName(cc, lang); } catch (e) { return cc; } },
  };
}
export const flag = cc => /^[A-Z]{2}$/.test(cc || "") ? `<img class="flag" src="/flags/${flagCode(cc)}.svg" alt="" width="20" height="15">` : "";

// The AS's display name: the well-known name if there is one, else the registry handle
export const asName = (asn, rec, lang) => knownName(asn, lang) || (rec && rec.h) || "";

const SEARCH = (T, home, value = "") => `<form class="ask" action="${home}q" method="get" role="search" autocomplete="off">
  <label class="sr" for="q" data-k="ph">${esc(T("ph"))}</label>
  <input id="q" name="s" type="text" spellcheck="false" maxlength="253" placeholder="${esc(T("ph"))}" value="${esc(value)}">
  <button class="btn pri" type="submit">${esc(T("go"))}</button>
</form>`;
const kv = rows => `<ul class="kv">${rows.map(([k, v, attr = ""]) => `<li${attr}><span>${esc(k)}</span><b>${v}</b></li>`).join("")}</ul>`;
// a space a template leaves between two Chinese or Japanese characters ("是 {holder}" with a Chinese name)
const CJK_SP = /([぀-ヿ一-鿿]) (?=[぀-ヿ一-鿿])/g;
const SKL ='<i class="skl"></i>';
// after a link to another 1ms.dog tool (the site uses this icon for those, not an arrow)
const EXT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
// an AS or address page shows that one result; the home page (the visitor's own IP, the common networks) is a click away
// The routing history (history/, on the 1ms.dog server): src/app.js fills it in and shows it once it has come
const HIST = T => `<section class="card hist" id="hist" hidden><h2>${esc(T("h_hist"))}</h2>
  <div class="hcols"><div><div class="sec-h"><span>${esc(T("hist_trend"))}</span><span class="n" id="hN"></span></div><div class="spark" id="hSpark"></div></div>
  <div><div class="sec-h"><span>${esc(T("k_rpki"))}</span></div><ul class="kv" id="hRpki"></ul></div></div>
  <div><div class="sec-h"><span>${esc(T("hist_ev"))}</span></div><ol class="evl" id="hEv"></ol></div>
  <div class="hflag" id="hFlag"></div>
  <p class="note m" id="hNote"></p></section>`;
const HOME_L =(T, home) => `<p class="home-l"><a class="btn sm" href="${home}">${esc(T("to_home"))}</a></p>`;
const LISTED = 48;     // prefixes per family on the page; "show all" brings the rest
const asLink = (home, asn, name, cc) => `<a class="asl" href="${home}AS${asn}"><b>AS${asn}</b>${name ? ` <span>${esc(name)}</span>` : ""}${cc ? " " + flag(cc) : ""}</a>`;

/* ---------- head ---------- */

// <title>, description, canonical, alternates, link previews, structured data
export function head({ T, lang, site, rest = "", title, desc, robots = "index, follow, max-image-preview:large", graph }) {
  const slug = SLUG[lang], url = site + path(slug) + rest, og = `${site}/og/${slug || "en"}.png`;
  const alts = LANGS.map(([l, sl]) => `<link rel="alternate" hreflang="${l}" href="${site + path(sl) + rest}">`).join("\n") +
    `\n<link rel="alternate" hreflang="x-default" href="${site}/${rest}">`;
  const locale = LANGS.find(([l]) => l === lang)[2];
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    ...(rest ? [] : [`<meta name="keywords" content="${esc(T("seo_kw"))}">`]),
    ...(lang === "zh-CN" ? [`<meta http-equiv="Cache-Control" content="no-transform">`, `<meta http-equiv="Cache-Control" content="no-siteapp">`, `<meta name="applicable-device" content="pc,mobile">`] : []),
    `<meta name="robots" content="${robots}">`,
    `<meta name="application-name" content="${esc(T("app_name"))}">`,
    `<meta name="theme-color" content="#f6f6f7" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="#1c1c1c" media="(prefers-color-scheme: dark)">`,
    `<link rel="canonical" href="${url}">`, alts,
    `<link rel="icon" href="/favicon.ico" sizes="any">`, `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`,
    `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="1ms.dog">`,
    `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`, `<meta property="og:url" content="${url}">`,
    `<meta property="og:locale" content="${locale}">`, `<meta property="og:image" content="${og}">`,
    `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`, `<meta property="og:image:alt" content="${esc(T("app_name"))}">`,
    `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:image" content="${og}">`,
    `<meta name="twitter:title" content="${esc(title)}">`, `<meta name="twitter:description" content="${esc(desc)}">`,
    `<script type="application/ld+json">${json({ "@context": "https://schema.org", "@graph": graph })}</script>`,
  ].join("\n");
}

export function app(T, lang, site) {
  const slug = SLUG[lang];
  return { "@type": "WebApplication", "@id": site + "/#app", name: T("app_name") + " · 1ms.dog", url: site + path(slug), image: `${site}/og/${slug || "en"}.png`,
    applicationCategory: "UtilitiesApplication", operatingSystem: "Any", description: T("seo_desc"), inLanguage: lang, isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } };
}

/* ---------- home ---------- */

export function homeMain(T, lang) {
  const home = path(SLUG[lang]);
  const groups = GROUPS.map(([g, list]) => `<div class="grp"><h3>${esc(T("g_" + g))}</h3><ul class="chips">` +
    list.map(a => `<li>${asLink(home, a, knownName(a, lang))}</li>`).join("") + "</ul></div>").join("");
  return `<section class="hero card">
  <h1>${esc(T("h1"))}</h1>
  ${SEARCH(T, home)}
  <div class="me" id="me">
    <div class="sec-h"><span>${esc(T("me_h"))}</span><a class="eg" id="meMore" href="${home}">${esc(T("me_more"))}</a></div>
    ${kv([[T("k_ip"), SKL, ' id="meIp"'], [T("k_as"), SKL, ' id="meAs"'], [T("k_pfx"), SKL, ' id="mePfx"'], [T("k_loc"), SKL, ' id="meLoc"']])}
    <p class="links" id="meLinks"><a class="xt" id="lnIpqs" hidden target="_blank" rel="noopener">${esc(T("ln_ipqs"))}${EXT}</a><a class="xt" id="lnEgress" hidden target="_blank" rel="noopener">${esc(T("ln_egress"))}${EXT}</a>&nbsp;</p>
  </div>
</section>
<section class="card pop">
  <h2>${esc(T("pop_h"))}</h2>
  ${groups}
</section>`;
}

/* ---------- an AS ---------- */

// rec: the AS file's record (scripts/data.mjs); null when the number isn't allocated
export function asPage({ T, lang, site, asn, rec, meta }) {
  const F = fmt(lang), slug = SLUG[lang], home = path(slug), as = "AS" + asn;
  const name = asName(asn, rec, lang), known = knownName(asn, lang);
  if (!rec) {
    const title = fill(T("as_title"), { as, name: "" }).replace(/\s+/g, " ");
    return { status: 404, rest: as, title, desc: fill(T("as_404"), { as }), robots: "noindex, follow",
      main: `<section class="hero card">${SEARCH(T, home)}<h1><span class="asn">${as}</span></h1><p class="lead">${esc(fill(T("as_404"), { as }))}</p></section>`, data: { asn } };
  }
  const routed = rec.n4 != null, cc = F.country(rec.cc);
  // who holds it, in words: the well-known name or the registry's description, with the handle after it
  const P = (a, b) => fill(T("paren"), { a, b });
  const lead1 = known || rec.n || rec.h || "", holder = lead1 && rec.h && lead1 !== rec.h ? P(lead1, rec.h) : lead1;
  const n4 = rec.n4 || 0, n6 = rec.n6 || 0;
  const v4 = F.count(T, "n_pfx", n4) + " · " + F.count(T, "n_addr", rec.c4 || 0, true), v6 = F.count(T, "n_pfx", n6) + " · " + F.count(T, "n_48", rec.c6 || 0, true);
  const title = fill(T("as_title"), { as, name: known && rec.h && known !== rec.h ? P(known, rec.h) : name }).replace(/\s+/g, " ").trim();
  const desc = fill(T("as_desc"), { as, name: holder || name, cc: cc ? fill(T("as_desc_cc"), { cc }) : "", p4: F.count(T, "n_pfx4", n4), p6: F.count(T, "n_pfx6", n6) });
  const lead = ((rec.r ? fill(T("as_lead"), { as, holder: esc(holder || name), rir: rec.r }) : "") + " " +
    (routed && (n4 || n6) ? fill(T("as_lead_r"), { p4: F.count(T, "n_pfx4", n4), p6: F.count(T, "n_pfx6", n6), a4: F.count(T, "n_addr", rec.c4 || 0, true) }) : T("as_lead_none")))
    .replace(/([）」。])\s+/g, "$1").replace(CJK_SP, "$1");   // no space after a full-width bracket or stop, or between two CJK characters

  const rows = [
    [T("k_name"), esc(rec.h || "–")],
    ...(rec.n ? [[T("k_holder"), esc(rec.n)]] : []),
    [T("k_cc"), rec.cc ? `${flag(rec.cc)} ${esc(cc)}` : "–"],
    [T("k_rir"), esc(rec.r || "–")],
    [T("k_date"), esc(rec.d || "–")],
    [T("k_v4"), n4 ? esc(v4) : esc(T("v_none"))],
    [T("k_v6"), n6 ? esc(v6) : esc(T("v_none"))],
  ];
  const live = [[T("k_org"), SKL, ' data-r="org"'], [T("k_abuse"), SKL, ' data-r="abuse"'], [T("k_upd"), SKL, ' data-r="upd"']];

  const pfxList = (fam, list, total) => `<div class="pfx" data-f="${fam}">
    <div class="sec-h"><span>${esc(T("h_pfx" + fam))}</span><span class="n">${F.num(total)}</span>${total ? `<button class="mini" type="button" data-copy="${fam}">${esc(T("copy"))}</button>` : ""}</div>
    ${total ? `<ul class="plist">${list.map(p => `<li><a href="${home}ip/${p}">${p}</a></li>`).join("")}</ul>` : `<p class="m">${esc(T("pfx_none"))}</p>`}
    ${total > list.length ? `<button class="btn sm more" type="button" data-all="${fam}">${esc(fill(T("pfx_all"), { n: F.num(total) }))}</button>` : ""}
  </div>`;

  const nbCol = k => `<div class="nbc" data-nb="${k}"><div class="sec-h"><span>${esc(T("nb_" + k))}</span><span class="n"></span></div><ol class="nbl">${'<li class="sk"><i class="skl"></i></li>'.repeat(8)}</ol></div>`;
  const sib = rec.o && rec.o.length ? `<section class="card sib"><h2>${esc(T("h_sib"))}<span class="n">${esc(fill(T("sib_n"), { n: F.num(rec.on || rec.o.length + 1) }))}</span></h2>
    <ul class="chips">${rec.o.map(([a, h]) => `<li>${asLink(home, a, knownName(a, lang) || h)}</li>`).join("")}</ul></section>` : "";
  const ext = [["bgp.he.net", `https://bgp.he.net/${as}`], ["bgp.tools", `https://bgp.tools/as/${asn}`], ["PeeringDB", `https://www.peeringdb.com/asn/${asn}`],
    ["RIPEstat", `https://stat.ripe.net/${as}`], ["IPinfo", `https://ipinfo.io/${as}`]];

  const main = `<section class="hero card">
  ${SEARCH(T, home)}
  <div class="top-l">
    <div class="ttl"><h1><span class="asn">${as}</span> <span>${esc(name)}</span></h1>${known && rec.h && known !== rec.h ? `<p class="sub">${esc(rec.h)}</p>` : ""}</div>
    <button class="btn sm pri" id="shareBtn" type="button" hidden>${esc(T("share"))}</button>
  </div>
  <p class="lead">${lead.trim()}</p>
  <div class="cols">${kv(rows)}<div>${kv(live)}</div></div>
  ${HOME_L(T, home)}
</section>
${routed ? `<section class="card nb"><h2>${esc(T("h_nb"))}</h2><div class="nbs">${nbCol("up")}${nbCol("down")}${nbCol("un")}</div><p class="note m">${esc(T("nb_note"))}</p></section>
${HIST(T)}
<section class="card pfxs">${pfxList(4, (rec.p4 || []).slice(0, LISTED), n4)}${pfxList(6, (rec.p6 || []).slice(0, LISTED), n6)}</section>` : ""}
${sib}
<p class="ext"><span class="m">${esc(T("h_ext"))}</span>${ext.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener nofollow">${n}</a>`).join("")}</p>`;

  const graph = [{ "@type": "WebPage", name: title, description: desc, url: site + home + as, inLanguage: lang, isPartOf: { "@id": site + "/#app" } }, app(T, lang, site)];
  // the share card (src/app.js): the AS, its name, then country, registry and what it announces
  const card = { big: as, name, sub: known && rec.h && known !== rec.h ? rec.h : "", ts: meta && meta.at, rows: [
    { k: T("k_cc"), v: cc || "–", cc: rec.cc }, { k: T("k_rir"), v: rec.r || "–" },
    { k: T("k_v4"), v: n4 ? v4 : T("v_none") },
    { k: T("k_v6"), v: n6 ? v6 : T("v_none") }] };
  // an AS page is indexable even when nothing is announced from it (no data at all, or only below the visibility
  // threshold): someone searching the number should find who holds it (1ms-shell#99). Only the 404 above is noindex.
  return { status: 200, rest: as, title, desc, main, graph,
    foot: fill(T("foot"), { date: (meta && meta.at || "").slice(0, 10) }), data: { asn, x: !!rec.x, card } };
}

/* ---------- an address ---------- */

// hit: { ip, asn, rec (the AS's record), pfx (the announced prefix holding it), range } or { ip, private } or { ip } (not routed)
export function ipPage({ T, lang, site, hit, host, meta }) {
  const F = fmt(lang), slug = SLUG[lang], home = path(slug), ip = hit.ip;
  const name = hit.asn ? asName(hit.asn, hit.rec, lang) : "", cc = hit.rec ? F.country(hit.rec.cc) : "";
  const as = hit.asn ? "AS" + hit.asn : "";
  const title = hit.asn ? fill(T("ip_title"), { ip, as, name }).replace(/\s+/g, " ") : fill(T("ip_title_none"), { ip });
  const desc = hit.asn ? fill(T("ip_desc"), { ip, as, name: hit.rec && hit.rec.h || name, cc: cc ? fill(T("as_desc_cc"), { cc }) : "", pfx: hit.pfx || hit.range || "" })
    : T(hit.private ? "ip_private" : "ip_none");
  const rows = hit.asn ? [
    [T("k_as"), asLink(home, hit.asn, name, hit.rec && hit.rec.cc)],
    [T("k_pfx"), hit.pfx ? `<span class="mono">${esc(hit.pfx)}</span>` : "–"],
    [T("k_range"), `<span class="mono">${esc(hit.range || "–")}</span>`],
    [T("k_ascc"), hit.rec && hit.rec.cc ? `${flag(hit.rec.cc)} ${esc(cc)}` : "–"],
  ] : [];
  const live = hit.private ? [] : [[T("k_net"), SKL, ' data-r="net"'], [T("k_org"), SKL, ' data-r="org"'], [T("k_ptr"), SKL, ' data-r="ptr"'], [T("k_abuse"), SKL, ' data-r="abuse"'],
    // the announced prefix's history (history/), filled in or taken away by src/app.js
    ...(hit.asn && hit.pfx ? [[T("k_rpki"), SKL, ' data-h="rpki"'], [T("k_seen"), SKL, ' data-h="seen"']] : [])];
  const one = !hit.private && !ip.includes("/");
  const main = `<section class="hero card">
  ${SEARCH(T, home)}
  <div class="top-l">
    <div class="ttl"><h1><span class="asn mono">${esc(ip)}</span></h1><p class="sub">${host ? esc(fill(T("ip_host"), { host, ip })) : hit.asn ? `${esc(as)} · ${esc(name)}` : "&nbsp;"}</p></div>
    <button class="btn sm pri" id="shareBtn" type="button" hidden>${esc(T("share"))}</button>
  </div>
  <p class="lead">${hit.asn ? fill(T("ip_lead"), { as, name: esc(name) }).replace(CJK_SP, "$1") : esc(desc)}</p>
  ${rows.length || live.length ? `<div class="cols">${rows.length ? kv(rows) : ""}<div>${kv(live)}</div></div>` : ""}
  <p class="links">${hit.private ? "" : `<a class="xt" id="lnIpqs" hidden target="_blank" rel="noopener" data-ip="${esc(ip)}">${esc(T("ln_ipqs"))}${EXT}</a>`}${one ? `<a class="xt" id="lnReach" hidden target="_blank" rel="noopener">${esc(T("ln_reach"))}${EXT}</a>` : ""}${ip.includes(":") ? `<a class="xt" id="lnIpv6" hidden target="_blank" rel="noopener">${esc(T("ln_ipv6"))}${EXT}</a>` : ""}${hit.asn ? `<a href="${home}${as}">${esc(fill(T("ip_as_more"), { as }))}</a>` : ""}&nbsp;</p>
  ${HOME_L(T, home)}
</section>`;
  const graph = [{ "@type": "WebPage", name: title, description: desc, url: site + home + "ip/" + ip, inLanguage: lang, isPartOf: { "@id": site + "/#app" } }, app(T, lang, site)];
  // the share card: the address, the AS announcing it, then the prefix, range and country
  const card = { big: ip, name: hit.asn ? `${as} · ${name}` : desc, sub: "", ts: meta && meta.at, rows: hit.asn ? [
    { k: T("k_pfx"), v: hit.pfx || "–", mono: true }, { k: T("k_ascc"), v: cc || "–", cc: hit.rec && hit.rec.cc },
    { k: T("k_range"), v: hit.range || "–", mono: true, wide: true }] : [] };
  return { status: 200, rest: "ip/" + ip, title, desc, main, graph, robots: "noindex, follow",
    foot: fill(T("foot"), { date: (meta && meta.at || "").slice(0, 10) }), data: { ip, live: !hit.private, asn: hit.asn || null, pfx: hit.pfx || null, card } };
}
