// The languages: code, URL folder, og:locale; the first is the root.
export const LANGS = [["en", "", "en_US"], ["zh-CN", "zh-cn", "zh_CN"], ["zh-TW", "zh-tw", "zh_TW"], ["ja", "ja", "ja_JP"], ["ko", "ko", "ko_KR"],
  ["es", "es", "es_ES"], ["fr", "fr", "fr_FR"], ["de", "de", "de_DE"], ["pt", "pt", "pt_BR"], ["ru", "ru", "ru_RU"]];
export const BY_SLUG = Object.fromEntries(LANGS.map(([l, s]) => [s, l]));
export const SLUG = Object.fromEntries(LANGS.map(([l, s]) => [l, s]));
export const LOCALE = Object.fromEntries(LANGS.map(([l, , o]) => [l, o]));
