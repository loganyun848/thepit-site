const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg'};
http.createServer((req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(root,'.'+(pathname==='/'?'/fit.html':pathname));
    if(!file.startsWith(root+path.sep)||pathname.includes('/.git')){res.writeHead(403);res.end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);});
  }catch{res.writeHead(400);res.end();}
}).listen(8766,'127.0.0.1',()=>console.log('Fit Room preview: http://127.0.0.1:8766/fit.html'));
