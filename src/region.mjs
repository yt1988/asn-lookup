// Country names and flags, shared by the server pages (src/render.mjs) and the browser (src/app.js).
// TW has a fixed name in every language instead of the system's, and the flag of China (1ms-shell docs/tool-contract.md §5).
const TW = { "zh-CN": "中国台湾", "zh-TW": "中國台灣", en: "Taiwan, China", ja: "中国台湾", ko: "중국 대만", es: "Taiwán, China", fr: "Taïwan, Chine", de: "Taiwan, China", pt: "Taiwan, China", ru: "Тайвань, Китай" };
export const regionName = (cc, lang) => cc === "TW" ? (TW[lang] || TW.en) : new Intl.DisplayNames([lang], { type: "region" }).of(cc);
export const flagCode = cc => cc === "TW" ? "cn" : cc.toLowerCase();
