/* Measurements and the user's usual size are evidence; height/weight are not circumference measurements. */
(function (root) {
  "use strict";
  const LIMITS = { height: [120, 220], weight: [30, 220], chest: [50, 200], waist: [40, 200], hips: [50, 200] };
  const LABELS = { height: "키", weight: "몸무게", chest: "가슴둘레", waist: "허리둘레", hips: "엉덩이둘레" };
  const ALPHA = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"];
  function profile(input) {
    if (!["women", "men"].includes(input.gender)) throw Error("여성복 또는 남성복을 선택해 주세요.");
    const p = { gender: input.gender, missing: [], estimated: [] };
    for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
      const raw = String(input[key] ?? "").trim();
      if (!raw && !["height", "weight"].includes(key)) { p[key] = null; p.missing.push(key); continue; }
      const value = Number(raw);
      if (!raw || !Number.isFinite(value) || value < lo || value > hi) throw Error(`${LABELS[key]}는 ${lo}~${hi} 사이 숫자로 입력해 주세요.`);
      p[key] = value;
    }
    p.usualTopSize = String(input.usualTopSize || "");
    p.usualBottomSize = String(input.usualBottomSize || "");
    if (p.usualTopSize && !ALPHA.includes(p.usualTopSize)) throw Error("평소 상의 사이즈를 목록에서 선택해 주세요.");
    if (p.usualBottomSize && !ALPHA.includes(p.usualBottomSize) && !/^inch:(2[2-9]|3[0-9]|4[0-4])$/.test(p.usualBottomSize)) throw Error("평소 하의 사이즈를 목록에서 선택해 주세요.");
    p.usualBrand = ["UNIQLO", "ZARA"].includes(input.usualBrand) ? input.usualBrand : "other";
    p.fitPreference = ["slim", "relaxed"].includes(input.fitPreference) ? input.fitPreference : "regular";
    return p;
  }
  function ease(item, key, preference) {
    if (key === "waist") return [0, 4];
    if (key === "hips") return preference === "relaxed" ? [4, 14] : [2, 10];
    let pair = item.cat === "outer" ? [10, 22] : /릴렉스|릴랙스|박시|오버사이즈|relaxed|oversize/i.test(item.name) ? [12, 24] : /슬림|타이트|립폴로|립터틀/i.test(item.name) ? [0, 8] : [4, 14];
    if (preference === "relaxed") pair = [pair[0] + 4, pair[1] + 6];
    if (preference === "slim") pair = [Math.max(0, pair[0] - 4), Math.max(4, pair[1] - 4)];
    return pair;
  }
  function matchesUsual(label, usual) {
    if (usual.startsWith("inch:")) {
      const size = usual.slice(5);
      return label === size || new RegExp(`\\(KR ${size}\\)`).test(label);
    }
    return label.split(" (")[0] === usual;
  }
  function recommend(item, user) {
    const chart = item.sizing;
    if (!chart?.rows?.length) return { status: "unavailable", best: null, measured: null, usual: null, rows: [], missing: [], estimated: [] };
    const missing = chart.keys.filter(key => !Number.isFinite(user[key]));
    const rows = chart.rows.map((row, index) => {
      const parts = chart.keys.map(key => {
        const value = Number.isFinite(user[key]) ? user[key] : null, reference = row.values[key];
        let lo, hi;
        if (chart.kind === "body-range") [lo, hi] = reference;
        else if (chart.kind === "body-points") {
          const prev = chart.rows[index - 1]?.values[key], next = chart.rows[index + 1]?.values[key];
          lo = prev === undefined ? reference - Math.abs((next ?? reference + 4) - reference) / 2 : (prev + reference) / 2;
          hi = next === undefined ? reference + Math.abs(reference - (prev ?? reference - 4)) / 2 : (reference + next) / 2;
        } else if (chart.kind === "garment-flat") {
          const [min, max] = ease(item, key, user.fitPreference);
          lo = reference * 2 - max; hi = reference * 2 - min;
        }
        if (![lo, hi].every(Number.isFinite) || hi < lo) return null;
        return { key, value, reference, lo, hi, over: value === null ? 0 : Math.max(0, value - hi), under: value === null ? 0 : Math.max(0, lo - value), delta: value !== null && chart.kind === "garment-flat" ? reference * 2 - value : null };
      });
      if (!parts.length || parts.some(part => !part)) return null;
      const over = Math.max(...parts.map(p => p.over)), under = Math.max(...parts.map(p => p.under));
      return { label: row.label, parts, over, under, fits: !missing.length && over === 0 && under === 0,
        distance: parts.reduce((sum, p) => sum + (p.value === null ? 0 : Math.abs(p.value - (p.lo + p.hi) / 2) / Math.max(2, p.hi - p.lo)), 0) };
    }).filter(Boolean);
    const usualValue = item.cat === "bottom" ? user.usualBottomSize : user.usualTopSize;
    const usual = usualValue ? rows.find(row => matchesUsual(row.label, usualValue)) || null : null;
    const common = { rows, missing, estimated: [], usual, sameBrand: user.usualBrand === item.brand };
    if (missing.length) return { ...common, status: usual ? "usual-size" : "needs-measurements", best: usual, measured: null };
    const compatible = rows.filter(row => row.fits).sort((a, b) => a.distance - b.distance);
    const near = rows.filter(row => row.over <= 2 && row.under <= 3).sort((a, b) => (a.over * 3 + a.under) - (b.over * 3 + b.under) || a.distance - b.distance);
    const measured = compatible[0] || near[0] || null;
    if (!measured) return { ...common, status: "out-of-range", best: null, measured: null };
    // A real measurement conflicting with a known comfortable size needs a comparison, not a silent downgrade.
    if (usual && !usual.fits && usual.label !== measured.label) return { ...common, status: "conflict", best: null, measured };
    const best = usual?.fits ? usual : measured;
    return { ...common, status: best.fits ? "recommended" : "borderline", best, measured };
  }
  function forGender(items, gender) { return ["UNIQLO", "ZARA"].flatMap(brand => items.filter(item => item.gender === gender && item.brand === brand).slice(0, 20)); }
  const api = { profile, recommend, forGender, LIMITS, LABELS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FIT_SIZING = api;
})(typeof window !== "undefined" ? window : globalThis);
