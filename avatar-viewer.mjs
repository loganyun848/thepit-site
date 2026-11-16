import * as THREE from 'three';
import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';
import { GLTFLoader } from './vendor/three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from './vendor/three/addons/loaders/DRACOLoader.js';
import { writeBlend } from './avatar-blend.mjs';

export function embeddedGLB(buffer) {
  const d=new DataView(buffer);
  if(buffer.byteLength<28 || d.getUint32(0,true)!==0x46546c67 || d.getUint32(4,true)!==2 || d.getUint32(8,true)!==buffer.byteLength || d.getUint32(16,true)!==0x4e4f534a)throw Error('올바른 GLB 모델이 아닙니다.');
  const length=d.getUint32(12,true);
  if(length>buffer.byteLength-20)throw Error('GLB 파일이 잘렸습니다.');
  const doc=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length)));
  // Do not let an imported model load arbitrary remote images or local resources.
  for(const item of [...(doc.images||[]),...(doc.buffers||[])])if(item.uri && !/^data:(image\/(png|jpeg|webp)|application\/octet-stream);base64,/.test(item.uri))throw Error('외부 파일을 참조하는 모델은 원본 GLB로 내려받아 확인해 주세요.');
  return doc;
}
export async function createAvatarViewer(container,buffer,{onCamera=()=>{}}={}) {
  embeddedGLB(buffer);
  const draco=new DRACOLoader().setDecoderPath(new URL('./vendor/three/draco/',import.meta.url).href);
  let gltf;
  try{gltf=await new GLTFLoader().setDRACOLoader(draco).parseAsync(buffer,'');}catch(error){draco.dispose();throw error;}
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  container.replaceChildren(renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','3D 아바타. 드래그로 회전, 휠로 확대. 촬영 각도 버튼으로도 이동 가능.');
  const scene=new THREE.Scene(), root=new THREE.Group();scene.add(root);
  const model=gltf.scene;model.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  if(!Number.isFinite(size.y)||size.y<.00001)throw Error('모델의 크기를 확인하지 못했습니다.');
  const normalizer=new THREE.Group();normalizer.scale.setScalar(1.8/size.y);normalizer.position.set(-center.x*1.8/size.y,-box.min.y*1.8/size.y,-center.z*1.8/size.y);normalizer.add(model);root.add(normalizer);
  const hemi=new THREE.HemisphereLight(0xf6f7ff,0x575266,2.2);scene.add(hemi);
  for(const [color,intensity,pos] of [[0xfff3e4,3,[3,4,4]],[0xddeaff,2,[-3,2,1]],[0xffffff,2,[0,3,-3]]]){const light=new THREE.DirectionalLight(color,intensity);light.position.set(...pos);scene.add(light);}
  const camera=new THREE.PerspectiveCamera(30,1,.01,100);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=.22;controls.maxDistance=12;controls.autoRotateSpeed=.8;
  let current=null,disposed=false,frame;
  const draw=()=>{if(disposed)return;frame=requestAnimationFrame(draw);if(!document.hidden){controls.update();renderer.render(scene,camera);}};
  const resize=()=>{const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(current)shot(current);};
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  function shot(plan) {
    current=plan;controls.autoRotate=false;
    const face=plan.framing==='face',target=new THREE.Vector3(0,face?1.62:.9,0);
    const bounds=new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    const extent=face?.50:Math.max(2.25,Math.hypot(bounds.x,bounds.z)/camera.aspect*1.25);
    const distance=extent/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));
    const az=THREE.MathUtils.degToRad(plan.azimuth),el=THREE.MathUtils.degToRad(plan.elevation);
    camera.position.set(Math.sin(az)*Math.cos(el)*distance,target.y+Math.sin(el)*distance,Math.cos(az)*Math.cos(el)*distance);
    controls.target.copy(target);controls.update();onCamera(plan);renderer.render(scene,camera);
  }
  controls.addEventListener('start',()=>{current=null;onCamera(null);});
  shot({id:'front',label:'정면 · 전신',azimuth:0,elevation:0,framing:'body'});draw();
  return {
    shot,
    autoRotate(value){controls.autoRotate=value;},
    setFront(){root.rotation.y-=controls.getAzimuthalAngle();root.updateMatrixWorld(true);},
    async snapshot(){renderer.render(scene,camera);return new Promise(resolve=>renderer.domElement.toBlob(resolve,'image/png'));},
    async blend(height){
      const [template,index]=await Promise.all([fetch('./assets/avatar/avatar-template.blend').then(r=>{if(!r.ok)throw Error('블렌더 템플릿을 불러오지 못했습니다.');return r.arrayBuffer();}),fetch('./assets/avatar/template-index.json').then(r=>r.json())]);
      const {geometry,textures}=await atlasMesh(root);
      return new Blob([writeBlend(template,index,geometry,textures,height)],{type:'application/octet-stream'});
    },
    dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();draco.dispose();root.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const mat of [].concat(o.material)){for(const v of Object.values(mat))if(v?.isTexture)v.dispose();mat.dispose();}}});renderer.dispose();container.replaceChildren();},
  };
}

