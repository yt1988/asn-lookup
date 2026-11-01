import { test } from "node:test";
import assert from "node:assert/strict";
import { family, canon, isPublic, v4num, v4str, v6big, v6str, rangeToCidrs4, rangeToCidrs6, parseCidr, find4, find6 } from "../src/ip.mjs";
import { parseName } from "../scripts/data.mjs";

test("addresses", () => {
  assert.equal(family("8.8.8.8"), 4);
  assert.equal(family("2001:db8::1"), 6);
  assert.equal(family("08.8.8.8"), 0);
  assert.equal(canon("2001:0DB8:0:0:0:0:0:1"), "2001:db8::1");
  assert.equal(isPublic("10.1.2.3"), false);
  assert.equal(isPublic("1.1.1.1"), true);
  assert.equal(v4str(v4num("203.0.113.9")), "203.0.113.9");
  assert.equal(v6str(v6big("2400:9380:8001::1")), "2400:9380:8001::1");
});

test("ranges to CIDR blocks", () => {
  assert.deepEqual(rangeToCidrs4(v4num("1.0.0.0"), v4num("1.0.0.255")), ["1.0.0.0/24"]);
  assert.deepEqual(rangeToCidrs4(v4num("1.0.0.0"), v4num("1.0.2.255")), ["1.0.0.0/23", "1.0.2.0/24"]);
  assert.deepEqual(rangeToCidrs4(0, 2 ** 32 - 1), ["0.0.0.0/0"]);
  assert.deepEqual(rangeToCidrs6(v6big("2001:db8::"), v6big("2001:db8:ffff:ffff:ffff:ffff:ffff:ffff")), ["2001:db8::/32"]);
});

test("prefixes", () => {
  assert.deepEqual(parseCidr("1.2.3.4/24"), { f: 4, ip: "1.2.3.0", len: 24, mask: 2 ** 32 - 256 });
  assert.equal(parseCidr("2001:db8::1/32").ip, "2001:db8::");
  assert.equal(parseCidr("1.2.3.4").len, 32);
  assert.equal(parseCidr("1.2.3.4/33"), null);
  assert.equal(parseCidr("example.com"), null);
});

test("shard search", () => {
  const u = new Uint32Array([v4num("1.0.0.0"), v4num("1.0.0.255"), 13335, v4num("1.0.4.0"), v4num("1.0.7.255"), 38803]);
  assert.equal(find4(u, v4num("1.0.0.1")).asn, 13335);
  assert.equal(find4(u, v4num("1.0.5.9")).asn, 38803);
  assert.equal(find4(u, v4num("1.0.2.1")), null);
  const r = (s, e, a) => { const S = v6big(s) >> 64n, E = v6big(e) >> 64n; return [Number(S >> 32n), Number(S & 0xffffffffn), Number(E >> 32n), Number(E & 0xffffffffn), a]; };
  const u6 = new Uint32Array([...r("2001:4860::", "2001:4860:ffff:ffff::", 15169), ...r("2001:4861::", "2001:4861::", 1)]);
  assert.equal(find6(u6, v6big("2001:4860:4860::8888")).asn, 15169);
  assert.equal(find6(u6, v6big("2001:4862::1")), null);
});

test("AS names from RIPE's list", () => {
  assert.deepEqual(parseName("CHINANET-BACKBONE No.31,Jin-rong Street, CN"), { h: "CHINANET-BACKBONE", n: "No.31,Jin-rong Street", cc: "CN" });
  assert.deepEqual(parseName("CLOUDFLARENET - Cloudflare, Inc., US"), { h: "CLOUDFLARENET", n: "Cloudflare, Inc.", cc: "US" });
  assert.deepEqual(parseName("GOOGLE, US"), { h: "GOOGLE", n: "", cc: "US" });
});
