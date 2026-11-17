const MAX_BYTES = 512_000;
const encoder = new TextEncoder();
const hex = (data: ArrayBuffer) => Array.from(new Uint8Array(data), x=>x.toString(16).padStart(2,'0')).join('');
const respond = (status:number, data:object) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const digest = async (s:string) => hex(await crypto.subtle.digest('SHA-256',encoder.encode(s)));

Deno.serve(async (request: Request) => {
 if(request.method!=='POST')return respond(405,{error:'Método não permitido.'});
 const secret=Deno.env.get('ESTOQUE_SYNC_SECRET');
 const signature=request.headers.get('X-Estoque-Signature')||'';
 const timestamp=request.headers.get('X-Estoque-Time')||'';
 const secondary=Deno.env.get('ESTOQUE_SYNC_SECRET_PREVIOUS');
 if(!secret||secret.length<32)return respond(503,{error:'Ingestão indisponível.'});
 if(!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>300_000||!/^[a-f0-9]{64}$/.test(signature))
  return respond(401,{error:'Autenticação de integração inválida.'});
 if(!request.body||Number(request.headers.get('Content-Length'))>MAX_BYTES)return respond(413,{error:'Lote muito grande.'});
 try{
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];
  let total=0;
  while(true){
   const part=await reader.read();if(part.done)break;
   total+=part.value.length;
   if(total>MAX_BYTES){await reader.cancel();return respond(413,{error:'Lote muito grande.'});}
   chunks.push(part.value);
  }
  const bytes=new Uint8Array(total);let offset=0;
  for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const sig=Uint8Array.from(signature.match(/../g)!,part=>parseInt(part,16));
  let valid=false;
  for(const candidate of [secret,secondary].filter((key):key is string=>!!key&&key.length>=32)){
   const key=await crypto.subtle.importKey('raw',encoder.encode(candidate),{name:'HMAC',hash:'SHA-256'},false,['verify']);
   if(await crypto.subtle.verify('HMAC',key,sig,encoder.encode(timestamp+'.'+body)))valid=true;
  }
  if(!valid)return respond(401,{error:'Autenticação de integração inválida.'});
  const p=JSON.parse(body);
  if(!p||typeof p!=='object'||!['health','heartbeat','start','batch','finish'].includes(p.action)||
     (!['health','heartbeat'].includes(p.action)&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.run_id)))
   return respond(400,{error:'Envelope inválido.'});
  if(p.action==='start'&&(!Array.isArray(p.manifest)||!p.manifest.length||p.manifest.length>1000||
   typeof p.full!=='boolean'||typeof p.captured_at!=='string'||!Number.isFinite(Date.parse(p.captured_at))||
   p.manifest.some((b:{hash:string,count:number})=>!b||!/^[a-f0-9]{64}$/.test(b.hash)||!Number.isInteger(b.count)||b.count<0||b.count>400)))
   return respond(422,{error:'Manifesto inválido.'});
  if(p.action==='batch'&&(!Number.isInteger(p.index)||p.index<0||!Array.isArray(p.rows)||p.rows.length>400||
   p.rows.some((row:unknown)=>!row||typeof row!=='object'||Array.isArray(row))||p.hash!==await digest(JSON.stringify(p.rows))))
   return respond(422,{error:'Lote ou checksum inválido.'});
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url=Deno.env.get('SUPABASE_URL');
  if(!service||!url)return respond(503,{error:'Ingestão indisponível.'});
  const response=await fetch(url+'/rest/v1/rpc/ingest_estoque',{method:'POST',
   headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({p})});
  if(!response.ok){await response.body?.cancel();return respond(response.status>=500?503:422,{error:'Lote recusado pelo banco.'});}
  return respond(200,await response.json());
 }catch(error){
  return error instanceof SyntaxError||error instanceof TypeError&&error.message.includes('utf-8')
   ?respond(400,{error:'JSON inválido.'}):respond(503,{error:'Ingestão temporariamente indisponível.'});
 }
});
