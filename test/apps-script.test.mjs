import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=file=>fs.readFileSync(new URL('../apps-script/'+file,import.meta.url),'utf8');
test('datas civis e quantidades do Sheets são normalizadas sem deslocamento de dia',()=>{
 const c={Date};vm.runInNewContext(read('EstoqueSupabaseSync.gs'),c);
 assert.equal(c.dgSyncDay_(46022),'2025-12-31');
 assert.equal(c.dgSyncDay_(46023.7),'2026-01-01');
 assert.equal(c.dgSyncDay_('31/02/2026'),null);
 assert.equal(c.dgSyncDay_('29/02/2024'),'2024-02-29');
 assert.equal(c.dgSyncQuantity_('1.345,125'),'1345.125');
 assert.equal(c.dgSyncQuantity_('0,500000'),'0.500000');
 assert.equal(c.dgSyncQuantity_(-5),null);
});
test('fila retoma o lote após falha e só avança a base após confirmação final',()=>{
 const calls=[];let fail=true;
 const c={Date,mockRequest:(_cfg,p)=>{
  calls.push([p.action,p.index]);if(p.action==='start')return {state:'receiving'};
  if(p.action==='finish')return {state:'completed'};
  if(p.index===1&&fail)throw Error('offline');
  return {state:'received'};
 }};
 vm.runInNewContext(read('EstoqueSupabaseQueue.gs')+'\ndgSyncHash_=s=>s;dgSyncRequest_=mockRequest;',c);
 const saved=[];
 const file={setContent:value=>saved.push(JSON.parse(value))};
 const state={baseline:null,job:{id:'test',captured:'2026-01-01T00:00:00Z',full:true,batches:[[1],[2],[3]],next:0,hashes:{x:'hash'}}};
 assert.throws(()=>c.dgSyncTransfer_({},file,state,Infinity),/offline/);
 assert.equal(saved.at(-1).job.next,1);assert.equal(saved.at(-1).baseline,null);
 fail=false;
 assert.equal(c.dgSyncTransfer_({},file,state,Infinity),'completed');
 assert.equal(saved.at(-1).job,null);assert.deepEqual(saved.at(-1).baseline,{x:'hash'});
 assert.deepEqual(calls.filter(([type])=>type==='batch').map(([,index])=>index),[0,1,1,2]);
});