// Bake standard glTF PBR materials into three packed atlases. The source GLB is
// retained separately; this export is intentionally a static, editable look-dev mesh.
async function atlasMesh(root) {
  const meshes=[];root.updateMatrixWorld(true);root.traverse(o=>{if(o.isMesh && o.visible)meshes.push(o);});
  const materials=[...new Set(meshes.flatMap(o=>[].concat(o.material)))];
  if(!materials.length||materials.length>16)throw Error('블렌더 내보내기는 최대 16개 재질을 지원합니다. 원본 GLB를 저장해 주세요.');
  if(meshes.some(o=>o.isSkinnedMesh))throw Error('리깅 모델은 원본 GLB로 저장해 주세요. 이 내보내기는 정지 모델용입니다.');
  const grid=Math.ceil(Math.sqrt(materials.length)), tile=grid<=2?2048:1024, side=grid*tile,pad=8;
  const atlases={};for(const n of ['BaseColor','ORM','Normal']){const c=document.createElement('canvas');c.width=c.height=side;atlases[n]=c;}
  const texturePixels=(texture,channel,constant,scale=1)=>{
    const c=document.createElement('canvas');c.width=c.height=tile-2*pad;const ctx=c.getContext('2d',{willReadFrequently:true});
    if(texture?.image){texture.updateMatrix();if(!texture.matrix.equals(new THREE.Matrix3()))throw Error('변형된 UV 재질은 원본 GLB로 저장해 주세요.');ctx.drawImage(texture.image,0,0,c.width,c.height);}
    else {ctx.fillStyle=`rgb(${Math.round(constant*255)},${Math.round(constant*255)},${Math.round(constant*255)})`;ctx.fillRect(0,0,c.width,c.height);}
    return {canvas:c,context:ctx,pixels:ctx.getImageData(0,0,c.width,c.height),channel,scale};
  };
  function place(canvas,index,target) {
    const ctx=target.getContext('2d'),x=(index%grid)*tile,y=Math.floor(index/grid)*tile,n=tile-2*pad;
    ctx.drawImage(canvas,x+pad,y+pad,n,n);
    ctx.drawImage(canvas,0,0,1,n,x,y+pad,pad,n);ctx.drawImage(canvas,n-1,0,1,n,x+tile-pad,y+pad,pad,n);
    ctx.drawImage(canvas,0,0,n,1,x+pad,y,n,pad);ctx.drawImage(canvas,0,n-1,n,1,x+pad,y+tile-pad,n,pad);
    for(const [sx,sy,dx,dy] of [[0,0,x,y],[n-1,0,x+tile-pad,y],[0,n-1,x,y+tile-pad],[n-1,n-1,x+tile-pad,y+tile-pad]])ctx.drawImage(canvas,sx,sy,1,1,dx,dy,pad,pad);
  }
  for(let i=0;i<materials.length;i++) {
    const mat=materials[i],base=texturePixels(mat.map,0,1),color=mat.color.clone().convertLinearToSRGB();
    for(let j=0;j<base.pixels.data.length;j+=4){base.pixels.data[j]*=color.r;base.pixels.data[j+1]*=color.g;base.pixels.data[j+2]*=color.b;base.pixels.data[j+3]=255;}
    base.context.putImageData(base.pixels,0,0);place(base.canvas,i,atlases.BaseColor);
    const rough=texturePixels(mat.roughnessMap,1,1),metal=texturePixels(mat.metalnessMap,2,1),orm=rough.pixels.data;
    for(let j=0;j<orm.length;j+=4){orm[j]=255;orm[j+1]=orm[j+1]*(mat.roughness??1);orm[j+2]=metal.pixels.data[j+2]*(mat.metalness??0);orm[j+3]=255;}
    rough.context.putImageData(rough.pixels,0,0);place(rough.canvas,i,atlases.ORM);
    const normal=texturePixels(mat.normalMap,0,1);
    for(let j=0;j<normal.pixels.data.length;j+=4){const d=normal.pixels.data;if(!mat.normalMap){d[j]=128;d[j+1]=128;d[j+2]=255;}else{d[j]=(d[j]-128)*(mat.normalScale?.x??1)+128;d[j+1]=(d[j+1]-128)*(mat.normalScale?.y??1)+128;}d[j+3]=255;}
    normal.context.putImageData(normal.pixels,0,0);place(normal.canvas,i,atlases.Normal);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  const geometry={positions:[],normals:[],uvs:[],triangles:[]},v=new THREE.Vector3(),n=new THREE.Vector3();
  for(const object of meshes) {
    const geo=object.geometry.clone();if(!geo.attributes.normal)geo.computeVertexNormals();
    const nm=new THREE.Matrix3().getNormalMatrix(object.matrixWorld),pos=geo.attributes.position,norm=geo.attributes.normal,uv=geo.attributes.uv;
    const groups=geo.groups.length?geo.groups:[{start:0,count:geo.index?.count||pos.count,materialIndex:0}];
    for(const group of groups){const material=[].concat(object.material)[group.materialIndex||0]||object.material,mi=materials.indexOf(material),tx=(mi%grid)*tile,ty=Math.floor(mi/grid)*tile;
      for(let c=group.start;c<group.start+group.count;c++) {
        const k=geo.index?geo.index.getX(c):c,u=uv?uv.getX(k):.5,w=uv?uv.getY(k):.5;
        if(u<-.001||u>1.001||w<-.001||w>1.001)throw Error('반복 UV가 있는 모델은 원본 GLB로 저장해 주세요.');
        v.fromBufferAttribute(pos,k).applyMatrix4(object.matrixWorld);n.fromBufferAttribute(norm,k).applyNormalMatrix(nm);
        geometry.positions.push(v.x,-v.z,v.y);geometry.normals.push(n.x,-n.z,n.y);
        geometry.uvs.push((tx+pad+Math.max(0,Math.min(1,u))*(tile-2*pad))/side,1-(ty+pad+Math.max(0,Math.min(1,w))*(tile-2*pad))/side);
        geometry.triangles.push(geometry.triangles.length);
      }
    }
    geo.dispose();
  }
  // Weld vertices sharing position, normal and atlas UV; preserve UV seams.
  const welded={positions:[],normals:[],uvs:[],triangles:[]},vertices=new Map();
  for(let i=0;i<geometry.triangles.length;i++){const row=[...geometry.positions.slice(i*3,i*3+3),...geometry.normals.slice(i*3,i*3+3),...geometry.uvs.slice(i*2,i*2+2)],key=row.map(x=>x.toFixed(7)).join(',');if(!vertices.has(key)){vertices.set(key,vertices.size);welded.positions.push(...row.slice(0,3));welded.normals.push(...row.slice(3,6));welded.uvs.push(...row.slice(6));}welded.triangles.push(vertices.get(key));}
  const textures={};for(const [name,c] of Object.entries(atlases)){const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));if(!blob)throw Error('재질 저장 공간이 부족합니다. PC에서 다시 저장해 주세요.');textures[name]=new Uint8Array(await blob.arrayBuffer());c.width=c.height=1;}
  return {geometry:welded,textures};
}
