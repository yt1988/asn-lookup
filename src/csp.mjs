// The pre-paint script (the only inline script, the same on every page) and the Content-Security-Policy that allows it.
// The build writes the policy into public/_headers for static pages; the Worker sends it with the pages it renders.

// Runs before first paint: apply the saved theme. On English pages, send visitors to their language's page (a saved
// choice first, then the browser languages); crawlers and English readers stay. Keeps the path (an AS, an address).
export const PREPAINT = `(function(){var d=document.documentElement,th=null,s=null;try{th=localStorage.getItem("asn:theme");s=localStorage.getItem("asn:lang")}catch(e){}if(th==="light"||th==="dark")d.setAttribute("data-theme",th);if(!d.hasAttribute("data-root"))return;var P=JSON.parse(d.getAttribute("data-paths")||"{}"),l=null;if(P[s])l=s;for(var ls=navigator.languages||[navigator.language||"en"],i=0;!l&&!s&&i<ls.length;i++){var x=String(ls[i]).toLowerCase(),b=x.split("-")[0];l=b==="zh"?(/tw|hk|mo|hant/.test(x)?"zh-TW":"zh-CN"):P[b]?b:null}if(l&&l!=="en")location.replace(P[l]+location.pathname.slice(1)+location.search+location.hash)})();`;

export const csp = prepaintSha => ["default-src 'self'", `script-src 'self' 'sha256-${prepaintSha}'`, "style-src 'self' 'unsafe-inline'", "font-src 'self'",
  "img-src 'self' data:", "connect-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");

export const HEADERS = {
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
};
