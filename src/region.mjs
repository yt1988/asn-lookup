// Country names and flags, shared by the server pages (src/render.mjs) and the browser (src/app.js).
// TW has a fixed name in every language instead of the system's, and the flag of China (1ms-shell docs/tool-contract.md §5).
const TW = { "zh-CN": "中国台湾", "zh-TW": "中國台灣", en: "Taiwan, China", ja: "中国台湾", ko: "중국 대만", es: "Taiwán, China", fr: "Taïwan, Chine", de: "Taiwan, China", pt: "Taiwan, China", ru: "Тайвань, Китай" };
export const regionName = (cc, lang) => cc === "TW" ? (TW[lang] || TW.en) : new Intl.DisplayNames([lang], { type: "region" }).of(cc);
export const flagCode = cc => cc === "TW" ? "cn" : cc.toLowerCase();

// Which continent a country code is in, for /country's filter (UN M49; IO with Africa, GS with South America, AQ its
// own). The site's codes AP and EU are regional labels, put with Asia and Europe.
const CONT = {
  AF: "DZ AO BJ BW BF BI CV CM CF TD KM CD CG CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW IO EH TF",
  AS: "AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KP KR KW KG LA LB MO MY MV MN MM NP OM PK PS PH QA SA SG LK SY TW TJ TH TL TR TM AE UZ VN YE AP",
  EU: "AL AD AT BY BE BA BG HR CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH UA GB VA AX FO GI GG IM JE EU",
  NA: "AG AI AW BS BB BZ BM BQ VG CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US VI",
  SA: "AR BO BR CL CO EC FK GF GY PY PE SR UY VE GS",
  OC: "AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF",
  AN: "AQ",
};
const CONT_OF = new Map(Object.entries(CONT).flatMap(([c, list]) => list.split(" ").map(cc => [cc, c])));
export const continentOf = cc => CONT_OF.get(cc) || "";
