// asn-lookup page. The server renders every page complete (src/render.mjs); this adds the live parts into rows that
// are already drawn: the visitor's own address on the home page, the registry record and reverse DNS, the neighbours,
// the full prefix list on demand. Strings: window.L1MS.
import { knownName } from "./popular.mjs";

(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const D = JSON.parse($("#data").textContent);
  const L = window.L1MS || {}, LANG = D.lang, HOME = D.paths[LANG];
  const t = (k, v) => { let s = L[k] ?? k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const K = { theme: "asn:theme", lang: "asn:lang" };
  const country = cc => { try { return new Intl.DisplayNames([LANG], { type: "region" }).of(cc); } catch (e) { return cc; } };
  const flag = cc => /^[A-Z]{2}$/.test(cc || "") ? `<img class="flag" src="/flags/${cc.toLowerCase()}.svg" alt="" width="20" height="15">` : "";
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
      const { share } = await import("/assets/share/share.js?v=4");
      const url = location.origin + HOME + "r/1~" + Date.now().toString(36) + "~" + D.rest;
      share({
        lang: LANG, name: t("app_name"), file: D.card.big.replace(/[^\w.-]+/g, "_"),
        link: () => url, home: location.origin + HOME, text: () => document.title,
        height: 630, draw: (x, kit) => drawCard(x, kit, D.card),
        ts: Date.parse(D.card.ts) || Date.now(),
      }).open();
    };
  }
  // someone's shared AS or address: the banner above it, whose button looks up the visitor's own (their AS on an AS
  // page, their address on an address page)
  if (D.shared) import("/assets/share/share.js?v=4").then(({ received }) => received({
    lang: LANG, ts: D.shared, at: $(".hero"),
    test: async () => {
      try {
        const me = await getJ("/_ms/me", 4000).catch(() => getJ("/api/me")), asn = me.asn || (me.cf && me.cf.asn);
        location.href = HOME + (D.page === "as" && asn ? "AS" + asn : "ip/" + me.ip);
      } catch (e) { location.href = HOME; }
    },
  }), () => {});
  async function drawCard(x, kit, c) {
    const { W, P, F, M, v, clip, img } = kit, w = W - P * 2;
    x.textBaseline = "alphabetic"; x.textAlign = "left";
    x.fillStyle = v("ink"); x.font = `700 72px ${M}`; x.fillText(clip(x, c.big, w), P, kit.top + 78);
    x.fillStyle = v("fg"); x.font = `650 38px ${F}`; x.fillText(clip(x, c.name, w), P, kit.top + 134);
    if (c.sub) { x.fillStyle = v("muted"); x.font = `500 24px ${M}`; x.fillText(clip(x, c.sub, w), P, kit.top + 172); }
    // the facts, two to a row; a wide one takes the whole row
    let col = 0, y = kit.top + 222;
    for (const r of c.rows) {
      if (r.wide && col) { col = 0; y += 96; }
      const cw = r.wide ? w : w / 2 - 20, ax = P + col * (w / 2 + 20);
      x.fillStyle = v("muted"); x.font = `600 22px ${F}`; x.fillText(clip(x, r.k, cw), ax, y);
      let vx = ax;
      if (r.cc && /^[A-Z]{2}$/.test(r.cc)) { try { x.drawImage(await img(`/flags/${r.cc.toLowerCase()}.svg`), ax, y + 16, 40, 30); vx += 52; } catch (e) {} }
      x.fillStyle = v("fg"); x.font = `600 30px ${r.mono ? M : F}`; x.fillText(clip(x, r.v, cw - (vx - ax)), vx, y + 42);
      if (r.wide || col) { col = 0; y += 96; } else col = 1;
    }
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
