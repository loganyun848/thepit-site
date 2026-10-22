/* Pure sizing logic shared by the browser and node:test.
 * Official body ranges, body points and flat garment measurements are distinct.
 * Garment ease and height/weight estimates are Fit Room heuristics, not brand claims. */
(function (root) {
  "use strict";
  const LIMITS = { height: [120, 220], weight: [30, 220], chest: [50, 200], waist: [40, 200], hips: [50, 200] };
  const LABELS = { height: "키", weight: "몸무게", chest: "가슴둘레", waist: "허리둘레", hips: "엉덩이둘레" };
  function profile(input) {
    if (!["women", "men"].includes(input.gender)) throw Error("여성복 또는 남성복을 선택해 주세요.");
    const p = { gender: input.gender, estimated: [] };
    for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
      const raw = String(input[key] ?? "").trim();
      if (!raw && !["height", "weight"].includes(key)) continue;
      const v = Number(raw);
      if (!raw || !Number.isFinite(v) || v < lo || v > hi) throw Error(`${LABELS[key]}는 ${lo}~${hi} 사이 숫자로 입력해 주세요.`);
      p[key] = v;
    }
    const bmi = p.weight / (p.height / 100) ** 2, male = p.gender === "men";
    const reference = male ? [94, 82, 96, 175, 23] : [86, 72, 94, 168, 21];
    ["chest", "waist", "hips"].forEach((key, i) => {
      if (p[key] !== undefined) return;
      p[key] = Math.round(reference[i] + (bmi - reference[4]) * [2.2, 2.6, 2][i] + (p.height - reference[3]) * [.25, .15, .2][i]);
      p.estimated.push(key);
    });
    return p;
  }
  // Ease is circumference in cm. No assumed stretch bonus is applied.
  function ease(item, key) {
    if (key === "waist") return [0, 4];
    if (key === "hips") return [2, 10];
    if (item.cat === "outer") return [10, 22];
    if (/릴렉스|릴랙스|박시|오버사이즈|relaxed|oversize/i.test(item.name)) return [12, 24];
    if (/슬림|타이트|립폴로|립터틀/i.test(item.name)) return [0, 8];
    return [4, 14];
  }
  function recommend(item, user) {
    const chart = item.sizing;
    if (!chart || !Array.isArray(chart.rows) || !chart.rows.length) return { status: "unavailable", best: null, rows: [], estimated: [] };
    const keys = chart.keys;
    const rows = chart.rows.map((row, index) => {
      const parts = keys.map(key => {
        const value = user[key], reference = row.values[key];
        if (!Number.isFinite(value) || reference === undefined) return null;
        let lo, hi;
        if (chart.kind === "body-range") [lo, hi] = reference;
        else if (chart.kind === "body-points") {
          const previous = chart.rows[index - 1]?.values[key];
          const next = chart.rows[index + 1]?.values[key];
          // Midpoints are our nearest-guide matching intervals, not published ranges.
          lo = previous === undefined ? reference - Math.abs((next ?? reference + 4) - reference) / 2 : (previous + reference) / 2;
          hi = next === undefined ? reference + Math.abs(reference - (previous ?? reference - 4)) / 2 : (reference + next) / 2;
        } else if (chart.kind === "garment-flat") {
          const [minEase, maxEase] = ease(item, key);
          lo = reference * 2 - maxEase;
          hi = reference * 2 - minEase;
        } else return null;
        if (![lo, hi].every(Number.isFinite) || hi < lo) return null;
        const over = Math.max(0, value - hi), under = Math.max(0, lo - value);
        return { key, value, reference, lo, hi, over, under, delta: chart.kind === "garment-flat" ? reference * 2 - value : null };
      });
      if (!parts.length || parts.some(p => !p)) return null;
      const over = Math.max(...parts.map(p => p.over)), under = Math.max(...parts.map(p => p.under));
      return { label: row.label, parts, over, under, fits: over === 0 && under === 0,
        distance: parts.reduce((sum, p) => sum + Math.abs(p.value - (p.lo + p.hi) / 2) / Math.max(2, p.hi - p.lo), 0) };
    }).filter(Boolean);
    const compatible = rows.filter(r => r.fits).sort((a, b) => a.distance - b.distance);
    const near = rows.filter(r => r.over <= 2 && r.under <= 3).sort((a,b) => (a.over * 3 + a.under) - (b.over * 3 + b.under) || a.distance - b.distance);
    const best = compatible[0] || near[0] || null;
    const estimated = keys.filter(k => user.estimated.includes(k));
    return { status: best ? (best.fits ? "recommended" : "borderline") : "out-of-range", best, rows, estimated };
  }
  function forGender(items, gender) {
    return ["UNIQLO", "ZARA"].flatMap(brand => items.filter(x => x.gender === gender && x.brand === brand).slice(0, 20));
  }
  const api = { profile, recommend, forGender, LIMITS, LABELS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FIT_SIZING = api;
})(typeof window !== "undefined" ? window : globalThis);
