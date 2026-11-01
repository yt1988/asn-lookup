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

  /* ---------- toast and share ---------- */
  let toastEl, toastT;
  function toast(s) {
    if (!toastEl) toastEl = document.body.appendChild(Object.assign(document.createElement("div"), { className: "toast", role: "status" }));
    toastEl.textContent = s; toastEl.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 1600);
  }
  const copy = s => navigator.clipboard.writeText(s);
  const share = $("#shareBtn");
  if (share) {
    share.hidden = false;
    share.onclick = async () => {
      const url = location.origin + location.pathname;
      if (navigator.share) { try { await navigator.share({ title: document.title, url }); } catch (e) {} return; }
      copy(url).then(() => toast(t("share_copied")), () => {});
    };
  }

  // fill the live rows of a key–value list: data-r="<field>" → value
  const fillRows = (vals) => $$("[data-r]").forEach(li => { const v = vals[li.dataset.r]; li.querySelector("b").innerHTML = v ? v : NA; });
  const mail = e => e ? `<a href="mailto:${esc(e)}">${esc(e)}</a>` : "";

  /* ---------- home: the visitor's own address ---------- */
  if (D.page === "home") {
    getJ("/api/me").then(r => {
      $("#meIp b").innerHTML = `<a class="mono" href="${HOME}ip/${esc(r.ip)}">${esc(r.ip)}</a>`;
      $("#meAs b").innerHTML = r.asn ? asLink(r.asn, knownName(r.asn, LANG) || r.name, r.cc) : r.cf && r.cf.asn ? asLink(r.cf.asn, r.cf.org) : NA;
      $("#mePfx b").innerHTML = r.prefix ? `<a class="mono" href="${HOME}ip/${esc(r.prefix)}">${esc(r.prefix)}</a>` : NA;
      const loc = r.cf && r.cf.country ? [r.cf.city, country(r.cf.country)].filter(Boolean).join(", ") : "";
      $("#meLoc b").innerHTML = loc ? `${flag(r.cf.country)} ${esc(loc)}` : NA;
      $("#meMore").href = `${HOME}ip/${encodeURIComponent(r.ip)}`;
      const ipqs = meta("ipqs"), egress = meta("egress");
      if (ipqs) Object.assign($("#lnIpqs"), { href: `${ipqs}${HOME}?ip=${encodeURIComponent(r.ip)}`, hidden: false });
      if (egress) Object.assign($("#lnEgress"), { href: egress + HOME, hidden: false });
    }).catch(() => { ["#meIp", "#meAs", "#mePfx", "#meLoc"].forEach(s => { $(s + " b").innerHTML = NA; }); });
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
