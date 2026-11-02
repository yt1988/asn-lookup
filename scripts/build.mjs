#!/usr/bin/env node
// Builds the static site in public/ from src/:
//   index.html, <lang>/index.html                the home page per language
//   tpl/<lang>.html                              the same page without its content: the Worker fills in each AS and
//                                                address page ({{head}}, {{main}}, {{foot}}, {{data}}, {{rootAttr}})
//   assets/app.<hash>.js, assets/app.<hash>.css  the page's code and styles, shared by every language
//   assets/l.<lang>.<hash>.js                    the strings the browser code needs, per language
//   assets/share/                                the 1ms.dog share dialog, copied verbatim from 1ms-shell; not built here
//   robots.txt, llms.txt, _headers               crawlers, AI readers, security headers (CSP)
// The lookup data (public/data/, the sitemaps) comes from scripts/data.mjs; the link-preview images and icons from
// scripts/og.mjs. The Worker (src/worker.js) is deployed from source by wrangler.
// Usage: node scripts/build.mjs          write the files
//        node scripts/build.mjs --check  exit 1 if anything in public/ is out of date (CI)
import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build as bundle, transform } from "esbuild";
import { LANGS } from "../src/langs.mjs";
import { STRINGS } from "../src/strings.mjs";
import { esc, path, head, homeMain, app } from "../src/render.mjs";
import { PREPAINT, csp as cspOf, HEADERS } from "../src/csp.mjs";

const SITE = (process.env.SITE_URL || "https://asn.1ms.dog").replace(/\/+$/, "");
const pub = new URL("../public/", import.meta.url), src = new URL("../src/", import.meta.url);


const hash = s => createHash("sha256").update(s).digest("hex").slice(0, 10);
const sha = s => createHash("sha256").update(s).digest("base64");

// Strings only the server uses (the page already shows them); everything else goes to the browser
const SERVER_ONLY = new Set(["seo_title", "seo_desc", "seo_kw", "og_sub", "h1", "docs", "lang_label", "faq_h", "as_title", "as_desc", "as_desc_cc", "as_lead",
  "as_lead_r", "as_lead_none", "as_404", "ip_title", "ip_title_none", "ip_desc", "ip_none", "ip_private", "ip_host", "ip_as_more", "foot", "foot_home",
  "g_cn", "g_cloud", "g_intl", "pop_h", "h_ext", "h_sib", "sib_n", "nb_note"]);

