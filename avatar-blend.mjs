// A deliberately narrow Blender 2.93 writer, using a checked-in SDNA template.
// It writes real mesh datablocks, UV loops and packed PBR textures, not a renamed GLB.
// Blender 3.x/4.x upgrade the scene when opening it. No Python is embedded or run.
export function writeBlend(template, index, geometry, textures, height = 1.8) {
  const source = new Uint8Array(template);
  if (new TextDecoder().decode(source.subarray(0,12)) !== 'BLENDER-v293') throw Error('Unsupported Blender template');
  if (!Number.isFinite(height) || height < .8 || height > 2.5) throw Error('Height must be 0.8–2.5 metres');
  const blocks = index.blocks.map(b => ({...b, data:source.slice(b.offset+24,b.offset+24+b.size)}));
  const byAddress = new Map(blocks.map(b => [b.address,b]));
  const fields = type => index.structs[type].fields;
  const view = b => new DataView(b.data.buffer,b.data.byteOffset,b.data.byteLength);
  const ptr = (b, offset) => view(b).getBigUint64(offset,true).toString();
  const name = b => new TextDecoder().decode(b.data.subarray(fields('ID').name.offset,fields('ID').name.offset+66)).split('\0')[0].slice(2);
  const mesh = blocks.find(b => b.type === 'Mesh' && name(b) === 'AvatarMesh');
  if (!mesh) throw Error('Mesh template missing');
  const {positions,normals,uvs,triangles} = geometry;
  const nv=positions.length/3, nt=triangles.length/3;
  if (!Number.isInteger(nv) || !nv || !Number.isInteger(nt) || !nt || nt>300000 || nv>900000 || normals.length!==positions.length || uvs.length!==nv*2) throw Error('Unsupported mesh size');
  for (const array of [positions,normals,uvs]) for (const value of array) if (!Number.isFinite(value)) throw Error('Non-finite mesh data');
  const edges=[],edgeMap=new Map(),loopEdges=[];
  for(let t=0;t<triangles.length;t+=3) {
    for(let c=0;c<3;c++) {
      const a=triangles[t+c],b=triangles[t+(c+1)%3];
      if(!Number.isInteger(a)||a<0||a>=nv) throw Error('Invalid vertex index');
      const key=a<b?`${a}:${b}`:`${b}:${a}`;
      if(!edgeMap.has(key)){edgeMap.set(key,edges.length/2);edges.push(a,b);}
      loopEdges.push(edgeMap.get(key));
    }
  }
  function replace(type,count,fill) {
    const b=blocks.find(b=>b.type===type), stride=index.structs[type].size;
    if(!b)throw Error('Missing '+type);
    b.data=new Uint8Array(stride*count);b.count=count;
    const d=view(b);for(let i=0;i<count;i++)fill(d,i*stride,i);
  }
  const factor=height/1.8;
  replace('MVert',nv,(d,o,i)=>{for(let c=0;c<3;c++){d.setFloat32(o+c*4,positions[i*3+c]*factor,true);d.setInt16(o+12+c*2,Math.round(Math.max(-1,Math.min(1,normals[i*3+c]))*32767),true);}});
  replace('MEdge',edges.length/2,(d,o,i)=>{d.setUint32(o,edges[i*2],true);d.setUint32(o+4,edges[i*2+1],true);d.setUint16(o+10,3,true);});
  replace('MLoop',triangles.length,(d,o,i)=>{d.setUint32(o,triangles[i],true);d.setUint32(o+4,loopEdges[i],true);});
  replace('MLoopUV',triangles.length,(d,o,i)=>{d.setFloat32(o,uvs[triangles[i]*2],true);d.setFloat32(o+4,uvs[triangles[i]*2+1],true);});
  replace('MPoly',nt,(d,o,i)=>{d.setInt32(o,i*3,true);d.setInt32(o+4,3,true);d.setUint8(o+10,1);});
  const mf=fields('Mesh'), md=view(mesh);
  for(const [key,count] of Object.entries({totvert:nv,totedge:edges.length/2,totloop:triangles.length,totpoly:nt,totface:0,totselect:0}))md.setInt32(mf[key].offset,count,true);
  for(const b of blocks.filter(b=>b.type==='Image')) {
    const bytes=textures[name(b)];if(!bytes)throw Error('Missing packed texture: '+name(b));
    const imagePacked=byAddress.get(ptr(b,fields('Image').packedfiles.offset));
    const packed=byAddress.get(ptr(imagePacked,fields('ImagePackedFile').packedfile.offset));
    const data=byAddress.get(ptr(packed,fields('PackedFile').data.offset));
    view(packed).setInt32(fields('PackedFile').size.offset,bytes.length,true);
    // Serialized raw DATA blocks are padded to a 4-byte boundary; PackedFile.size is exact.
    data.data=new Uint8Array(Math.ceil(bytes.length/4)*4);data.data.set(bytes);
    data.count=data.data.length;
  }
  // Camera positions and studio lights scale with the entered height, not just the mesh.
  for(const b of blocks.filter(b=>b.type==='Object')) {
    const d=view(b), f=fields('Object');
    for(let c=0;c<3;c++) d.setFloat32(f.loc.offset+c*4,d.getFloat32(f.loc.offset+c*4,true)*factor,true);
    for(const matrix of ['obmat','imat'])if(f[matrix])for(let c=0;c<3;c++){const o=f[matrix].offset+48+c*4;d.setFloat32(o,d.getFloat32(o,true)*factor,true);}
  }
  const output=new Uint8Array(12+blocks.reduce((sum,b)=>sum+24+b.data.length,0));output.set(source.subarray(0,12));
  let offset=12;
  for(const b of blocks) {
    output.set(source.subarray(b.offset,b.offset+24),offset);
    const d=new DataView(output.buffer,offset,24);d.setUint32(4,b.data.length,true);d.setUint32(20,b.count,true);
    output.set(b.data,offset+24);offset+=24+b.data.length;
  }
  return output;
}
