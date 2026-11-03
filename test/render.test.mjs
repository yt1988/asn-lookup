// The pages a crawler gets: complete without JavaScript, with their own title, description, canonical and alternates
import { test } from "node:test";
import assert from "node:assert/strict";
import { STRINGS } from "../src/strings.mjs";
import { asPage, ipPage, head } from "../src/render.mjs";

const site = "https://asn.example";
const T = l => k => STRINGS[l][k];
const rec = { h: "CHINANET-BACKBONE", n: "No.31,Jin-rong Street", cc: "CN", r: "APNIC", d: "2002-08-01", o: [[4809, "CHINATELECOM-CORE-WAN-CN2"]], on: 488,
  p4: ["1.48.0.0/15"], p6: ["240e::/20"], n4: 727, n6: 633, c4: 99036416, c6: 261030274, x: 1 };

test("an AS page names the network the way searchers do", () => {
  const r = asPage({ T: T("zh-CN"), lang: "zh-CN", site, asn: 4134, rec, meta: { at: "2026-11-01T00:00:00Z" } });
  assert.equal(r.status, 200);
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

test("an address page", () => {
  const r = ipPage({ T: T("en"), lang: "en", site, hit: { ip: "8.8.8.8", asn: 15169, rec: { h: "GOOGLE", cc: "US" }, pfx: "8.8.8.0/24", range: "8.8.8.0 – 8.8.8.255" } });
  assert.match(r.title, /^8\.8\.8\.8 belongs to AS15169 Google/);
  assert.match(r.main, /8\.8\.8\.0\/24/);
  const p = ipPage({ T: T("en"), lang: "en", site, hit: { ip: "10.0.0.1", private: true } });
  assert.match(p.main, /private or reserved/);
});

test("names and holders are escaped", () => {
  const r = asPage({ T: T("en"), lang: "en", site, asn: 64496, rec: { h: "<x>", n: "a&b", r: "ARIN", p4: [], p6: [], n4: 0, n6: 0 } });
  assert.ok(!r.main.includes("<x>"));
});
