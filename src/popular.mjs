// Well-known networks: the home page lists them, and their pages lead with this name (searchers type "AS4134 中国电信",
// not "CHINANET-BACKBONE"). A name is a string when it is the same in every language (a brand), otherwise an object
// with all ten languages (test/strings.test.mjs checks).
const L = (en, zhCN, zhTW, ja, ko, es = en, fr = en, de = en, pt = en, ru = en) => ({ en, "zh-CN": zhCN, "zh-TW": zhTW, ja, ko, es, fr, de, pt, ru });

export const KNOWN = {
  4134: L("China Telecom 163 backbone", "中国电信 163 骨干网", "中國電信 163 骨幹網", "中国電信 163 バックボーン", "차이나텔레콤 163 백본", "China Telecom, red troncal 163", "China Telecom, dorsale 163", "China Telecom 163-Backbone", "China Telecom, backbone 163", "China Telecom, магистраль 163"),
  4809: L("China Telecom CN2", "中国电信 CN2", "中國電信 CN2", "中国電信 CN2", "차이나텔레콤 CN2", "China Telecom CN2", "China Telecom CN2", "China Telecom CN2", "China Telecom CN2", "China Telecom CN2"),
  23764: L("China Telecom Global (CTG)", "中国电信国际 CTG", "中國電信國際 CTG", "中国電信グローバル CTG", "차이나텔레콤 글로벌 CTG", "China Telecom Global (CTG)", "China Telecom Global (CTG)", "China Telecom Global (CTG)", "China Telecom Global (CTG)", "China Telecom Global (CTG)"),
  4837: L("China Unicom 169 backbone", "中国联通 169 骨干网", "中國聯通 169 骨幹網", "中国聯通 169 バックボーン", "차이나유니콤 169 백본", "China Unicom, red troncal 169", "China Unicom, dorsale 169", "China Unicom 169-Backbone", "China Unicom, backbone 169", "China Unicom, магистраль 169"),
  9929: L("China Unicom 9929 (CUII)", "中国联通 9929（A 网）", "中國聯通 9929（A 網）", "中国聯通 9929（CUII）", "차이나유니콤 9929 (CUII)", "China Unicom 9929 (CUII)", "China Unicom 9929 (CUII)", "China Unicom 9929 (CUII)", "China Unicom 9929 (CUII)", "China Unicom 9929 (CUII)"),
  10099: L("China Unicom Global", "中国联通国际", "中國聯通國際", "中国聯通グローバル", "차이나유니콤 글로벌", "China Unicom Global", "China Unicom Global", "China Unicom Global", "China Unicom Global", "China Unicom Global"),
  9808: L("China Mobile", "中国移动", "中國移動", "中国移動", "차이나모바일", "China Mobile", "China Mobile", "China Mobile", "China Mobile", "China Mobile"),
  58453: L("China Mobile International (CMI)", "中国移动国际 CMI", "中國移動國際 CMI", "中国移動インターナショナル CMI", "차이나모바일 인터내셔널 CMI", "China Mobile International (CMI)", "China Mobile International (CMI)", "China Mobile International (CMI)", "China Mobile International (CMI)", "China Mobile International (CMI)"),
  4538: L("CERNET (China Education Network)", "中国教育网 CERNET", "中國教育網 CERNET", "中国教育研究網 CERNET", "중국 교육망 CERNET", "CERNET (red educativa de China)", "CERNET (réseau éducatif chinois)", "CERNET (chinesisches Bildungsnetz)", "CERNET (rede educacional da China)", "CERNET (образовательная сеть Китая)"),
  45102: L("Alibaba Cloud (international)", "阿里云（国际）", "阿里雲（國際）", "Alibaba Cloud（国際）", "알리바바 클라우드(해외)", "Alibaba Cloud (internacional)", "Alibaba Cloud (international)", "Alibaba Cloud (international)", "Alibaba Cloud (internacional)", "Alibaba Cloud (международный)"),
  37963: L("Alibaba Cloud (China)", "阿里云（国内）", "阿里雲（中國大陸）", "Alibaba Cloud（中国本土）", "알리바바 클라우드(중국)", "Alibaba Cloud (China)", "Alibaba Cloud (Chine)", "Alibaba Cloud (China)", "Alibaba Cloud (China)", "Alibaba Cloud (Китай)"),
  132203: L("Tencent Cloud (international)", "腾讯云（国际）", "騰訊雲（國際）", "Tencent Cloud（国際）", "텐센트 클라우드(해외)", "Tencent Cloud (internacional)", "Tencent Cloud (international)", "Tencent Cloud (international)", "Tencent Cloud (internacional)", "Tencent Cloud (международный)"),
  45090: L("Tencent Cloud (China)", "腾讯云（国内）", "騰訊雲（中國大陸）", "Tencent Cloud（中国本土）", "텐센트 클라우드(중국)", "Tencent Cloud (China)", "Tencent Cloud (Chine)", "Tencent Cloud (China)", "Tencent Cloud (China)", "Tencent Cloud (Китай)"),
  55990: L("Huawei Cloud", "华为云", "華為雲", "Huawei Cloud", "화웨이 클라우드", "Huawei Cloud", "Huawei Cloud", "Huawei Cloud", "Huawei Cloud", "Huawei Cloud"),
  3462: L("Chunghwa Telecom HiNet", "中华电信 HiNet", "中華電信 HiNet", "中華電信 HiNet", "중화텔레콤 HiNet", "Chunghwa Telecom HiNet", "Chunghwa Telecom HiNet", "Chunghwa Telecom HiNet", "Chunghwa Telecom HiNet", "Chunghwa Telecom HiNet"),
  4760: "HKT",
  9304: "HGC",
  3491: "PCCW Global",
  2914: "NTT",
  2516: "KDDI",
  2497: "IIJ",
  4766: L("Korea Telecom (KT)", "韩国电信 KT", "韓國電信 KT", "KT（韓国通信）", "KT", "Korea Telecom (KT)", "Korea Telecom (KT)", "Korea Telecom (KT)", "Korea Telecom (KT)", "Korea Telecom (KT)"),
  7473: "Singtel",
  4637: "Telstra",
  3356: "Lumen (Level 3)",
  1299: "Arelion (Telia)",
  174: "Cogent",
  6939: "Hurricane Electric",
  3257: "GTT",
  6453: "TATA Communications",
  13335: "Cloudflare",
  15169: "Google",
  16509: "Amazon (AWS)",
  8075: "Microsoft",
  32934: "Meta",
  20940: "Akamai",
  54113: "Fastly",
  14061: "DigitalOcean",
  20473: "Vultr",
  63949: "Akamai (Linode)",
  16276: "OVHcloud",
  24940: "Hetzner",
  31898: "Oracle Cloud",
};

// The home page's groups, in order
export const GROUPS = [
  ["cn", [4134, 4809, 23764, 4837, 9929, 10099, 9808, 58453, 4538]],
  ["cloud", [13335, 15169, 16509, 8075, 45102, 37963, 132203, 45090, 55990, 31898, 14061, 20473, 63949, 16276, 24940, 32934, 20940, 54113]],
  ["intl", [3462, 4760, 9304, 3491, 2914, 2516, 2497, 4766, 7473, 4637, 3356, 1299, 174, 6939, 3257, 6453]],
];

export const knownName = (asn, lang) => { const k = KNOWN[asn]; return k == null ? "" : typeof k === "string" ? k : k[lang]; };
