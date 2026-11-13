// The pages a crawler gets: complete without JavaScript, with their own title, description, canonical and alternates
import { test } from "node:test";
import assert from "node:assert/strict";
import { STRINGS } from "../src/strings.mjs";
import { asPage, ipPage, head, findPage, hostPage, topPage, moasPage, browsePage, browseIndexPage, todayPage, toolsPage } from "../src/render.mjs";
import { search } from "../src/worker.js";

const site = "https://asn.example";
const T = l => k => STRINGS[l][k];
const rec = { h: "CHINANET-BACKBONE", n: "No.31,Jin-rong Street", cc: "CN", r: "APNIC", d: "2002-08-01", o: [[4809, "CHINATELECOM-CORE-WAN-CN2"]], on: 488,
  p4: ["1.48.0.0/15"], p6: ["240e::/20"], n4: 727, n6: 633, c4: 99036416, c6: 261030274, x: 1 };

test("an AS page names the network the way searchers do", () => {
  const r = asPage({ T: T("zh-CN"), lang: "zh-CN", site, asn: 4134, rec, meta: { at: "2026-11-01T00:00:00Z" } });
  assert.equal(r.status, 200);
  assert.equal(r.robots, undefined);   // index by default: the head() default
  assert.match(r.title, /^AS4134 中国电信 163 骨干网（CHINANET-BACKBONE）/);
  assert.match(r.main, /<h1><span class="asn">AS4134<\/span> <span>中国电信 163 骨干网<\/span><\/h1>/);
  assert.match(r.main, /727 个 IPv4 段/);
  assert.match(r.main, /是中国电信 163 骨干网（CHINANET-BACKBONE）在互联网上的网络编号（ASN），由 APNIC 分配。它目前/);   // no stray spaces in the lead
  assert.match(r.main, /href="\/zh-cn\/AS4809"/);
  assert.match(r.main, /href="\/zh-cn\/ip\/1.48.0.0\/15"/);
  assert.match(r.main, /data-all="4"/);   // more prefixes than the page lists
  const h = head({ T: T("zh-CN"), lang: "zh-CN", site, rest: "AS4134", title: r.title, desc: r.desc, graph: r.graph });
  assert.match(h, /<link rel="canonical" href="https:\/\/asn.example\/zh-cn\/AS4134">/);
  assert.match(h, /hreflang="x-default" href="https:\/\/asn.example\/AS4134"/);
  assert.match(h, /og:image" content="https:\/\/asn.example\/og\/zh-cn.png"/);
});

test("an unallocated AS is a 404 kept out of the index", () => {
  const r = asPage({ T: T("en"), lang: "en", site, asn: 4199999999, rec: null });
  assert.equal(r.status, 404);
  assert.equal(r.robots, "noindex, follow");
});

test("an AS with no visible announcement is still indexable (1ms-shell#99)", () => {
  // a record with no n4/n6 at all: allocated, nothing RIPE's RIS sees from it (AS6427, AS114, AS398892 …)
  const quiet = { h: "HURRICANE-ELEC", cc: "US", r: "ARIN", d: "1996-07-01" };
  const r = asPage({ T: T("en"), lang: "en", site, asn: 6427, rec: quiet });
  assert.equal(r.status, 200);
  assert.equal(r.robots, undefined);
  const h = head({ T: T("en"), lang: "en", site, rest: "AS6427", title: r.title, desc: r.desc, graph: r.graph });
  assert.match(h, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(h, /<link rel="canonical" href="https:\/\/asn.example\/AS6427">/);
});

test("an address page", () => {
  const r = ipPage({ T: T("en"), lang: "en", site, hit: { ip: "8.8.8.8", asn: 15169, rec: { h: "GOOGLE", cc: "US" }, pfx: "8.8.8.0/24", range: "8.8.8.0 – 8.8.8.255" } });
  assert.match(r.title, /^8\.8\.8\.8 belongs to AS15169 Google/);
  assert.match(r.main, /8\.8\.8\.0\/24/);
  assert.equal(r.robots, "noindex, follow");   // address and prefix pages stay out of the index
  const p = ipPage({ T: T("en"), lang: "en", site, hit: { ip: "10.0.0.1", private: true } });
  assert.match(p.main, /private or reserved/);
});

test("names and holders are escaped", () => {
  const r = asPage({ T: T("en"), lang: "en", site, asn: 64496, rec: { h: "<x>", n: "a&b", r: "ARIN", p4: [], p6: [], n4: 0, n6: 0 } });
  assert.ok(!r.main.includes("<x>"));
});

test("the search reads AS numbers in asdot, addresses, names and domains", async () => {
  const home = "/";
  assert.equal(await search("AS2.0", home), "/AS131072");      // 2 * 65536
  assert.equal(await search("1.10", home), "/AS65546");        // a small plain pair is asdot, not an address
  assert.equal(await search("AS4134", home), "/AS4134");
  assert.equal(await search("8.8.8.8", home), "/ip/8.8.8.8");
  assert.equal(await search("1.0.0.0/24", home), "/ip/1.0.0.0/24");
  assert.equal(await search("China Telecom", home), "/find?q=China%20Telecom");
  assert.match(await search("x", home), /e=bad/);              // too short to be a name
});

test("the pages that are not one AS or one address", () => {
  const m = { at: "2026-11-13T00:00:00Z" };
  const q = "cloudflare";
  const find = findPage({ T: T("en"), lang: "en", site, q, hits: [{ asn: 13335, h: "CLOUDFLARENET", cc: "US", n4: 10, n6: 2 }], meta: m });
  assert.equal(find.status, 200);
  assert.match(find.title, /cloudflare/);
  assert.match(find.main, /href="\/AS13335"/);
  assert.equal(find.robots, "noindex, follow");   // a search result stays out of the index

  const cc = browsePage({ T: T("en"), lang: "en", site, kind: "cc", key: "CN", rows: [[4134, "CHINANET-BACKBONE", "CN", 99036416]], meta: m });
  assert.match(cc.title, /China/);
  assert.match(cc.main, /href="\/AS4134"/);
  const idx = browseIndexPage({ T: T("en"), lang: "en", site, kind: "cc", rows: [["CN", 100, 2e8]], meta: m });
  assert.match(idx.main, /href="\/country\/CN"/);

  const top = topPage({ T: T("en"), lang: "en", site, top: { size: [[4134, "CHINANET-BACKBONE", "CN", 99036416]] }, meta: m });
  assert.match(top.main, /<span class="rk">1<\/span>/);
  assert.match(top.main, /href="\/AS4134"/);

  const moas = moasPage({ T: T("en"), lang: "en", site, moas: { all: 4740, list: [["1.0.0.0/24", [13335, 209242]]] }, meta: m });
  assert.match(moas.main, /4,740/);
  assert.match(moas.main, /href="\/ip\/1\.0\.0\.0\/24"/);

  const today = todayPage({ T: T("en"), lang: "en", site, hist: { day: "2026-11-13", routes: 1409958, added: 3433, gone: 3169, vrps: 1030828, ases: 87468 },
    newest: [[155097, "DUKENETWORK-AS-AP", "JP", "2026-11-10"]], meta: m });
  assert.match(today.main, /2026-11-13/);
  assert.match(today.main, /\+3,433/);
  assert.match(today.main, /−3,169/);
  assert.match(today.main, /AS155097/);
  const none = todayPage({ T: T("en"), lang: "en", site, hist: null, newest: [], meta: m });
  assert.match(none.desc, /isn't available/);   // the daily history is down: the page still answers

  const host = hostPage({ T: T("en"), lang: "en", site, host: "example.com", rows: [{ ip: "93.184.215.14", asn: 15133, rec: { h: "EDGECAST", cc: "US" }, pfx: "93.184.216.0/24" }], meta: m });
  assert.match(host.main, /93\.184\.215\.14/);
  assert.match(host.main, /href="\/AS15133"/);

  const tools = toolsPage({ T: T("en"), lang: "en", site, meta: m });
  assert.match(tools.main, /id="batchIn"/);
  assert.match(tools.main, /id="cidrIn"/);
});

test("TW is named 中国台湾 / Taiwan, China with the flag of China", () => {
  const tw = { h: "HINET-NET", cc: "TW", r: "APNIC", d: "1997-01-01", p4: [], p6: [], n4: 0, n6: 0, c4: 0, c6: 0 };
  for (const [lang, name] of [["zh-CN", "中国台湾"], ["zh-TW", "中國台灣"], ["en", "Taiwan, China"], ["ko", "중국 대만"], ["fr", "Taïwan, Chine"], ["ru", "Тайвань, Китай"]]) {
    const r = asPage({ T: T(lang), lang, site, asn: 3462, rec: tw });
    assert.ok(r.main.includes(`<img class="flag" src="/flags/cn.svg" alt="" width="20" height="15"> ${name}`), lang);
    assert.ok(r.desc.includes(name), lang);
    assert.doesNotMatch(r.main, /tw\.svg/);
  }
  const ip = ipPage({ T: T("ja"), lang: "ja", site, hit: { ip: "168.95.1.1", asn: 3462, rec: tw, pfx: "168.95.0.0/16", range: "" } });
  assert.match(ip.main, /flags\/cn\.svg"[^>]*> 中国台湾/);
});
