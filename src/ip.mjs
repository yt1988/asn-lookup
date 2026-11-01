// IP address helpers shared by the Worker, the page and the tests. No dependencies.

// "1.2.3.4" → 4, "2001:db8::1" → 6, anything else → 0. Accepts only canonical-looking text (no ports, no zones).
export function family(s) {
  s = String(s || "").trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s.split(".").every(o => +o <= 255 && (o === "0" || o[0] !== "0")) ? 4 : 0;
  return v6words(s) ? 6 : 0;
}

// The eight 16-bit words of an IPv6 address, or null when it isn't one (an embedded IPv4 tail is allowed).
export function v6words(s) {
  s = String(s || "").trim().toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(":") || s.length > 45) return null;
  let tail = [];
  const m = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (m) {
    if (family(m[2]) !== 4) return null;
    const o = m[2].split(".").map(Number);
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    s = m[1].endsWith("::") ? m[1] : m[1].slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = h => h === "" ? [] : h.split(":");
  const a = part(halves[0]), b = halves.length === 2 ? part(halves[1]) : [];
  if ([...a, ...b].some(w => !/^[0-9a-f]{1,4}$/.test(w))) return null;
  const fill = 8 - tail.length - a.length - b.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  return [...a, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...b].map(w => parseInt(w, 16)).concat(tail);
}

// Short canonical form (RFC 5952): lower case, longest run of zero words as "::". IPv4 is returned as is.
export function canon(s) {
  const f = family(s);
  if (f === 4) return String(s).trim();
  if (f !== 6) return "";
  const w = v6words(s);
  let best = -1, len = 0;
  for (let i = 0; i < 8;) {
    if (w[i]) { i++; continue; }
    let j = i; while (j < 8 && !w[j]) j++;
    if (j - i > len && j - i > 1) { best = i; len = j - i; }
    i = j;
  }
  const hex = w.map(x => x.toString(16));
  if (best < 0) return hex.join(":");
  return hex.slice(0, best).join(":") + "::" + hex.slice(best + len).join(":");
}

// Addresses no lookup service can say anything about: private, loopback, link-local, CGNAT, documentation, multicast…
export function isPublic(s) {
  const f = family(s);
  if (f === 4) {
    const [a, b, c] = s.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  if (f === 6) {
    const w = v6words(s);
    if ((w[0] & 0xe000) !== 0x2000) return false;            // only global unicast 2000::/3
    if (w[0] === 0x2001 && w[1] === 0xdb8) return false;     // documentation
    if (w[0] === 0x2001 && w[1] < 0x200) return false;       // Teredo, benchmarking, ORCHID…
    if (w[0] === 0x2002) return false;                       // 6to4: the real address is the IPv4 inside
    return true;
  }
  return false;
}

// "1.2.3.4" → 16909060 (unsigned), or null
export function v4num(s) {
  if (family(s) !== 4) return null;
  return s.split(".").reduce((n, o) => n * 256 + +o, 0);
}
export const v4str = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

// "2001:db8::1" → 128-bit BigInt, or null
export function v6big(s) {
  const w = v6words(s);
  return w ? w.reduce((n, x) => (n << 16n) | BigInt(x), 0n) : null;
}
export function v6str(n) {
  const w = [];
  for (let i = 7; i >= 0; i--) w.push(Number((n >> BigInt(i * 16)) & 0xffffn).toString(16));
  return canon(w.join(":"));
}

// The fewest CIDR blocks covering first…last (inclusive)
export function rangeToCidrs4(a, b) {
  const out = [];
  while (a <= b) {
    let size = 32;
    while (size > 0) {
      const block = 2 ** (32 - size + 1);
      if (a % block !== 0 || a + block - 1 > b) break;
      size--;
    }
    out.push(v4str(a) + "/" + size);
    a += 2 ** (32 - size);
  }
  return out;
}
export function rangeToCidrs6(a, b) {
  const out = [];
  while (a <= b) {
    let size = 128;
    while (size > 0) {
      const block = 1n << BigInt(128 - size + 1);
      if (a % block !== 0n || a + block - 1n > b) break;
      size--;
    }
    out.push(v6str(a) + "/" + size);
    a += 1n << BigInt(128 - size);
  }
  return out;
}

// "1.2.3.0/24" or "2001:db8::/32" → { f, ip (the network's first address), len }, or null. A bare address is a /32 or /128.
export function parseCidr(s) {
  s = String(s || "").trim();
  const m = /^([^/\s]+)(?:\/(\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const f = family(m[1]), max = f === 4 ? 32 : 128, len = m[2] === undefined ? max : +m[2];
  if (!f || len > max) return null;
  if (f === 4) { const n = v4num(m[1]), mask = len ? 2 ** 32 - 2 ** (32 - len) : 0; return { f, ip: v4str(Math.floor(n / 2 ** (32 - len)) * 2 ** (32 - len) >>> 0), len, mask }; }
  const n = v6big(m[1]), k = BigInt(128 - len);
  return { f, ip: v6str((n >> k) << k), len };
}

// Binary search in the address shards (scripts/data.mjs): the AS announcing the address, with the shard's range for it
export function find4(u32, n) {
  let lo = 0, hi = u32.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, s = u32[mid * 3], e = u32[mid * 3 + 1];
    if (n < s) hi = mid - 1; else if (n > e) lo = mid + 1; else return { first: s, last: e, asn: u32[mid * 3 + 2] };
  }
  return null;
}
export function find6(u32, big) {
  const top = big >> 64n, h = Number(top >> 32n), l = Number(top & 0xffffffffn);
  const cmp = (i, H, L) => H !== u32[i] ? (H < u32[i] ? -1 : 1) : L !== u32[i + 1] ? (L < u32[i + 1] ? -1 : 1) : 0;
  let lo = 0, hi = u32.length / 5 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, i = mid * 5;
    if (cmp(i, h, l) < 0) hi = mid - 1;
    else if (cmp(i + 2, h, l) > 0) lo = mid + 1;
    else {
      const first = ((BigInt(u32[i]) << 32n) | BigInt(u32[i + 1])) << 64n;
      const last = (((BigInt(u32[i + 2]) << 32n) | BigInt(u32[i + 3])) << 64n) | ((1n << 64n) - 1n);
      return { first, last, asn: u32[i + 4] };
    }
  }
  return null;
}
