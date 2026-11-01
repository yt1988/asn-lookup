#!/usr/bin/env node
// Renders the link-preview images and the site icons with resvg (dev dependency):
//   public/og/<lang folder or "en">.png   1200 × 630: the headline beside a sample AS card, in the page's language
//   public/favicon.ico, favicon-32.png    the tab icon (the shell gives the installed app its own icons)
// Run when the headline or the look change, and commit the output. Uses system fonts for the text (Windows: Segoe UI,
// Microsoft YaHei, Microsoft JhengHei, Yu Gothic UI, Malgun Gothic).
// Usage: node scripts/og.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import { LANGS } from "../src/langs.mjs";
import { STRINGS } from "../src/strings.mjs";
import { knownName } from "../src/popular.mjs";

const pub = new URL("../public/", import.meta.url);
const render = (svg, w = 1200) => new Resvg(svg, { fitTo: { mode: "width", value: w }, font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" } }).render().asPng();
const logo = Buffer.from(await readFile(new URL("assets/logo-dark.svg", pub))).toString("base64");
const FONTS = { "zh-CN": "Microsoft YaHei", "zh-TW": "Microsoft JhengHei", ja: "Yu Gothic UI", ko: "Malgun Gothic" };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// the dark theme's colors (src/base.css)
const INK = "#2dd4bf", BG = "#1c1c1c", FG = "#ededed", MU = "#a0a0a0", PANEL = "#232323", LINE = "#363636";

const cjkOf = s => /[　-鿿가-힯]/.test(s);
const width = s => [...s].reduce((a, c) => a + (cjkOf(c) ? 2 : 1.05), 0);
// splits text into lines that fit `max` characters (a CJK character counts double), at spaces or anywhere in CJK
function lines(text, max, n) {
  const toks = cjkOf(text) ? text.match(/[A-Za-z0-9.+/-]+\s*|\s+|./g) : text.split(/(?<=\s)/);
  const out = []; let cur = "";
  for (const t of toks) { if (width(cur + t) > max && cur.trim()) { out.push(cur.trim()); cur = t.trimStart(); } else cur += t; }
  if (cur.trim()) out.push(cur.trim());
  return out.length > n ? [...out.slice(0, n - 1), out.slice(n - 1).join(" ").slice(0, max - 1) + "…"] : out;
}

function card(lang, d) {
  const ff = `${FONTS[lang] ? `'${FONTS[lang]}', ` : ""}'Segoe UI', 'Microsoft YaHei', sans-serif`, mono = "Consolas, 'Segoe UI', monospace";
  const head = lines(d.h1, 16, 2), sub = lines(d.og_sub, cjkOf(d.og_sub) ? 30 : 40, 3);
  const size = Math.min(80, Math.floor(1000 / Math.max(...head.map(width), 10)));
  const y0 = 290, subY = y0 + (head.length - 1) * (size + 8) + 60;
  const chip = d.app_name, chipW = 44 + [...chip].reduce((a, c) => a + (cjkOf(c) ? 23 : 13), 0);
  // the sample: the page of AS4134, as it shows in this language
  const name = knownName(4134, lang), x = 740, y = 150;
  const rows = [[d.k_cc, "CN"], [d.k_rir, "APNIC"], [d.k_v4, "727"], [d.k_v6, "633"]];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><radialGradient id="g" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(0 0) scale(900 700)">
    <stop offset="0" stop-color="${INK}" stop-opacity=".16"/><stop offset="1" stop-color="${INK}" stop-opacity="0"/></radialGradient></defs>
  <rect width="1200" height="630" fill="${BG}"/><rect width="1200" height="630" fill="url(#g)"/>
  <image href="data:image/svg+xml;base64,${logo}" x="80" y="64" width="150" height="60"/>
  <rect x="80" y="170" width="${chipW}" height="44" rx="22" fill="${INK}" fill-opacity=".14"/>
  <circle cx="104" cy="192" r="6" fill="${INK}"/>
  <text x="122" y="200" font-family="${ff}" font-size="22" font-weight="600" fill="${INK}">${esc(chip)}</text>
  ${head.map((l, i) => `<text x="80" y="${y0 + i * (size + 8)}" font-family="${ff}" font-size="${size}" font-weight="800" fill="${FG}" letter-spacing="-1">${esc(l)}</text>`).join("")}
  ${sub.map((l, i) => `<text x="80" y="${subY + i * 44}" font-family="${ff}" font-size="31" fill="${MU}">${esc(l)}</text>`).join("")}
  <text x="80" y="566" font-family="${ff}" font-size="24" font-weight="600" fill="${INK}">asn.1ms.dog</text>
  <rect x="${x}" y="${y}" width="390" height="330" rx="22" fill="${PANEL}" stroke="${LINE}" stroke-width="2"/>
  <text x="${x + 30}" y="${y + 62}" font-family="${mono}" font-size="38" font-weight="700" fill="${INK}">AS4134</text>
  ${lines(name, 28, 1).map(l => `<text x="${x + 30}" y="${y + 104}" font-family="${ff}" font-size="22" font-weight="700" fill="${FG}">${esc(l)}</text>`).join("")}
  ${rows.map(([k, v], i) => `<line x1="${x + 30}" x2="${x + 360}" y1="${y + 134 + i * 46}" y2="${y + 134 + i * 46}" stroke="${LINE}" stroke-width="2"/>
  <text x="${x + 30}" y="${y + 166 + i * 46}" font-family="${ff}" font-size="21" fill="${MU}">${esc(k)}</text>
  <text x="${x + 360}" y="${y + 166 + i * 46}" text-anchor="end" font-family="${mono}" font-size="22" font-weight="600" fill="${FG}">${esc(v)}</text>`).join("")}
</svg>`;
}

// the tab icon: a network of three linked nodes in the accent color
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0f8a7e"/>
  <g stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M10 22 16 10 22 22Z" fill="none"/></g>
  <g fill="#fff"><circle cx="16" cy="10" r="3.6"/><circle cx="10" cy="22" r="3.6"/><circle cx="22" cy="22" r="3.6"/></g></svg>`;
// an .ico holding one PNG
function ico(png) {
  const h = Buffer.alloc(22);
  h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4);
  h.writeUInt8(32, 6); h.writeUInt8(32, 7); h.writeUInt16LE(1, 10); h.writeUInt16LE(32, 12);
  h.writeUInt32LE(png.length, 14); h.writeUInt32LE(22, 18);
  return Buffer.concat([h, png]);
}

const out = new URL("og/", pub);
await mkdir(out, { recursive: true });
for (const [lang, slug] of LANGS) {
  await writeFile(new URL((slug || "en") + ".png", out), render(card(lang, STRINGS[lang])));
  console.log(`og/${slug || "en"}.png`);
}
const png32 = render(ICON, 32);
await writeFile(new URL("favicon-32.png", pub), png32);
await writeFile(new URL("favicon.ico", pub), ico(png32));
console.log("favicon.ico, favicon-32.png");
