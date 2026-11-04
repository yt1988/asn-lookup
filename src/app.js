// asn-lookup page. The server renders every page complete (src/render.mjs); this adds the live parts into rows that
// are already drawn: the visitor's own address on the home page, the registry record and reverse DNS, the neighbours,
// the full prefix list on demand. Strings: window.L1MS.
import { knownName } from "./popular.mjs";
import { regionName, flagCode } from "./region.mjs";

(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const D = JSON.parse($("#data").textContent);
  const L = window.L1MS || {}, LANG = D.lang, HOME = D.paths[LANG];
  const t = (k, v) => { let s = L[k] ?? k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const K = { theme: "asn:theme", lang: "asn:lang" };
  const country = cc => { try { return regionName(cc, LANG); } catch (e) { return cc; } };
  const flag = cc => /^[A-Z]{2}$/.test(cc || "") ? `<img class="flag" src="/flags/${flagCode(cc)}.svg" alt="" width="20" height="15">` : "";
  const num = n => new Intl.NumberFormat(LANG).format(n);
  const meta = n => { const m = document.querySelector(`meta[name="${n}"]`); return m && /^https:\/\//.test(m.content) ? m.content.replace(/\/+$/, "") : ""; };
  const getJ = (u, ms = 9000) => fetch(u, { credentials: "omit", signal: AbortSignal.timeout(ms) }).then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)));
  const asLink = (a, name, cc) => `<a class="asl" href="${HOME}AS${a}"><b>AS${a}</b>${name ? ` <span>${esc(name)}</span>` : ""}${cc ? " " + flag(cc) : ""}</a>`;
  const NA = `<span class="m">${esc(t("na"))}</span>`;

  /* ---------- theme and language (synced across the 1ms.dog tools) ---------- */
  const thBtn = $("#theme"), TH = ["system", "light", "dark"];
  const applyTheme = th => {
    if (th === "light" || th === "dark") document.documentElement.setAttribute("data-theme", th); else document.documentElement.removeAttribute("data-theme");
    thBtn.dataset.th = th; thBtn.title = t("th_" + th); thBtn.setAttribute("aria-label", t("th_" + th));
  };
  applyTheme(TH.includes(store.get(K.theme)) ? store.get(K.theme) : "system");
  thBtn.onclick = () => { const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3]; store.set(K.theme, n); applyTheme(n); };
  $("#lang").onchange = e => { const l = e.target.value; store.set(K.lang, l); location.href = D.paths[l] + D.rest + location.search; };

  /* ---------- help ---------- */
  function openDlg(id) { $("#" + id).hidden = false; document.documentElement.style.overflow = "hidden"; $("#" + id + " [data-close]").focus(); }
  function closeDlg() { $$(".scrim").forEach(s => { s.hidden = true; }); document.documentElement.style.overflow = ""; }
  $$("[data-close]").forEach(b => { b.onclick = closeDlg; });
  $$(".scrim").forEach(s => s.addEventListener("click", e => { if (e.target === s) closeDlg(); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDlg(); });
  let helpIdx = 0;
  const helpN = $$("#helpNav [data-hq]").length;
  $("#helpSel").innerHTML = $$("#helpNav [data-hq]").map((b, i) => `<option value="${i}">${i + 1} / ${helpN} · ${esc(b.textContent)}</option>`).join("");
  function showHelp(i) {
    helpIdx = Math.max(0, Math.min(helpN - 1, i));
    $$("#helpNav [data-hq]").forEach(b => b.setAttribute("aria-selected", +b.dataset.hq === helpIdx));
    $$("#helpC [data-hqb]").forEach(a => { a.hidden = +a.dataset.hqb !== helpIdx; });
    $("#helpSel").value = helpIdx;
    $$("[data-hstep]").forEach(b => { b.disabled = helpIdx + +b.dataset.hstep < 0 || helpIdx + +b.dataset.hstep >= helpN; });
    $("#helpC").scrollTop = 0;
  }
  $("#helpBtn").onclick = () => { showHelp(helpIdx); openDlg("help"); };
  $$("#helpNav [data-hq]").forEach(b => { b.onclick = () => showHelp(+b.dataset.hq); });
  $("#helpSel").onchange = e => showHelp(+e.target.value);
  $$("[data-hstep]").forEach(b => { b.onclick = () => showHelp(helpIdx + +b.dataset.hstep); });

  /* ---------- search box: what the server couldn't read comes back with ?e= ---------- */
  const q = new URLSearchParams(location.search), form = $(".ask");
  if (form && q.get("e")) {
    $("#q").value = q.get("s") || "";
    const tip = form.appendChild(Object.assign(document.createElement("p"), { className: "err", role: "alert", textContent: t(q.get("e") === "dns" ? "e_dns" : "e_bad") }));
    $("#q").addEventListener("input", () => tip.remove(), { once: true });
    history.replaceState(null, "", location.pathname);
  }

  /* ---------- toast ---------- */
  let toastEl, toastT;
  function toast(s) {
    if (!toastEl) toastEl = document.body.appendChild(Object.assign(document.createElement("div"), { className: "toast", role: "status" }));
    toastEl.textContent = s; toastEl.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 1600);
  }
  const copy = s => navigator.clipboard.writeText(s);

  /* ---------- share: the 1ms.dog share dialog (1ms-shell assets/share/, copied verbatim to /assets/share/) ---------- */
  // The page is the result, so the link names the page: /r/1~<when shared>~<AS4134 or ip/…> (src/worker.js), which
  // opens it with the banner below. The card (D.card, from the server): the AS or address, its name, then a grid of
  // facts { k, v, cc (a flag), mono, wide (the full width) }.
  const shareBtn = $("#shareBtn");
  if (shareBtn && D.card) {
    shareBtn.hidden = false;
    shareBtn.onclick = async () => {
      const { share } = await import("/assets/share/share.js?v=7");
      const url = location.origin + HOME + "r/1~" + Date.now().toString(36) + "~" + D.rest;
      share({
        lang: LANG, name: t("app_name"), file: D.card.big.replace(/[^\w.-]+/g, "_"),
        link: () => url, home: location.origin + HOME, text: () => document.title,
        height: async (x, kit) => Math.max(630, await drawCard(x, kit, D.card, false) + 70), draw: (x, kit) => drawCard(x, kit, D.card),
        ts: Date.parse(D.card.ts) || Date.now(),
      }).open();
    };
  }
  // someone's shared AS or address: the banner above it, whose button looks up the visitor's own (their AS on an AS
  // page, their address on an address page)
  if (D.shared) import("/assets/share/share.js?v=7").then(({ received }) => received({
    lang: LANG, ts: D.shared, at: $(".hero"),
    test: async () => {
      try {
        const me = await getJ("/_ms/me", 4000).catch(() => getJ("/api/me")), asn = me.asn || (me.cf && me.cf.asn);
        location.href = HOME + (D.page === "as" && asn ? "AS" + asn : "ip/" + me.ip);
      } catch (e) { location.href = HOME; }
    },
  }), () => {});
  // The card shows every word (1ms-shell docs/tool-contract.md, "Share card"): the AS or address shrinks to fit, the
  // name and handle wrap, a fact too long for half the width takes the whole row, and the card grows to hold it all.
  // Without draw (the height pass) it only measures: returns the bottom of the last line.
  async function drawCard(x, kit, c, draw = true) {
    const { W, P, F, M, v, wrap, img } = kit, w = W - P * 2;
    const text = (s, ax, ay, font, color) => { x.font = font; if (draw) { x.fillStyle = v(color); x.fillText(s, ax, ay); } };
    x.textBaseline = "alphabetic"; x.textAlign = "left";
    let z = 72;   // the AS or address, monospaced: a long IPv6 address shrinks
    for (; z > 40; z -= 2) { x.font = `700 ${z}px ${M}`; if (x.measureText(c.big).width <= w) break; }
    let y = kit.top + 78;
    text(c.big, P, y, `700 ${z}px ${M}`, "ink");
    x.font = `650 38px ${F}`; y += 56;
    for (const l of wrap(x, c.name, w, 3)) { text(l, P, y, x.font, "fg"); y += 48; }
    y -= 48;
    if (c.sub) { x.font = `500 24px ${M}`; y += 38; for (const l of wrap(x, c.sub, w, 2)) { text(l, P, y, x.font, "muted"); y += 32; } y -= 32; }
    // the facts, two to a row; a wide one, or one too long for half the width, takes the whole row
    let col = 0; y += 50;
    for (const r of c.rows) {
      const flag = r.cc && /^[A-Z]{2}$/.test(r.cc) ? 52 : 0, vf = `600 30px ${r.mono ? M : F}`;
      x.font = vf;
      const wide = r.wide || x.measureText(r.v).width + flag > w / 2 - 20;
      if (wide && col) { col = 0; y += 96; }
      const cw = wide ? w : w / 2 - 20, ax = P + col * (w / 2 + 20);
      x.font = `600 22px ${F}`;
      const k = wrap(x, r.k, cw, 1)[0];   // labels are short; one too long is the last resort's to clip
      text(k, ax, y, x.font, "muted");
      if (flag && draw) { try { x.drawImage(await img(`/flags/${flagCode(r.cc)}.svg`), ax, y + 16, 40, 30); } catch (e) {} }
      x.font = vf;
      const ls = wrap(x, r.v, cw - flag, 2);
      ls.forEach((l, i) => text(l, ax + flag, y + 42 + i * 38, vf, "fg"));
      const extra = (ls.length - 1) * 38;
      if (wide || col) { col = 0; y += 96 + extra; } else col = 1;
    }
    return (col ? y + 96 : y) - 54;
  }

  // fill the live rows of a key–value list: data-r="<field>" → value
  const fillRows = (vals) => $$("[data-r]").forEach(li => { const v = vals[li.dataset.r]; li.querySelector("b").innerHTML = v ? v : NA; });
  const mail = e => e ? `<a href="mailto:${esc(e)}">${esc(e)}</a>` : "";

  /* ---------- home: the visitor's own address ---------- */
  // Who the visitor is (address, AS, organization, location) comes from the 1ms.dog shell's /_ms/me, Cloudflare's view
  // of this connection; the prefix comes from our BGP data. Self-hosted without the shell, /_ms/me is a 404 and
  // /api/me answers all of it. me: { ip, asn, org, country, city }; hit: a lookup of me.ip (null while it loads).
  if (D.page === "home") {
    const row = (s, v) => { $(s + " b").innerHTML = v || NA; };
    const show = (me, hit) => {
      const asn = me.asn || (hit && hit.asn), same = hit && hit.asn === asn;
      row("#meIp", `<a class="mono" href="${HOME}ip/${esc(me.ip)}">${esc(me.ip)}</a>`);
      row("#meAs", asn && asLink(asn, knownName(asn, LANG) || me.org || (same && hit.name), same && hit.cc));
      if (hit) row("#mePfx", hit.prefix && `<a class="mono" href="${HOME}ip/${esc(hit.prefix)}">${esc(hit.prefix)}</a>`);
      const loc = me.country ? [me.city, country(me.country)].filter(Boolean).join(", ") : "";
      row("#meLoc", loc && `${flag(me.country)} ${esc(loc)}`);
      $("#meMore").href = `${HOME}ip/${encodeURIComponent(me.ip)}`;
      const ipqs = meta("ipqs"), egress = meta("egress");
      if (ipqs) Object.assign($("#lnIpqs"), { href: `${ipqs}${HOME}?ip=${encodeURIComponent(me.ip)}`, hidden: false });
      if (egress) Object.assign($("#lnEgress"), { href: egress + HOME, hidden: false });
    };
    const fallback = () => getJ("/api/me").then(r => {
      const cf = r.cf || {};
      show({ ip: r.ip, asn: r.asn || cf.asn, org: r.asn ? r.name : cf.org, country: cf.country, city: cf.city }, r);
    });
    getJ("/_ms/me", 4000).then(me => {
      if (!me || !me.ip) return fallback();
      show(me, null);
      return getJ(`/api/ip/${encodeURIComponent(me.ip)}`).then(hit => show(me, hit), () => show(me, {}));
    }, fallback).catch(() => { ["#meIp", "#meAs", "#mePfx", "#meLoc"].forEach(s => row(s)); });
  }

  /* ---------- an AS ---------- */
  if (D.page === "as" && D.asn != null) {
    getJ(`/api/rdap/as/${D.asn}`).then(r => fillRows({ org: esc(r.org || r.name), abuse: mail(r.abuse), upd: esc(r.upd || r.reg) })).catch(() => fillRows({}));
    if ($(".nb")) getJ(`/api/nb/${D.asn}`, 15000).then(r => {
      for (const k of ["up", "down", "un"]) {
        const col = $(`[data-nb="${k}"]`), list = r[k] || [];
        col.querySelector(".n").textContent = r.n && r.n[k] ? num(r.n[k]) : "";
        col.querySelector(".nbl").innerHTML = list.length
          ? list.map(([a, h, cc]) => `<li>${asLink(a, knownName(a, LANG) || h, cc)}</li>`).join("") + "<li></li>".repeat(Math.max(0, 8 - list.length))
          : `<li class="m">${esc(t("nb_none"))}</li>` + "<li></li>".repeat(7);
      }
    }).catch(() => $$(".nbl").forEach(ol => { ol.innerHTML = `<li class="m">${esc(t("na"))}</li>` + "<li></li>".repeat(7); }));

    // the full prefix lists, asked once for "show all" or "copy all"
    let full = null;
    const all = () => full || (full = getJ(`/api/as/${D.asn}`).catch(e => { full = null; throw e; }));
    const listOf = (f, r) => r["p" + f] || [];
    $$("[data-all]").forEach(b => { b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await all(), ul = $(`.pfx[data-f="${b.dataset.all}"] .plist`);
        ul.innerHTML = listOf(b.dataset.all, r).map(p => `<li><a href="${HOME}ip/${p}">${p}</a></li>`).join("");
        b.remove();
      } catch (e) { b.disabled = false; toast(t("na")); }
    }; });
    $$("[data-copy]").forEach(b => { b.onclick = async () => {
      try { await copy(listOf(b.dataset.copy, await all()).join("\n") + "\n"); toast(t("copied")); } catch (e) { toast(t("na")); }
    }; });
  }

  /* ---------- an address ---------- */
  if (D.page === "ip") {
    const ip = D.ip.split("/")[0], ipqs = meta("ipqs"), ln = $("#lnIpqs");
    if (ln && ipqs) Object.assign(ln, { href: `${ipqs}${HOME}?ip=${encodeURIComponent(ip)}`, hidden: false });
    // an IPv6 address: is the visitor's own network IPv6-ready (IPv6 Test)
    const v6 = meta("ipv6");
    if ($("#lnIpv6") && v6) Object.assign($("#lnIpv6"), { href: v6 + HOME, hidden: false });
    if (D.live) getJ(`/api/rdap/ip/${encodeURIComponent(ip)}`).then(r => fillRows({
      net: r.name ? esc(r.name) + (r.range ? `<span class="m mono"> · ${esc(r.range)}</span>` : "") : "",
      org: r.org ? esc(r.org) + (r.cc ? " " + flag(r.cc) : "") : "", ptr: r.ptr ? `<span class="mono">${esc(r.ptr)}</span>` : "", abuse: mail(r.abuse),
    })).catch(() => fillRows({}));
  }
})();
