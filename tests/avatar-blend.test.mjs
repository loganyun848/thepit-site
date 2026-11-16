import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { writeBlend } from '../avatar-blend.mjs';
const template=readFileSync(new URL('../assets/avatar/avatar-template.blend',import.meta.url));
const index=JSON.parse(readFileSync(new URL('../assets/avatar/template-index.json',import.meta.url)));
const packed=index.blocks.find(b=>b.type==='PackedFile');
const size=template.readInt32LE(packed.offset+24);
const packedData=index.blocks.find(b=>b.address===template.readBigUInt64LE(packed.offset+32).toString());
const png=template.subarray(packedData.offset+24,packedData.offset+24+size);
const geometry={positions:[-.3,0,0,.3,0,0,.3,0,1.8,-.3,0,1.8],normals:[0,-1,0,0,-1,0,0,-1,0,0,-1,0],uvs:[0,0,1,0,1,1,0,1],triangles:[0,1,2,0,2,3]};
test('Native Blender export replaces mesh and texture datablocks; scene survives height scaling',()=>{
  const result=writeBlend(template,index,geometry,{BaseColor:png,ORM:png,Normal:png},1.73);
  assert.equal(Buffer.from(result.subarray(0,12)).toString(),'BLENDER-v293');
  let offset=12,mesh,verts;const counts=[];
  while(offset<result.length){const d=new DataView(result.buffer,offset,24),size=d.getUint32(4,true),sdna=d.getUint32(16,true);const type=index.blocks.find(b=>b.sdna===sdna)?.type;if(type==='Mesh')mesh=new DataView(result.buffer,offset+24,size);if(type==='MVert')verts=new DataView(result.buffer,offset+24,size);if(type==='PackedFile')counts.push(new DataView(result.buffer,offset+24,size).getInt32(0,true));offset+=24+size;}
  assert.equal(offset,result.length);assert.equal(mesh.getInt32(index.structs.Mesh.fields.totvert.offset,true),4);assert.equal(mesh.getInt32(index.structs.Mesh.fields.totpoly.offset,true),2);
  assert.ok(Math.abs(verts.getFloat32(2*20+8,true)-1.73)<1e-6);assert.deepEqual(counts,[png.length,png.length,png.length]);
  if(process.env.AVATAR_BLEND_FIXTURE)writeFileSync(process.env.AVATAR_BLEND_FIXTURE,result);
});
test('Invalid geometry, height and template are rejected before download',()=>{
  assert.throws(()=>writeBlend(template,index,{...geometry,triangles:[0,1,99]},{},1.8));
  assert.throws(()=>writeBlend(template,index,geometry,{},NaN));
  assert.throws(()=>writeBlend(new Uint8Array(12),index,geometry,{},1.8));
});
