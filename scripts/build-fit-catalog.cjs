/* Build the static catalog from publicly viewed product cards/size guides.
   No network requests and no user data. Run: node scripts/build-fit-catalog.cjs */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog-source.json'), 'utf8'));
const measurements = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog-measurements.json'), 'utf8'));
const updatedAt = '2026-10-22';
const names = { '가슴둘레': 'chest', '가슴': 'chest', '허리둘레': 'waist', '엉덩이둘레': 'hips' };
const alphabet = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
function uniqloSizing(item) {
  const range = item.text.split('\n')[0].split(', ')[1];
  const numeric = /^\d/.test(range), bottom = item.cat === 'bottom';
  const guide = numeric ? `uniqlo-${item.gender}-bottom` : bottom && item.gender === 'men' ? 'uniqlo-men-elastic' : `uniqlo-${item.gender}`;
  const table = measurements[guide]; assert.ok(table, `Missing ${guide}`);
  const [min, max] = range.split('-');
  const include = label => numeric ? +label >= +min && +label <= +max : alphabet.indexOf(label) >= alphabet.indexOf(min) && alphabet.indexOf(label) <= alphabet.indexOf(max);
  const key = bottom ? 'waist' : 'chest';
  const index = table[0].findIndex(x => names[x] === key); assert.ok(index > 0);
  const kind = numeric ? 'body-points' : 'body-range';
  const rows = table.slice(1).filter(r => include(r[0])).map(r => ({ label: r[0], values: { [key]: numeric ? Number(r[index]) : r[index].split(' - ').map(Number) } }));
  return { kind, scope: 'brand-guide', keys: [key], rows, source: item.url, guide };
}
function zaraSizing(item) {
  const raw = measurements[item.url]; assert.ok(raw, `Missing Zara chart: ${item.name}`);
  if (raw.kind === 'garment-flat') {
    const keys = item.cat === 'bottom' ? ['waist', 'hips'] : ['chest'];
    const fields = { chest: '가슴 둘레', waist: '허리 둘레', hips: '엉덩이 둘레' };
    const available = keys.filter(k => raw.table.some(row => row[0] === fields[k]));
    assert.ok(available.length);
    const rows = raw.table[0].slice(1).map((label, i) => ({label, values:Object.fromEntries(available.map(k=>[k, Number(raw.table.find(r=>r[0] === fields[k])[i+1])]))}));
    return { kind: raw.kind, scope: 'product', keys: available, rows, source: item.url };
  }
  const keys = item.cat === 'bottom' ? (raw.rows[0].values.length === 1 ? ['waist'] : ['waist','hips']) : item.gender === 'women' ? ['waist','chest'] : ['chest'];
  const rows = raw.rows.map(r => {
    const values = r.values.map(parseFloat);
    // Men's shirt charts show neck then chest; neck is not an input in Fit Room.
    const used = item.gender === 'men' && item.cat !== 'bottom' ? [values[values.length - 1]] : values;
    return { label:r.label, values:Object.fromEntries(keys.map((k,i)=>[k,used[i]])) };
  });
  return { kind: 'body-points', scope: raw.scope || 'product', keys, rows, source: raw.guideSource || item.url };
}
const items = products.map(item => {
  const productCode = item.brand === 'UNIQLO' ? item.url.match(/E(\d+)/)[1] : item.url.match(/-p(\d+)\.html/)[1];
  const price = item.price || Number(item.text.match(/([\d,]+)원/)[1].replaceAll(',',''));
  const image = new URL(item.image); image.searchParams.set(item.brand === 'UNIQLO' ? 'width' : 'w', '600');
  return { id: `${item.brand.toLowerCase()}-${item.gender}-${productCode}`, brand:item.brand, gender:item.gender, cat:item.cat, productCode, name:item.name.normalize('NFC'), price, image:image.href, url:item.url, checkedAt:updatedAt, sizing:item.brand === 'UNIQLO' ? uniqloSizing(item) : zaraSizing(item) };
});
assert.equal(new Set(items.map(x=>x.id)).size, 80, 'Products must be unique');
for (const gender of ['women','men']) for(const brand of ['UNIQLO','ZARA']) assert.equal(items.filter(x=>x.gender===gender&&x.brand===brand).length,20);
for (const item of items) {
  assert.ok(item.price > 0); assert.ok(item.image.startsWith('https://')); assert.ok(item.sizing.rows.length >= 2);
  for(const row of item.sizing.rows) for(const value of Object.values(row.values)) assert.ok((Array.isArray(value)?value:[value]).every(v=>Number.isFinite(v)&&v>0));
  if(item.sizing.kind === 'body-points') for(const key of item.sizing.keys) for(let i=1;i<item.sizing.rows.length;i++) assert.ok(item.sizing.rows[i].values[key]>item.sizing.rows[i-1].values[key], `Non-increasing body guide ${item.name} ${key}`);
}
const catalog = { updatedAt, ITEMS:items };
fs.writeFileSync(path.join(root,'fit-catalog.js'), '/* Official product photos and size references; snapshot '+updatedAt+'. Built by scripts/build-fit-catalog.cjs. */\nwindow.FIT_CATALOG = '+JSON.stringify(catalog,null,2)+';\n');
console.log('Built 80 products: women/men × UNIQLO/ZARA × 20.');
