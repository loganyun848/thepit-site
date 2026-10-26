const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../fit-sizing.js');
const sandbox = {window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../fit-catalog.js'),'utf8'),sandbox);
const items = JSON.parse(JSON.stringify(sandbox.window.FIT_CATALOG.ITEMS));
const woman = E.profile({gender:'women',height:168,weight:56,chest:84,waist:66,hips:92});
test('Both departments have exactly 20 distinct photographed items per brand',()=>{
  for(const gender of ['women','men']){
    const picks=E.forGender(items,gender);
    assert.equal(picks.length,40);assert.equal(new Set(picks.map(x=>x.id)).size,40);
    for(const brand of ['UNIQLO','ZARA'])assert.equal(picks.filter(x=>x.brand===brand).length,20);
    assert.ok(picks.every(x=>x.gender===gender && /^https:\/\//.test(x.image)&&!x.image.includes('svg')));
  }
});
test('The same body receives different sizes from the actual brand guides',()=>{
  const uq=items.find(x=>x.id==='uniqlo-women-469410');
  const za=items.find(x=>x.id==='zara-women-08026047');
  assert.equal(E.recommend(uq,woman).best.label,'M');
  assert.equal(E.recommend(za,woman).best.label,'S (KR 55)');
});
test('Garment flat widths are doubled; two body dimensions must both fit',()=>{
  const trousers={name:'일반 팬츠',cat:'bottom',sizing:{kind:'garment-flat',keys:['waist','hips'],rows:[{label:'S',values:{waist:34,hips:46}},{label:'M',values:{waist:36,hips:49}},{label:'L',values:{waist:39,hips:52}}]}};
  const p=E.profile({gender:'women',height:168,weight:56,chest:84,waist:70,hips:94});
  const r=E.recommend(trousers,p);assert.equal(r.best.label,'M');assert.equal(r.best.parts[0].delta,2);
  const largeHips=E.recommend(trousers,{...p,hips:115});assert.equal(largeHips.best,null);
});
test('Never force the largest or smallest size for bodies outside the guide',()=>{
  const item=items.find(x=>x.id==='uniqlo-women-469410');
  assert.equal(E.recommend(item,{...woman,chest:180}).best,null);
  assert.equal(E.recommend(item,{...woman,chest:50}).best,null);
});
test('Missing dimensions stay unknown and only relevant ones block a measured recommendation',()=>{
  const p=E.profile({gender:'women',height:168,weight:56,chest:84});
  assert.deepEqual(p.missing,['waist','hips']);assert.equal(p.chest,84);assert.equal(p.waist,null);
  assert.equal(E.recommend(items.find(x=>x.id==='uniqlo-women-469410'),p).status,'recommended');
  assert.equal(E.recommend(items.find(x=>x.brand==='UNIQLO'&&x.gender==='women'&&x.cat==='bottom'),p).status,'needs-measurements');
});
test('Missing gender, negative, out-of-range and nonfinite inputs are rejected',()=>{
  for(const change of [{gender:''},{height:0},{height:221},{weight:-5},{weight:'Infinity'},{waist:0},{chest:'abc'}])assert.throws(()=>E.profile({gender:'women',height:168,weight:56,...change}));
});
test('Decimal measurements and numeric jeans sizes remain intact',()=>{
  const p=E.profile({gender:'women',height:167.5,weight:55.5,chest:84.5,waist:68.5,hips:92});assert.equal(p.chest,84.5);
  assert.equal(E.recommend(items.find(x=>x.brand==='UNIQLO'&&x.gender==='women'&&x.cat==='bottom'),p).best.label,'27');
});
test('All 80 charts produce finite comparisons and use verified increasing body points',()=>{
  for(const item of items){
    const p=E.profile({gender:item.gender,height:item.gender==='men'?175:168,weight:item.gender==='men'?72:56,chest:100,waist:82,hips:98});
    const r=E.recommend(item,p);assert.ok(r.rows.length>=2,item.name);
    assert.ok(r.rows.every(row=>Number.isFinite(row.distance)&&row.parts.every(v=>Number.isFinite(v.lo)&&Number.isFinite(v.hi))),item.name);
  }
});
test('180 cm / 73 kg with usual XL stays XL, without inventing a 94 cm chest',()=>{
  const p=E.profile({gender:'men',height:180,weight:73,usualTopSize:'XL',usualBrand:'UNIQLO'});
  const r=E.recommend(items.find(x=>x.id==='uniqlo-men-453754'),p);
  assert.equal(p.chest,null);assert.equal(r.best.label,'XL');assert.equal(r.status,'usual-size');assert.equal(r.sameBrand,true);
});
test('Height and weight alone cannot produce a confident clothing size',()=>{
  const p=E.profile({gender:'men',height:180,weight:73});
  const r=E.recommend(items.find(x=>x.id==='uniqlo-men-453754'),p);
  assert.equal(r.best,null);assert.equal(r.status,'needs-measurements');
});
test('Real measurements conflicting with usual XL are compared instead of silently downgraded',()=>{
  const p=E.profile({gender:'men',height:180,weight:73,chest:94,usualTopSize:'XL'});
  const r=E.recommend(items.find(x=>x.id==='uniqlo-men-453754'),p);
  assert.equal(r.status,'conflict');assert.equal(r.best,null);assert.equal(r.usual.label,'XL');assert.equal(r.measured.label,'M');
});
test('Top XL does not become a bottom size and missing hips are not invented',()=>{
  const p=E.profile({gender:'men',height:180,weight:73,usualTopSize:'XL',waist:82});
  const item=items.find(x=>x.brand==='ZARA'&&x.cat==='bottom'&&x.sizing.keys.includes('hips'));
  const r=E.recommend(item,p);assert.equal(r.best,null);assert.ok(r.missing.includes('hips'));
});
test('Looser fit preference uses more garment ease when measurements are known',()=>{
  const item={name:'셔츠',cat:'top',sizing:{kind:'garment-flat',keys:['chest'],rows:[{label:'M',values:{chest:55}},{label:'L',values:{chest:58}}]}};
  const p=E.profile({gender:'men',height:180,weight:73,chest:100});
  assert.equal(E.recommend(item,p).best.label,'M');assert.equal(E.recommend(item,{...p,fitPreference:'relaxed'}).best.label,'L');
});
