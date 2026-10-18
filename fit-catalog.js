/* THE PIT — Fit Room catalog (prototype)
   의상은 브랜드 없는 샘플(SVG 일러스트)입니다. 협찬 브랜드 이미지가 확보되면
   각 item 의 image 필드에 사진 URL을 넣고 svg 필드를 지우면 그대로 교체됩니다.
   sizes: 각 사이즈가 "맞는 몸 둘레" 범위(cm). chest/waist/hips 중 해당 항목만 사용. */
(function () {
  "use strict";

  // ── 의상 실루엣 (viewBox 0 0 200 240, 투명 배경) ──
  const S = {
    tee: (c, d) => `<path d="M58 40 L80 28 Q100 40 120 28 L142 40 L168 58 L152 84 L138 76 L140 212 Q100 222 60 212 L62 76 L48 84 L32 58 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><path d="M80 28 Q100 48 120 28" fill="none" stroke="${d}" stroke-width="2.5"/>`,
    shirt: (c, d) => `<path d="M56 44 L84 30 L100 42 L116 30 L144 44 L170 62 L154 90 L140 82 L142 214 L58 214 L60 82 L46 90 L30 62 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><path d="M84 30 L100 56 L116 30 M100 42 L100 214" fill="none" stroke="${d}" stroke-width="2"/><g fill="${d}"><circle cx="100" cy="80" r="2.5"/><circle cx="100" cy="112" r="2.5"/><circle cx="100" cy="144" r="2.5"/><circle cx="100" cy="176" r="2.5"/></g>`,
    hoodie: (c, d) => `<path d="M52 50 L78 34 Q100 22 122 34 L148 50 L176 76 L158 104 L144 94 L146 216 Q100 228 54 216 L56 94 L42 104 L24 76 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><path d="M78 34 Q100 70 122 34 Q100 10 78 34 Z" fill="${d}" opacity=".35"/><path d="M70 150 L130 150 L130 200 L70 200 Z" fill="none" stroke="${d}" stroke-width="2"/><path d="M90 78 L88 120 M110 78 L112 120" stroke="${d}" stroke-width="2"/>`,
    knit: (c, d) => `<path d="M54 46 L82 32 Q100 44 118 32 L146 46 L172 70 L156 98 L142 90 L144 214 Q100 224 56 214 L58 90 L44 98 L28 70 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><path d="M82 32 Q100 58 118 32" fill="none" stroke="${d}" stroke-width="2.5"/><g stroke="${d}" stroke-width="1.5" opacity=".5"><path d="M70 110 L130 110 M70 130 L130 130 M70 150 L130 150 M70 170 L130 170 M70 190 L130 190"/></g>`,
    blazer: (c, d) => `<path d="M50 48 L84 30 L100 66 L116 30 L150 48 L176 74 L160 104 L146 96 L148 218 L52 218 L54 96 L40 104 L24 74 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><path d="M84 30 L100 66 L116 30 L112 92 L100 140 L88 92 Z" fill="${d}" opacity=".3"/><path d="M100 140 L100 218" stroke="${d}" stroke-width="2"/><circle cx="104" cy="152" r="2.5" fill="${d}"/><circle cx="104" cy="178" r="2.5" fill="${d}"/><path d="M62 160 L84 160 M116 160 L138 160" stroke="${d}" stroke-width="2"/>`,
    trench: (c, d) => `<path d="M48 48 L84 30 L100 60 L116 30 L152 48 L178 76 L162 108 L148 100 L154 230 L46 230 L52 100 L38 108 L22 76 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><path d="M84 30 L100 60 L116 30 L112 86 L100 120 L88 86 Z" fill="${d}" opacity=".28"/><path d="M100 120 L100 230" stroke="${d}" stroke-width="2"/><path d="M56 150 L144 150" stroke="${d}" stroke-width="5" stroke-linecap="round" opacity=".55"/><g fill="${d}"><circle cx="90" cy="135" r="2.5"/><circle cx="110" cy="135" r="2.5"/><circle cx="90" cy="175" r="2.5"/><circle cx="110" cy="175" r="2.5"/></g>`,
    puffer: (c, d) => `<path d="M50 52 L84 36 Q100 46 116 36 L150 52 L176 80 L160 108 L146 100 L148 220 Q100 230 52 220 L54 100 L40 108 L24 80 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><g fill="none" stroke="${d}" stroke-width="2" opacity=".6"><path d="M54 120 Q100 112 146 120 M54 150 Q100 142 146 150 M54 180 Q100 172 146 180 M54 206 Q100 198 146 206"/></g><path d="M100 46 L100 220" stroke="${d}" stroke-width="2.5"/>`,
    denim: (c, d) => `<path d="M52 48 L84 32 L100 54 L116 32 L148 48 L174 74 L158 104 L144 96 L146 200 L54 200 L56 96 L42 104 L26 74 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><path d="M84 32 L100 54 L116 32 L110 70 L90 70 Z" fill="${d}" opacity=".3"/><path d="M100 54 L100 200" stroke="${d}" stroke-width="2"/><g fill="none" stroke="${d}" stroke-width="2"><path d="M64 100 L88 100 L88 124 L64 124 Z M112 100 L136 100 L136 124 L112 124 Z"/></g><g fill="${d}"><circle cx="104" cy="90" r="2.5"/><circle cx="104" cy="120" r="2.5"/><circle cx="104" cy="150" r="2.5"/><circle cx="104" cy="180" r="2.5"/></g>`,
    jeans: (c, d) => `<path d="M58 20 L142 20 L148 60 L140 232 L106 232 L100 110 L94 232 L60 232 L52 60 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><path d="M58 20 L142 20 L143 34 L57 34 Z" fill="${d}" opacity=".3"/><path d="M100 34 L100 110" stroke="${d}" stroke-width="2"/><path d="M62 40 Q74 52 84 42 M138 40 Q126 52 116 42" fill="none" stroke="${d}" stroke-width="2"/>`,
    chino: (c, d) => `<path d="M60 20 L140 20 L146 62 L138 232 L106 232 L100 112 L94 232 L62 232 L54 62 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><path d="M60 20 L140 20 L141 32 L59 32 Z" fill="${d}" opacity=".3"/><path d="M100 32 L100 112 M78 112 L76 232 M122 112 L124 232" stroke="${d}" stroke-width="1.5" opacity=".6"/>`,
    wide: (c, d) => `<path d="M58 20 L142 20 L150 62 L156 232 L108 232 L100 100 L92 232 L44 232 L50 62 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><path d="M58 20 L142 20 L143 34 L57 34 Z" fill="${d}" opacity=".3"/><path d="M100 34 L100 100" stroke="${d}" stroke-width="2"/>`,
    skirt: (c, d) => `<path d="M64 20 L136 20 L140 40 L166 190 Q100 206 34 190 L60 40 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><path d="M64 20 L136 20 L137 34 L63 34 Z" fill="${d}" opacity=".3"/><g stroke="${d}" stroke-width="1.5" opacity=".5"><path d="M80 40 L68 190 M100 40 L100 194 M120 40 L132 190"/></g>`,
    dress: (c, d) => `<path d="M62 42 L86 30 Q100 42 114 30 L138 42 L160 62 L146 86 L136 80 L132 120 L164 228 Q100 240 36 228 L68 120 L64 80 L54 86 L40 62 Z" fill="${c}" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/><path d="M86 30 Q100 52 114 30" fill="none" stroke="${d}" stroke-width="2.5"/><path d="M70 120 Q100 128 130 120" fill="none" stroke="${d}" stroke-width="2" opacity=".6"/>`,
  };

  function svgFor(shape, color) {
    const d = shade(color, -0.35);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240">${S[shape](color, d)}</svg>`;
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = v => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    return "#" + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, "0")).join("");
  }

  // tone: warm | cool | neutral  ·  season: SS | FW | ALL  ·  fit: slim | regular | relaxed | oversized
  // body: 어떤 체형에 특히 추천되는지 (slim / average / broad / curvy)
  const ITEMS = [
    { id: "tee-white",   name: "Heavy Cotton Tee",      cat: "top",    shape: "tee",    color: "#f2efe6", tone: "neutral", season: "ALL", fit: "regular",   body: ["slim","average","broad","curvy"], price: 19,  sizes: { S:{chest:[84,90]}, M:{chest:[90,97]}, L:{chest:[97,104]}, XL:{chest:[104,112]} } },
    { id: "tee-terra",   name: "Boxy Tee · Terracotta", cat: "top",    shape: "tee",    color: "#c4603f", tone: "warm",    season: "SS",  fit: "oversized", body: ["slim","average"],               price: 24,  sizes: { S:{chest:[82,92]}, M:{chest:[90,100]}, L:{chest:[98,108]}, XL:{chest:[106,116]} } },
    { id: "shirt-oxford",name: "Oxford Shirt · Sky",    cat: "top",    shape: "shirt",  color: "#9fc3e8", tone: "cool",    season: "ALL", fit: "regular",   body: ["average","broad"],              price: 39,  sizes: { S:{chest:[86,92]}, M:{chest:[92,99]}, L:{chest:[99,106]}, XL:{chest:[106,114]} } },
    { id: "shirt-sage",  name: "Linen Shirt · Sage",    cat: "top",    shape: "shirt",  color: "#9bb59a", tone: "neutral", season: "SS",  fit: "relaxed",   body: ["slim","average","curvy"],       price: 45,  sizes: { S:{chest:[86,94]}, M:{chest:[92,101]}, L:{chest:[99,108]}, XL:{chest:[106,116]} } },
    { id: "hood-grey",   name: "Fleece Hoodie · Ash",   cat: "top",    shape: "hoodie", color: "#8e8f97", tone: "neutral", season: "FW",  fit: "oversized", body: ["slim","average","broad"],       price: 49,  sizes: { S:{chest:[84,94]}, M:{chest:[92,102]}, L:{chest:[100,110]}, XL:{chest:[108,118]} } },
    { id: "knit-camel",  name: "Merino Crew · Camel",   cat: "top",    shape: "knit",   color: "#c8a06a", tone: "warm",    season: "FW",  fit: "regular",   body: ["slim","average","curvy"],       price: 59,  sizes: { S:{chest:[84,90]}, M:{chest:[90,97]}, L:{chest:[97,104]}, XL:{chest:[104,112]} } },
    { id: "knit-navy",   name: "Merino Crew · Navy",    cat: "top",    shape: "knit",   color: "#2c3e6b", tone: "cool",    season: "FW",  fit: "regular",   body: ["average","broad"],              price: 59,  sizes: { S:{chest:[84,90]}, M:{chest:[90,97]}, L:{chest:[97,104]}, XL:{chest:[104,112]} } },
    { id: "blazer-char", name: "Relaxed Blazer · Charcoal", cat: "outer", shape: "blazer", color: "#4a4a52", tone: "cool", season: "ALL", fit: "relaxed",  body: ["slim","average","curvy"],       price: 129, sizes: { S:{chest:[86,94]}, M:{chest:[93,101]}, L:{chest:[100,108]}, XL:{chest:[107,116]} } },
    { id: "trench-beige",name: "Classic Trench · Beige",cat: "outer",  shape: "trench", color: "#d6c4a3", tone: "warm",    season: "FW",  fit: "regular",   body: ["slim","average"],               price: 149, sizes: { S:{chest:[86,94]}, M:{chest:[93,101]}, L:{chest:[100,108]}, XL:{chest:[107,116]} } },
    { id: "puffer-black",name: "Light Puffer · Black",  cat: "outer",  shape: "puffer", color: "#2a2a30", tone: "neutral", season: "FW",  fit: "regular",   body: ["slim","average","broad","curvy"], price: 89, sizes: { S:{chest:[86,96]}, M:{chest:[94,104]}, L:{chest:[102,112]}, XL:{chest:[110,120]} } },
    { id: "denim-jkt",   name: "Denim Jacket · Indigo", cat: "outer",  shape: "denim",  color: "#4f6a93", tone: "cool",    season: "ALL", fit: "regular",   body: ["slim","average","broad"],       price: 79,  sizes: { S:{chest:[86,92]}, M:{chest:[92,99]}, L:{chest:[99,106]}, XL:{chest:[106,114]} } },
    { id: "jeans-blue",  name: "Straight Jeans · Mid Blue", cat: "bottom", shape: "jeans", color: "#5b7fb0", tone: "cool", season: "ALL", fit: "regular",  body: ["slim","average","broad"],       price: 59,  sizes: { S:{waist:[68,74],hips:[86,94]}, M:{waist:[74,80],hips:[92,100]}, L:{waist:[80,88],hips:[98,106]}, XL:{waist:[88,96],hips:[104,114]} } },
    { id: "jeans-black", name: "Slim Jeans · Black",    cat: "bottom", shape: "jeans",  color: "#26262c", tone: "neutral", season: "ALL", fit: "slim",      body: ["slim","average"],               price: 59,  sizes: { S:{waist:[66,72],hips:[84,90]}, M:{waist:[72,78],hips:[90,96]}, L:{waist:[78,85],hips:[96,103]}, XL:{waist:[85,92],hips:[103,110]} } },
    { id: "chino-sand",  name: "Chino · Sand",          cat: "bottom", shape: "chino",  color: "#cdb48f", tone: "warm",    season: "ALL", fit: "regular",   body: ["average","broad","curvy"],      price: 49,  sizes: { S:{waist:[68,74],hips:[86,94]}, M:{waist:[74,80],hips:[92,100]}, L:{waist:[80,88],hips:[98,106]}, XL:{waist:[88,96],hips:[104,114]} } },
    { id: "wide-olive",  name: "Wide Pants · Olive",    cat: "bottom", shape: "wide",   color: "#6f7a52", tone: "warm",    season: "ALL", fit: "relaxed",   body: ["slim","curvy","broad"],         price: 55,  sizes: { S:{waist:[66,74],hips:[88,98]}, M:{waist:[72,80],hips:[94,104]}, L:{waist:[78,88],hips:[100,110]}, XL:{waist:[86,96],hips:[106,118]} } },
    { id: "skirt-plum",  name: "Pleated Skirt · Plum",  cat: "bottom", shape: "skirt",  color: "#6d2e46", tone: "cool",    season: "FW",  fit: "regular",   body: ["slim","average","curvy"],       price: 45,  sizes: { S:{waist:[64,70],hips:[84,92]}, M:{waist:[70,76],hips:[90,98]}, L:{waist:[76,84],hips:[96,104]}, XL:{waist:[84,92],hips:[102,112]} } },
    { id: "dress-rust",  name: "Shirt Dress · Rust",    cat: "dress",  shape: "dress",  color: "#b0552f", tone: "warm",    season: "ALL", fit: "relaxed",   body: ["slim","average","curvy"],       price: 69,  sizes: { S:{chest:[82,90],waist:[64,74]}, M:{chest:[88,96],waist:[70,80]}, L:{chest:[94,103],waist:[76,88]}, XL:{chest:[101,111],waist:[84,96]} } },
    { id: "dress-ink",   name: "Knit Dress · Ink",      cat: "dress",  shape: "dress",  color: "#243054", tone: "cool",    season: "FW",  fit: "slim",      body: ["slim","average"],               price: 75,  sizes: { S:{chest:[82,88],waist:[62,70]}, M:{chest:[88,94],waist:[68,76]}, L:{chest:[94,101],waist:[74,83]}, XL:{chest:[101,109],waist:[81,90]} } },
  ];

  ITEMS.forEach(it => {
    it.brand = it.brand || "Sample brand";       // 협찬 브랜드명으로 교체
    it.image = it.image || ("data:image/svg+xml;utf8," + encodeURIComponent(svgFor(it.shape, it.color)));
  });

  window.FIT_CATALOG = { ITEMS, svgFor, shade };
})();
