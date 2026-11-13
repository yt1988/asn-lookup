// The sitemaps a data build writes (npm run data): every AS with a page is listed in every language, not only the
// announced ones (1ms-shell#99). Skipped when public/data/ is not built, as on a bare checkout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { LANGS } from "../src/langs.mjs";
import { continentOf } from "../src/region.mjs";

const pub = new URL("../public/", import.meta.url);
const built = existsSync(new URL("data/meta.json", pub)) && existsSync(new URL("sitemaps/", pub));
// the same origin the data build wrote the sitemaps with
const SITE = (process.env.SITE_URL || "https://asn.1ms.dog").replace(/\/+$/, "");

test("every AS with a page is in the sitemaps of every language", { skip: built ? false : "run npm run data first" }, async () => {
  const meta = JSON.parse(await readFile(new URL("data/meta.json", pub), "utf8"));
  const files = (await readdir(new URL("sitemaps/", pub))).filter(f => /^as-.+\.xml$/.test(f));
  let urls = 0, all = "";
  for (const f of files) { const s = await readFile(new URL("sitemaps/" + f, pub), "utf8"); all += s; urls += (s.match(/<url>/g) || []).length; }
  // one URL per AS page per language: the page count in data/meta.json is the sitemap URL count
  assert.equal(urls, meta.pages * LANGS.length);
  assert.ok(files.length >= LANGS.length, "a sitemap shard per language at least");
  // the reason for #99: more pages than announced AS numbers, and a page with no visible announcement is listed too
  assert.ok(meta.pages > meta.announced);
  const b1 = JSON.parse(await readFile(new URL("data/as/1.json", pub), "utf8"));
  const quiet = Object.entries(b1).find(([, r]) => !("n4" in r));
  assert.ok(quiet, "a record with no n4/n6 to test with");
  assert.match(all, new RegExp(`<loc>[^<]*\\/AS${quiet[0]}<\\/loc>`));
  assert.doesNotMatch(all, new RegExp(`\\/AS${quiet[0]}\\/<`));   // no trailing slash: /AS6427/ redirects
});

test("the hub pages are in every language's sitemap", { skip: built ? false : "run npm run data first" }, async () => {
  for (const [lang, slug] of LANGS) {
    const xml = await readFile(new URL(`sitemaps/hub-${slug || "en"}.xml`, pub), "utf8").catch(() => "");
    const p = slug ? `/${slug}/` : "/";
    for (const u of ["today", "top", "moas"]) assert.ok(xml.includes(`<loc>${SITE}${p}${u}</loc>`), `${lang}: ${u}`);
    assert.match(xml, new RegExp(`<loc>${SITE}${p}country/[A-Z]{2}</loc>`), lang);
    assert.match(xml, new RegExp(`<loc>${SITE}${p}rir/[a-z]+</loc>`), lang);
  }
});

test("every country in the list belongs to a continent", { skip: built ? false : "run npm run data first" }, async () => {
  const idx = JSON.parse(await readFile(new URL("data/cc/index.json", pub), "utf8"));
  const miss = idx.map(([cc]) => cc).filter(cc => !continentOf(cc));
  assert.deepEqual(miss, [], "a country the continent buttons cannot reach");
});

test("Chinese and Japanese names are searchable", { skip: built ? false : "run npm run data first" }, async () => {
  const cjk = JSON.parse(await readFile(new URL("data/find/cjk.json", pub), "utf8"));
  for (const [q, asn] of [["中国电信", 4134], ["中國電信", 4134], ["中国联通", 4837], ["中华电信", 3462]]) {
    assert.ok((cjk[q] || []).includes(asn), q);
  }
});