export async function build({ check = false } = {}) {
  const I = STRINGS, en = I.en;
  for (const [l] of LANGS) for (const k of Object.keys(en)) if (!(k in I[l])) throw new Error(`i18n/${l}.mjs is missing "${k}"`);
  const tpl = await readFile(new URL("page.html", src), "utf8");

  const root = fileURLToPath(new URL("..", import.meta.url));
  const js = (await bundle({ entryPoints: [fileURLToPath(new URL("app.js", src))], bundle: true, minify: true, format: "iife", target: "es2020",
    legalComments: "none", write: false, absWorkingDir: root, external: ["/assets/share/*"] })).outputFiles[0].text;
  const cssFull = (await Promise.all(["fonts.css", "base.css", "style.css"].map(f => readFile(new URL(f, src), "utf8")))).join("\n");
  const css = (await transform(cssFull, { loader: "css", minify: true, legalComments: "none" })).code;
  const jsName = `app.${hash(js)}.js`, cssName = `app.${hash(css)}.css`;
  const files = { ["assets/" + jsName]: js, ["assets/" + cssName]: css };
  const paths = Object.fromEntries(LANGS.map(([l, sl]) => [l, path(sl)]));

  for (const [lang, slug] of LANGS) {
    const d = I[lang], T = k => { if (!(k in d)) throw new Error(`i18n/${lang}.mjs has no "${k}"`); return d[k]; };
    const strings = Object.fromEntries(Object.keys(en).filter(k => !SERVER_ONLY.has(k)).map(k => [k, T(k)]));
    const sjs = `window.L1MS=${JSON.stringify(strings).replace(/</g, "\\u003c")};\n`;
    const sName = `l.${lang.toLowerCase()}.${hash(sjs)}.js`;
    files["assets/" + sName] = sjs;

    const docs = T("docs");
    const helpNav = docs.map(([q], i) => `<button type="button" role="tab" data-hq="${i}" aria-selected="${i === 0}">${esc(q)}</button>`).join("");
    const helpC = docs.map(([q, a], i) => `<article data-hqb="${i}"${i ? " hidden" : ""}><h3>${esc(q)}</h3>${a.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join("")}</article>`).join("");
    const langOpts = LANGS.map(([l]) => `<option value="${l}"${l === lang ? " selected" : ""}>${esc(I[l].name)}</option>`).join("");
    const shell = tpl
      .replace(/(<(\w+)\b[^>]*\sdata-i="(\w+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, k, inner, close) => open + esc(T(k)) + close)
      .replace(/\{\{a:(\w+)\}\}/g, (m, k) => esc(T(k)))
      .replace("{{lang}}", lang).replace("{{pathsAttr}}", esc(JSON.stringify(paths)))
      .replace("{{prepaint}}", PREPAINT).replace("{{css}}", cssName).replace("{{js}}", jsName).replace("{{strings}}", sName)
      .split("{{homeHref}}").join(path(slug)).replace("{{langOpts}}", langOpts)
      .replace("{{helpNav}}", helpNav).replace("{{helpC}}", helpC);
    files[`tpl/${slug || "en"}.html`] = shell;

    const graph = [app(T, lang, SITE), { "@type": "FAQPage", mainEntity: docs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a.replace(/\n+/g, " ") } })) }];
    const html = shell.replace("{{rootAttr}}", slug ? "" : " data-root")
      .replace("{{head}}", head({ T, lang, site: SITE, title: T("seo_title"), desc: T("seo_desc"), graph }).replace(/\$/g, "$$$$"))
      .replace("{{main}}", homeMain(T, lang).replace(/\$/g, "$$$$")).replace("{{foot}}", esc(T("foot_home")))
      .replace("{{data}}", JSON.stringify({ lang, paths, page: "home", rest: "" }).replace(/</g, "\\u003c"));
    if (/\{\{\w+\}\}/.test(html)) throw new Error("unfilled placeholder in " + path(slug) + ": " + /\{\{\w+\}\}/.exec(html)[0]);
    files[(slug ? slug + "/" : "") + "index.html"] = html;
  }

  files["robots.txt"] = `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /q\nDisallow: /tpl/\nDisallow: /data/\nDisallow: /ip/\nDisallow: /*/ip/\n\nSitemap: ${SITE}/sitemap.xml\n`;
  files["llms.txt"] = `# ASN Lookup · 1ms.dog

> Free IP and ASN lookup. For any IP address: the autonomous system announcing it, the announced prefix holding it,
> the registry record (network name, organization, abuse contact) and reverse DNS. For any AS number: its name,
> holder, country, registry and allocation date, every announced IPv4 and IPv6 prefix, its upstreams and
> downstreams, and other AS numbers of the same holder. Prefixes come from RIPE NCC RIS, address-to-AS from
> iptoasn.com, registrations from the five RIRs, refreshed daily.

- Home: ${SITE}/ (also ${LANGS.slice(1).map(([, s]) => "/" + s + "/").join(", ")})
- An AS: ${SITE}/AS4134 (every language: ${SITE}/zh-cn/AS4134 …)
- An address or prefix: ${SITE}/ip/8.8.8.8, ${SITE}/ip/1.0.0.0/24
- JSON: ${SITE}/api/as/4134 (record with every prefix), ${SITE}/api/ip/8.8.8.8 (AS and prefix), ${SITE}/api/me (your own address)
- Source code: https://github.com/yt1988/asn-lookup

- More 1ms.dog tools: https://1ms.dog/
`;
  // The only inline script is the pre-paint snippet, identical on every page: one hash covers the site.
  const csp = cspOf(sha(PREPAINT));
  files["_headers"] = `# Generated by scripts/build.mjs. The Worker sets the same headers on the pages it renders (src/worker.js).
/*
  Content-Security-Policy: ${csp}
${Object.entries(HEADERS).map(([k, v]) => `  ${k}: ${v}`).join("\n")}
/assets/*
  Cache-Control: public, max-age=604800
/assets/app.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/l.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/fonts/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/share/*
  ! Cache-Control
  Cache-Control: public, max-age=0, must-revalidate
/og/*
  Cache-Control: public, max-age=86400
/flags/*
  Cache-Control: public, max-age=2592000
/data/*
  Cache-Control: public, max-age=3600
  Access-Control-Allow-Origin: *
/tpl/*
  X-Robots-Tag: noindex
/sitemaps/*
  Cache-Control: public, max-age=3600
/llms.txt
  Access-Control-Allow-Origin: *
  Content-Type: text/plain; charset=utf-8
`;

  // generated files that are no longer produced (old hashes) are stale too
  const gen = async () => (await readdir(new URL("assets/", pub))).filter(f => /^(app|l)\..+\.(js|css)$/.test(f)).map(f => "assets/" + f);
  const stale = [];
  for (const [f, body] of Object.entries(files)) {
    let cur = null; try { cur = await readFile(new URL(f, pub), "utf8"); } catch (e) {}
    if (cur !== body) stale.push(f);
  }
  const orphans = (await gen()).filter(f => !(f in files));
  if (check) return [...stale, ...orphans];
  for (const f of stale) { await mkdir(new URL(".", new URL(f, pub)), { recursive: true }); await writeFile(new URL(f, pub), files[f]); }
  for (const f of orphans) await rm(new URL(f, pub));
  return [...stale, ...orphans];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const changed = await build({ check });
  if (check && changed.length) { console.error("public/ is out of date: " + changed.join(", ") + "\nRun npm run build and commit public/."); process.exit(1); }
  console.log(check ? "public/ is up to date" : changed.length ? "wrote " + changed.join(", ") : "nothing to do");
}
