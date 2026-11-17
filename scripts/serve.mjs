import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(process.env.DG_WEB_ROOT||'dist');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};
http.createServer(async (req,res)=>{
 try{
  const uri=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/estoque(?=\/|$)/,'');
  const file=path.resolve(root,'.'+(uri==='/'||!uri?'/index.html':uri));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  const bytes=await fs.readFile(file);
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
 }catch{if(!res.headersSent)res.writeHead(404).end('Arquivo não encontrado.');else res.end();}
}).listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('http://127.0.0.1:'+String(process.env.PORT||4173)+'/estoque/'));
