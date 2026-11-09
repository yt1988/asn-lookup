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
  // what the page looked up and fetched as it ran, kept for the report dialog at the end (1ms-shell docs/tool-contract.md,
  // "报告问题"): the visitor's own address and the one they looked up are masked there
  const live = {};

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
      const { share } = await import("/assets/share/share.js?v=9");
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
  if (D.shared) import("/assets/share/share.js?v=9").then(({ received }) => received({
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

  /* ---------- the routing history (history/README.md) ---------- */
  const day = s => { try { return new Intl.DateTimeFormat(LANG, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(s + "T00:00:00Z")); } catch (e) { return s; } };
  const rpkiTag = c => `<span class="rp rp-${c}">${esc(t("rpki_" + c))}</span>`;
  // the prefix counts as two step lines (IPv4, and IPv6 when there is any), each scaled to its own range, from the first
  // day recorded (or 400 days back) to the last run; before there are two days to draw, a line saying so
  function spark(h) {
    const D0 = s => Date.parse(s + "T00:00:00Z") / 864e5, end = D0(h.day), pts = h.n || [];
    const start = Math.max(D0(h.since), end - 400);
    if (end <= start || !pts.length) return `<p class="m">${esc(t("hist_new", { since: day(h.since) }))}</p>`;
    const W = 600, H = 64, x = d => ((Math.max(d, start) - start) / (end - start)) * W;
    const line = i => {
      const v = pts.map(p => p[i]), lo = Math.min(...v), hi = Math.max(...v), y = n => hi === lo ? H / 2 : 4 + (1 - (n - lo) / (hi - lo)) * (H - 8);
      let d = "";
      pts.forEach((p, k) => { d += (k ? `H${x(D0(p[0])).toFixed(1)}V` : `M${x(D0(p[0])).toFixed(1)},`) + y(p[i]).toFixed(1); });
      return d + `H${W}`;
    };
    const has6 = pts.some(p => p[2]);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(t("hist_trend"))}">` +
      (has6 ? `<path class="l6" d="${line(2)}"/>` : "") + `<path class="l4" d="${line(1)}"/></svg>` +
      `<div class="ax m"><span>${esc(day(new Date(start * 864e5).toISOString().slice(0, 10)))}</span>` +
      `<span><i class="k4"></i>IPv4${has6 ? ' <i class="k6"></i>IPv6' : ""}</span><span>${esc(day(h.day))}</span></div>`;
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
      live.me = me; live.hit = hit;
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
    getJ(`/api/rdap/as/${D.asn}`).then(r => { live.rdap = r; fillRows({ org: esc(r.org || r.name), abuse: mail(r.abuse), upd: esc(r.upd || r.reg) }); }).catch(() => fillRows({}));
    if ($(".nb")) getJ(`/api/nb/${D.asn}`, 15000).then(r => {
      live.nb = r;
      for (const k of ["up", "down", "un"]) {
        const col = $(`[data-nb="${k}"]`), list = r[k] || [];
        col.querySelector(".n").textContent = r.n && r.n[k] ? num(r.n[k]) : "";
        col.querySelector(".nbl").innerHTML = list.length
          ? list.map(([a, h, cc]) => `<li>${asLink(a, knownName(a, LANG) || h, cc)}</li>`).join("") + "<li></li>".repeat(Math.max(0, 8 - list.length))
          : `<li class="m">${esc(t("nb_none"))}</li>` + "<li></li>".repeat(7);
      }
    }).catch(() => $$(".nbl").forEach(ol => { ol.innerHTML = `<li class="m">${esc(t("na"))}</li>` + "<li></li>".repeat(7); }));

    // the routing history: prefix counts over time, RPKI, the latest prefixes started or stopped, the invalid ones and
    // those other ASes announce too; the card stays hidden without it
    if ($("#hist")) getJ(`/api/hist/${D.asn}`).then(h => {
      if (!h || !h.since) return;
      live.hist = h;
      const px = Object.entries(h.px || {}), last = (h.n || []).slice(-1)[0];
      $("#hN").textContent = last ? `IPv4 ${num(last[1])} · IPv6 ${num(last[2])}` : "";
      $("#hSpark").innerHTML = spark(h);
      $("#hRpki").innerHTML = [["v", 1], ["i", 2], ["n", 0]].map(([c, i]) => `<li><span>${rpkiTag(c)}</span><b>${num(h.rpki[i])}</b></li>`).join("");
      $("#hEv").innerHTML = h.ev.length ? h.ev.slice(0, 12).map(([d, up, p]) =>
        `<li><time class="m">${esc(day(d))}</time><span class="ev ev${up}">${up ? "+" : "−"}</span><a class="mono" href="${HOME}ip/${esc(p)}">${esc(p)}</a><span class="m">${esc(t(up ? "ev_up" : "ev_down"))}</span></li>`).join("")
        : `<li class="m">${esc(t("hist_none", { since: day(h.since) }))}</li>`;
      const block = (k, list, row) => list.length ? `<div><div class="sec-h"><span>${esc(t(k))}</span><span class="n">${num(list.length)}</span></div><ul class="hl">${list.slice(0, 24).map(row).join("")}</ul></div>` : "";
      const pl = p => `<a class="mono" href="${HOME}ip/${esc(p)}">${esc(p)}</a>`;
      $("#hFlag").innerHTML = block("hist_inv", px.filter(([, e]) => e[1] === "i"), ([p]) => `<li>${pl(p)}</li>`) +
        block("hist_moas", px.filter(([, e]) => e[3] && e[3].length), ([p, e]) => `<li>${pl(p)}<span>${e[3].map(a => asLink(a)).join(" ")}</span></li>`);
      $("#hNote").textContent = t("hist_note", { since: day(h.since) });
      $("#hist").hidden = false;
    }).catch(() => {});

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
    // one address: can the world reach it (Reach Check, the address filled in, started by the visitor)
    const reach = meta("reach");
    if ($("#lnReach") && reach) Object.assign($("#lnReach"), { href: `${reach}${HOME}?t=${encodeURIComponent(ip)}`, hidden: false });
    // the announced prefix's history: its RPKI state, since when it is announced, other ASes announcing it now or before
    const hRow = (k, v) => { const li = $(`[data-h="${k}"]`); if (li) li.querySelector("b").innerHTML = v; };
    const hGone = () => $$("[data-h]").forEach(li => li.remove());
    if (D.asn && D.pfx) getJ(`/api/hist/${D.asn}`).then(h => {
      const e = h && h.px && h.px[D.pfx];
      if (!e) return hGone();
      live.hist = h; live.hpx = e;
      hRow("rpki", rpkiTag(e[1]) + (e[2] > h.since ? ` <span class="m">${esc(t("since_d", { date: day(e[2]) }))}</span>` : ""));
      hRow("seen", esc(e[0] > h.since ? day(e[0]) : t("seen_before", { date: day(h.since) })));
      const ul = $('[data-h="seen"]').parentNode, add = (k, v) => ul.insertAdjacentHTML("beforeend", `<li><span>${esc(t(k))}</span><b>${v}</b></li>`);
      if (e[3] && e[3].length) add("k_moas", e[3].map(a => asLink(a)).join(" "));
      if (e[4] && e[4].length) add("k_was", e[4].map(([a, f, l]) => `${asLink(a)} <span class="m">${esc(day(f))} – ${esc(day(l))}</span>`).join("<br>"));
    }).catch(hGone);
    // ?v=2: past the empty records the edge cached while ARIN failed (2026-11), kept a day under the old address
    if (D.live) getJ(`/api/rdap/ip/${encodeURIComponent(ip)}?v=2`).then(r => { live.rdap = r; fillRows({
      net: r.name ? esc(r.name) + (r.range ? `<span class="m mono"> · ${esc(r.range)}</span>` : "") : "",
      org: r.org ? esc(r.org) + (r.cc ? " " + flag(r.cc) : "") : "", ptr: r.ptr ? `<span class="mono">${esc(r.ptr)}</span>` : "", abuse: mail(r.abuse),
    }); }).catch(() => fillRows({}));
  }

  /* ---------- reporting a problem (the host's dialog; 1ms-shell docs/tool-contract.md, "报告问题") ---------- */
  // The dialog calls this when it opens and shows the answer folded under "This result": a line saying what was looked
  // up, the values as JSON (6 KB at most), and the readings as one-tap answers. It is what the page shows — the AS and
  // its registry record, the prefixes it lists, the neighbours, the routing history; or the address, its network and
  // reverse DNS — with no whole address in it: the visitor's own and the one they looked up are masked, as on a shared
  // link, and nothing a share dialog keeps back by default is included.
  const maskIp = ip => !ip ? "" : ip.indexOf(":") >= 0 ? ip.split(":").slice(0, 2).join(":") + ":…" : ip.split(".").slice(0, 2).join(".") + ".•.•";
  const RS = /^(zh|ja)/.test(LANG) ? "：" : ": ";
  // the total under a family's heading (the page's own count, not the number of rows it lists), and the rows it lists
  const pCount = f => { const el = $(`.pfx[data-f="${f}"] .sec-h .n`); return el ? +el.textContent.replace(/\D/g, "") || 0 : 0; };
  const pList = (f, n) => $$(`.pfx[data-f="${f}"] .plist a`).slice(0, n).map(a => a.textContent.trim());
  // the neighbours as the page draws them: the three busiest of each column, "AS<number> <name>"
  const nbPack = r => { const out = {}; for (const k of ["up", "down", "un"]) { const l = (r[k] || []).slice(0, 3).map(x => "AS" + x[0] + (x[1] ? " " + x[1] : "")); if (l.length) out[k] = l; } return out; };
  // the history's line at a glance: when the records began, the last day's counts, the RPKI split and the last changes
  const histPack = h => ({ since: h.since, day: h.day, rpki: h.rpki,
    ...((h.n || []).length ? { last: h.n[h.n.length - 1] } : {}), ...((h.ev || []).length ? { ev: h.ev.slice(-3) } : {}) });

  window.msReport = () => {
    const picks = [], pick = (k, v) => { if (v && v !== "–") picks.push((t(k) + RS + v).slice(0, 60)); };

    // the visitor's own address (home): masked, the country without the city
    if (D.page === "home") {
      const me = live.me;
      if (!me || !me.ip) return null;
      const hit = live.hit || {}, asn = me.asn || hit.asn || null,
        name = asn ? knownName(asn, LANG) || hit.holder || me.org || "" : "", ip = maskIp(me.ip),
        as = asn ? "AS" + asn + (name ? " " + name : "") : "";
      const summary = [ip, as, hit.prefix || ""].filter(Boolean).join(" · ").slice(0, 300);
      const data = { p: "home", ip, ...(asn ? { asn } : {}), ...(name ? { name } : {}),
        ...(hit.prefix ? { pfx: hit.prefix } : {}), ...(me.country ? { cc: me.country } : {}), ...(me.org ? { org: me.org } : {}) };
      pick("k_ip", ip); pick("k_as", as); pick("k_pfx", hit.prefix); pick("k_loc", me.country ? country(me.country) : ""); pick("k_org", me.org);
      return { summary, data, picks };
    }

    // an AS: who holds it (our data and the registry's live record), what it announces, what it is connected to
    if (D.page === "as" && D.asn != null) {
      const c = D.card || {}, row = i => (c.rows || [])[i] || {}, r = live.rdap || {}, as = "AS" + D.asn;
      const routed = !!$(".pfx"), name = c.name || "", cc = row(0).v || "", rir = row(1).v || "";
      const n4 = pCount("4"), n6 = pCount("6"), p4 = pList("4", 8), p6 = pList("6", 4);
      const summary = [as, name, cc, rir, routed ? t("h_pfx4") + " " + num(n4) + " · " + t("h_pfx6") + " " + num(n6) : ""]
        .filter(Boolean).join(" · ").slice(0, 300);
      const data = { p: "as", asn: D.asn, ...(name ? { name } : {}), ...(c.sub ? { holder: c.sub } : {}),
        ...(row(0).cc ? { cc: row(0).cc } : {}), ...(rir ? { rir } : {}), ...(D.x ? { truncated: 1 } : {}) };
      if (routed) { data.n4 = n4; data.n6 = n6; }
      if (r.org) data.org = r.org;
      if (r.abuse) data.abuse = r.abuse;
      if (r.upd) data.upd = r.upd;
      if (p4.length) data.p4 = p4;
      if (p6.length) data.p6 = p6;
      if (live.nb) data.nb = nbPack(live.nb);
      if (live.hist) data.hist = histPack(live.hist);
      pick("k_as", as); pick("k_name", name); pick("k_cc", cc); pick("k_org", r.org); pick("k_rir", rir);
      if (routed) { pick("h_pfx4", num(n4)); pick("h_pfx6", num(n6)); }
      if (live.hist && live.hist.since) pick("h_hist", day(live.hist.since));
      return { summary, data, picks };
    }

    // an address: the AS announcing it, the prefix holding it and the live record (the address itself masked)
    if (D.page === "ip") {
      const c = D.card || {}, row = i => (c.rows || [])[i] || {}, r = live.rdap || {}, e = live.hpx;
      const ip = (D.ip || "").indexOf("/") >= 0 ? D.ip : maskIp(D.ip || ""), asn = D.asn || null, as = asn ? "AS" + asn : "";
      const nm = asn && c.name ? String(c.name).split(" · ").slice(1).join(" · ").trim() : "", name = nm || "";
      const summary = [ip, as, name, D.pfx || "", r.org || ""].filter(Boolean).join(" · ").slice(0, 300);
      const data = { p: "ip", ip, ...(D.pfx ? { pfx: D.pfx } : {}) };
      if (asn) data.asn = asn;
      if (name) data.name = name;
      if (row(1).cc) data.cc = row(1).cc;
      if (r.name) data.net = r.name;
      if (r.org) data.org = r.org;
      if (r.ptr) data.ptr = r.ptr;
      if (r.abuse) data.abuse = r.abuse;
      if (e) data.hist = { since: live.hist.since, day: live.hist.day, rpki: e[1], first: e[0] };
      pick("k_pfx", D.pfx); pick("k_as", as); pick("k_ascc", row(1).v); pick("k_net", r.name);
      pick("k_org", r.org); pick("k_ptr", r.ptr);
      if (e) { pick("k_rpki", t("rpki_" + e[1])); pick("k_seen", day(e[0])); }
      return { summary, data, picks };
    }
    return null;
  };
})();
