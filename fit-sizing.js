/* Keep editable starting estimates separate from supplied measurements and usual sizes. */
(function (root) {
  "use strict";
  const LIMITS = { height: [120, 220], weight: [30, 220], chest: [50, 200], waist: [40, 200], hips: [50, 200] };
  const LABELS = { height: "Height", weight: "Weight", chest: "Chest", waist: "Waist", hips: "Hips" };
  const ALPHA = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"];
  // Geometric starting heuristic, not fitted population averages or a body scan.
  // Circumference scales with sqrt(mass / height), assuming similar cross sections.
  // Anchors are design defaults; use whole cm to avoid implying measurement precision.
  const ESTIMATE_ANCHORS = {
    men: { height: 175, weight: 75, chest: 100, waist: 84, hips: 100 },
    women: { height: 165, weight: 60, chest: 88, waist: 74, hips: 98 }
  };
  function estimateMeasurements(input) {
    const anchor = ESTIMATE_ANCHORS[input.gender], height = Number(input.height), weight = Number(input.weight);
    if (!anchor || !Number.isFinite(height) || !Number.isFinite(weight) || height < LIMITS.height[0] || height > LIMITS.height[1] || weight < LIMITS.weight[0] || weight > LIMITS.weight[1]) return null;
    const scale = Math.sqrt((weight / height) / (anchor.weight / anchor.height));
    const values = Object.fromEntries(['chest', 'waist', 'hips'].map(key => [key, Math.round(anchor[key] * scale)]));
    return Object.entries(values).every(([key, value]) => value >= LIMITS[key][0] && value <= LIMITS[key][1]) ? values : null;
  }
  function profile(input) {
    if (!["women", "men"].includes(input.gender)) throw Error("Please choose Women or Men.");
    const p = { gender: input.gender, missing: [], estimated: [] };
    for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
      const raw = String(input[key] ?? "").trim();
      if (!raw && !["height", "weight"].includes(key)) { p[key] = null; p.missing.push(key); continue; }
      const value = Number(raw);
      if (!raw || !Number.isFinite(value) || value < lo || value > hi) throw Error(`Enter ${LABELS[key].toLowerCase()} as a number between ${lo} and ${hi}.`);
      p[key] = value;
    }
    p.usualTopSize = String(input.usualTopSize || "");
    p.usualBottomSize = String(input.usualBottomSize || "");
    if (p.usualTopSize && !ALPHA.includes(p.usualTopSize)) throw Error("Please select your usual top size from the list.");
    if (p.usualBottomSize && !ALPHA.includes(p.usualBottomSize) && !/^inch:(2[2-9]|3[0-9]|4[0-4])$/.test(p.usualBottomSize)) throw Error("Please select your usual bottom size from the list.");
    p.usualBrand = ["UNIQLO", "ZARA"].includes(input.usualBrand) ? input.usualBrand : "other";
    p.fitPreference = ["slim", "relaxed"].includes(input.fitPreference) ? input.fitPreference : "regular";
    p.estimated = ['chest', 'waist', 'hips'].filter(key => p[key] !== null && Array.isArray(input.estimated) && input.estimated.includes(key));
    p.suggestedSizes = ['usualTopSize', 'usualBottomSize'].filter(key => p[key] && Array.isArray(input.suggestedSizes) && input.suggestedSizes.includes(key));
    return p;
  }
  function ease(item, key, preference) {
    if (key === "waist") return [0, 4];
    if (key === "hips") return preference === "relaxed" ? [4, 14] : [2, 10];
    let pair = item.cat === "outer" ? [10, 22] : /relaxed|boxy|oversize/i.test(item.name) ? [12, 24] : /slim|tight|ribbed.*(?:polo|turtleneck)/i.test(item.name) ? [0, 8] : [4, 14];
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
    const sizeKey = item.cat === 'bottom' ? 'usualBottomSize' : 'usualTopSize';
    const usualValue = user.suggestedSizes?.includes(sizeKey) ? '' : user[sizeKey];
    const usual = usualValue ? rows.find(row => matchesUsual(row.label, usualValue)) || null : null;
    const estimated = chart.keys.filter(key => user.estimated?.includes(key));
    const common = { rows, missing, estimated, usual, sameBrand: user.usualBrand === item.brand };
    if (missing.length) return { ...common, status: usual ? "usual-size" : "needs-measurements", best: usual, measured: null };
    const compatible = rows.filter(row => row.fits).sort((a, b) => a.distance - b.distance);
    const near = rows.filter(row => row.over <= 2 && row.under <= 3).sort((a, b) => (a.over * 3 + a.under) - (b.over * 3 + b.under) || a.distance - b.distance);
    const measured = compatible[0] || near[0] || null;
    // Rough estimates must never overrule a size the person explicitly selected.
    if (estimated.length && usual) return { ...common, status: 'usual-size', best: usual, measured };
    if (!measured) return { ...common, status: "out-of-range", best: null, measured: null };
    // A real measurement conflicting with a known comfortable size needs a comparison, not a silent downgrade.
    if (usual && !usual.fits && usual.label !== measured.label) return { ...common, status: "conflict", best: null, measured };
    const best = usual?.fits ? usual : measured;
    return { ...common, status: estimated.length ? 'estimated' : best.fits ? "recommended" : "borderline", best, measured };
  }
  function suggestSizes(user, items) {
    const brand = user.usualBrand === 'ZARA' ? 'ZARA' : 'UNIQLO';
    const reference = { ...user, usualTopSize: '', usualBottomSize: '' };
    const result = { usualTopSize: '', usualBottomSize: '', brand };
    for (const [cat, key] of [['top', 'usualTopSize'], ['bottom', 'usualBottomSize']]) {
      const seen = new Set(), choices = [];
      for (const item of items.filter(item => item.gender === user.gender && item.brand === brand && item.cat === cat)) {
        // Repeated brand guides should not outweigh distinct garment charts.
        const chartKey = JSON.stringify([item.sizing?.kind, item.sizing?.keys, item.sizing?.rows]);
        if (!item.sizing || seen.has(chartKey)) continue;
        seen.add(chartKey);
        const label = recommend(item, reference).best?.label;
        if (!label) continue;
        const alpha = label.split(' (')[0];
        const inches = cat === 'bottom' && (/^(\d{2})$/.exec(label)?.[1] || /\(KR (\d{2})\)/.exec(label)?.[1]);
        if (inches) choices.push({ value: 'inch:' + inches, rank: Number(inches), inches: true });
        else if (ALPHA.includes(alpha)) choices.push({ value: alpha, rank: ALPHA.indexOf(alpha), inches: false });
      }
      const pool = choices.some(choice => choice.inches) ? choices.filter(choice => choice.inches) : choices;
      pool.sort((a, b) => a.rank - b.rank);
      if (pool.length) result[key] = pool[Math.floor(pool.length / 2)].value;
    }
    return result;
  }
  function forGender(items, gender) { return ["UNIQLO", "ZARA"].flatMap(brand => items.filter(item => item.gender === gender && item.brand === brand).slice(0, 20)); }
  const api = { profile, recommend, estimateMeasurements, suggestSizes, forGender, LIMITS, LABELS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FIT_SIZING = api;
})(typeof window !== "undefined" ? window : globalThis);
