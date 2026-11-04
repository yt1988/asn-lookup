// Every string a page shows comes from the language files, in every language: a missing key would show its name (or,
// worse, English) instead. Well-known network names are a brand (one string) or have all ten languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LANGS } from "../src/langs.mjs";
import { STRINGS } from "../src/strings.mjs";
import { KNOWN } from "../src/popular.mjs";

const read = f => readFile(new URL("../" + f, import.meta.url), "utf8");
const all = (s, re) => [...s.matchAll(re)].map(m => m[1]);

test("every language has every key, with the same placeholders", () => {
  const en = STRINGS.en;
  for (const [lang] of LANGS) {
    const d = STRINGS[lang];
    assert.deepEqual(Object.keys(en).filter(k => !(k in d)), [], `${lang} is missing keys`);
    // more plural forms than English (Russian key_few, key_many) are the language's own; anything else is extra
    const form = k => /^(\w+)_(zero|two|few|many)$/.exec(k);
    const ph = s => all(s, /\{(\w+)\}/g).sort().join(",");
    assert.deepEqual(Object.keys(d).filter(k => !(k in en) && !(form(k) && form(k)[1] in en)), [], `${lang} has extra keys`);
    for (const k in d) if (!(k in en)) assert.equal(ph(d[k]), ph(en[form(k)[1]]), `${lang}.${k} placeholders`);
    for (const k in en) {
      if (typeof en[k] !== "string") continue;
      assert.equal(ph(d[k]), ph(en[k]), `${lang}.${k} placeholders`);
    }
    assert.equal(d.docs.length, en.docs.length, `${lang} FAQ`);
  }
});

test("every key the code asks for exists", async () => {
  const [app, render, page, worker] = await Promise.all(["src/app.js", "src/render.mjs", "src/page.html", "src/worker.js"].map(read));
  const keys = new Set([
    ...all(app, /\bt\("(\w+)"[),]/g), ...all(render, /\bT\("(\w+)"\)/g), ...all(worker, /\bT\("(\w+)"\)/g),   // t("th_" + x) and the like: below
    ...all(page, /data-i="(\w+)"/g), ...all(page, /\{\{a:(\w+)\}\}/g),
    ...["system", "light", "dark"].map(x => "th_" + x), ...["cn", "cloud", "intl"].map(x => "g_" + x),
    ...["up", "down", "un"].map(x => "nb_" + x), "h_pfx4", "h_pfx6", ...["v", "i", "n"].map(x => "rpki_" + x),
  ]);
  for (const k of keys) assert.ok(k in STRINGS.en, `en lacks ${k}`);
});

test("well-known names: a brand or all ten languages", () => {
  for (const [asn, n] of Object.entries(KNOWN)) {
    if (typeof n === "string") continue;
    for (const [lang] of LANGS) assert.ok(typeof n[lang] === "string" && n[lang], `AS${asn} has no ${lang} name`);
  }
});

test("no English fallback in the code", async () => {
  for (const f of ["src/app.js", "src/render.mjs", "src/worker.js", "scripts/build.mjs"]) {
    assert.ok(!/\|\|\s*\w+(\.name)?\.en\b|\?\?\s*en\[|\[lang\]\s*\|\|/.test(await read(f)), f + " falls back to English");
  }
});
