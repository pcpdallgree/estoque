import test from 'node:test';
import assert from 'node:assert/strict';
import {csv,xlsx,collect} from '../web/lib/export.js';

const cols=[['note','Observação'],['qty','Quantidade']];
test('CSV neutraliza fórmulas e escapa campos sem converter números negativos',()=>{
 assert.equal(csv(cols,[{note:' =cmd()',qty:-2},{note:'aspas " ;',qty:0}]),'\ufeff"Observação";"Quantidade"\r\n"\' =cmd()";"-2"\r\n"aspas "" ;";"0"');
});
test('XLSX usa tipos numéricos e texto literal em pacote ZIP',async()=>{
 const blob=xlsx(cols,[{note:'=cmd() & anotação',qty:2.5}]);
 assert.match(blob.type,/spreadsheetml/);
 const bytes=new Uint8Array(await blob.arrayBuffer());
 const view=new DataView(bytes.buffer);
 assert.equal(view.getUint32(0,true),0x04034b50);
 assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
 const archive=new TextDecoder().decode(bytes);
 assert.match(archive,/inlineStr/);assert.match(archive,/=cmd\(\) &amp; anotação/);
 assert.match(archive,/<v>2\.5<\/v>/);assert.doesNotMatch(archive,/<f>/);
});
test('exportação pagina todo o recorte e recusa alteração de versão',async()=>{
 const first={version:'v1',total:3};
 const rows=await collect(async offset=>({...first,rows:[1,2,3].slice(offset,offset+2)}),first);
 assert.deepEqual(rows,[1,2,3]);
 await assert.rejects(collect(async()=>({version:'v2',rows:[1],total:3}),first),/base foi atualizada/);
 await assert.rejects(collect(async()=>first,{version:'v1',total:50001}),/ultrapassa/);
});
