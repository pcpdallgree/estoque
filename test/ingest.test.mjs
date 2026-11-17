import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHmac,createHash} from 'node:crypto';

const raw=fs.readFileSync(new URL('../supabase/functions/ingest-estoque/index.ts',import.meta.url),'utf8');
const secret='test-only-machine-secret-with-32-characters';
const id='db000000-0000-4000-8000-000000000010';
const calculate=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
function edge(){
 let handler;const calls=[];
 const variables={ESTOQUE_SYNC_SECRET:secret,SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-server-key'};
 vm.runInNewContext(stripTypeScriptTypes(raw),{
  Response,TextEncoder,TextDecoder,Uint8Array,Date,crypto,
  Deno:{env:{get:key=>variables[key]},serve:fn=>{handler=fn;}},
  fetch:async(url,options)=>{calls.push({url,options});return Response.json({state:'received'});}
 });
 async function send(value,{sign=true,time=String(Date.now())}={}){
  const body=JSON.stringify(value),signature=sign?createHmac('sha256',secret).update(time+'.'+body).digest('hex'):'f'.repeat(64);
  return handler(new Request('https://test.invalid',{method:'POST',body,headers:{'X-Estoque-Time':time,'X-Estoque-Signature':signature}}));
 }
 return {calls,send};
}
test('ingestão valida assinatura e janela temporal antes de usar o banco',async()=>{
 const {calls,send}=edge();
 assert.equal((await send({action:'health'},{sign:false})).status,401);
 assert.equal((await send({action:'health'},{time:String(Date.now()-301000)})).status,401);
 assert.equal(calls.length,0);
 assert.equal((await send({action:'health'})).status,200);
 assert.equal(calls[0].options.headers.Authorization,'Bearer test-server-key');
});
test('lote alterado, tamanho e manifesto são rejeitados',async()=>{
 const {calls,send}=edge(),rows=[{kind:'movement',key:'0007',notes:'ação'}];
 const batch={action:'batch',run_id:id,index:0,hash:calculate(rows),rows};
 assert.equal((await send({...batch,rows:[{...rows[0],notes:'alterada'}]})).status,422);
 assert.equal((await send({action:'start',run_id:id,full:true,captured_at:new Date().toISOString(),manifest:[]})).status,422);
 assert.equal((await send({...batch,rows:[{key:'x'.repeat(520000)}]})).status,413);
 assert.equal(calls.length,0);
 assert.equal((await send(batch)).status,200);
 assert.equal(JSON.parse(calls[0].options.body).p.rows[0].key,'0007');
});
