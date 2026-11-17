function dgSyncText_(value){return String(value==null?'':value).trim();}
function dgSyncNorm_(value){return dgSyncText_(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');}
function dgSyncDay_(value){
 if(value instanceof Date&&!isNaN(value.getTime()))return Utilities.formatDate(value,DG_SYNC_TZ,'yyyy-MM-dd');
 if(typeof value==='number'&&value>=1&&value<2958466)
  return new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);
 const text=dgSyncText_(value),parts=text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
 const iso=parts?parts[3]+'-'+parts[2]+'-'+parts[1]:text;
 const date=new Date(iso+'T12:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(iso)&&!isNaN(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:null;
}
function dgSyncInstant_(value){
 if(value instanceof Date&&!isNaN(value.getTime()))return value.toISOString();
 if(typeof value==='number'){
  const day=dgSyncDay_(value);if(!day)return null;
  const time=new Date(Math.round((value-Math.floor(value))*86400000)).toISOString().slice(11,19);
  return Utilities.parseDate(day+' '+time,DG_SYNC_TZ,'yyyy-MM-dd HH:mm:ss').toISOString();
 }
 const text=dgSyncText_(value);
 if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)){
  const date=new Date(text);return isNaN(date.getTime())?null:date.toISOString();
 }
 const match=text.match(/^(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
 if(!match||!dgSyncDay_(match[1]))return null;
 const civil=dgSyncDay_(match[1])+' '+(match[2].length===5?match[2]+':00':match[2]);
 const result=Utilities.parseDate(civil,DG_SYNC_TZ,'yyyy-MM-dd HH:mm:ss');
 return Utilities.formatDate(result,DG_SYNC_TZ,'yyyy-MM-dd HH:mm:ss')===civil?result.toISOString():null;
}
function dgSyncQuantity_(value){
 const text=dgSyncText_(value).replace(/\u00a0/g,'');
 if(/^\d{1,3}(?:\.\d{3})+,\d{1,6}$/.test(text))return text.replace(/\./g,'').replace(',','.');
 if(/^\d+(?:[.,]\d{1,6})?$/.test(text))return text.replace(',','.');
 return null;
}
function dgSyncSigned_(value){const text=dgSyncText_(value);return text.startsWith('-')?((v)=>v==null?null:'-'+v)(dgSyncQuantity_(text.slice(1))):dgSyncQuantity_(text);}
function dgSyncSheet_(book,name,headers,project){
 const sheet=book.getSheetByName(name);if(!sheet)throw Error('Guia ausente: '+name);
 const width=sheet.getLastColumn(),last=sheet.getLastRow();
 if(!width||!last)throw Error('Cabeçalho ausente: '+name);
 const found=sheet.getRange(1,1,1,width).getDisplayValues()[0].map(dgSyncNorm_);
 const cols=headers.map(h=>{
  const matches=found.reduce((a,x,i)=>x===dgSyncNorm_(h)?a.concat(i):a,[]);
  if(matches.length!==1)throw Error('Coluna ausente ou duplicada: '+name+' / '+h);
  return matches[0];
 });
 const out=[];
 for(let row=2;row<=last;row+=500){
  const values=sheet.getRange(row,1,Math.min(500,last-row+1),width).getValues();
  values.forEach((line,i)=>{
   const selected=cols.map(c=>line[c]);
   if(selected.every(v=>dgSyncText_(v)===''))return;
   const data=project(...selected);
   out.push({data,row:row+i});
  });
 }
 return out;
}
function dgSyncSnapshot_(book){
 const inputs=[
  ...dgSyncSheet_(book,'CADASTRO',['PRODUTO','UNIDADE','CATEGORIA','LOCALIZAÇÃO'],(name,unit,category,location)=>
   ({kind:'product',key:dgSyncNorm_(name),name:dgSyncText_(name),unit:dgSyncText_(unit),category:dgSyncText_(category),location:dgSyncText_(location)})),
  ...['MATERIA-PRIMA','PRODUTO ACABADO','EMBALAGEM'].flatMap(category=>dgSyncSheet_(book,category,['ITEM','SALDO ATUAL','UNIDADE'],(item,balance,unit)=>
   ({kind:'balance',key:dgSyncNorm_(item)?dgSyncNorm_(category)+':'+dgSyncNorm_(item):'',item_key:dgSyncNorm_(item),category:dgSyncNorm_(category),unit:dgSyncText_(unit),balance:dgSyncSigned_(balance)}))),
  ...dgSyncSheet_(book,'OPERADOR',['OPERADOR'],name=>({kind:'operator',key:dgSyncNorm_(name),name:dgSyncText_(name)})),
  ...dgSyncSheet_(book,'MOVIMENTAÇÃO',['ID','DATA_HORA','DATA','OPERADOR','ITEM','UNIDADE','CATEGORIA','QUANTIDADE','OPERAÇÃO','MOTIVO','OBSERVAÇÃO'],
   (id,instant,date,operator,item,unit,category,qty,operation,reason,notes)=>{
    const timestamp=dgSyncInstant_(instant);
    return {kind:'movement',key:dgSyncText_(id),instant:timestamp,date:dgSyncDay_(date)||
     (dgSyncText_(date)===''&&timestamp?dgSyncDay_(new Date(timestamp)):null),
     operator:dgSyncText_(operator),item:dgSyncText_(item),unit:dgSyncText_(unit),category:dgSyncText_(category),
     qty:dgSyncQuantity_(qty),operation:dgSyncText_(operation),reason:dgSyncText_(reason),notes:dgSyncText_(notes),
     original:{date:dgSyncText_(date),instant:dgSyncText_(instant),qty:dgSyncText_(qty)}};
   })
 ];
 const hashes=Object.create(null),duplicates=[];
 const rows=inputs.map(({data,row})=>{
  const key=data.kind+':'+data.key;
  if(!data.key||Object.prototype.hasOwnProperty.call(hashes,key))duplicates.push(data.kind+' linha '+row);
  hashes[key]=dgSyncHash_(JSON.stringify(data));
  return data;
 });
 if(duplicates.length)throw Error('IDs vazios ou duplicados: '+duplicates.slice(0,20).join(', ')+' ('+duplicates.length+' ocorrências).');
 return {rows,hashes};
}
function dgSyncExecute_(full){
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(1000))return 'execução em andamento';
 let config;
 try{
  const deadline=Date.now()+240000;config=dgSyncConfig_();
  const file=DriveApp.getFileById(config.p.getProperty('DG_CHECKPOINT_FILE'));
  const state=dgSyncReadCheckpoint_(file);
  if(!state.job){
   const book=SpreadsheetApp.openById(config.spreadsheet);
   const captured=new Date().toISOString();
   const first=dgSyncSnapshot_(book);
   const second=dgSyncSnapshot_(book);
   const keys=Object.keys(first.hashes);
   if(keys.length!==Object.keys(second.hashes).length||keys.some(k=>first.hashes[k]!==second.hashes[k]))
    throw Error('Planilha alterada durante a leitura. O próximo ciclo repetirá a captura.');
   if(!first.rows.some(r=>r.kind==='product'))throw Error('Cadastro vazio. Reconciliação interrompida.');
   const isFull=full||!state.baseline;
   const changed=isFull?first.rows:first.rows.filter(r=>r.kind!=='balance'&&state.baseline[r.kind+':'+r.key]!==first.hashes[r.kind+':'+r.key]);
   if(!changed.length){dgSyncRequest_(config,{action:'heartbeat'});dgSyncAudit_(config,'no_changes','Nenhuma alteração detectada.');return 'no_changes';}
   const hashes=isFull?first.hashes:Object.assign({},state.baseline,first.hashes);
   const batches=[];let current=[],size=0;
   for(const row of changed){
    const bytes=Utilities.newBlob(JSON.stringify(row)).getBytes().length;
    if(bytes>400000)throw Error('Uma linha ultrapassa o tamanho de lote.');
    if(current.length>=250||size+bytes>420000){batches.push(current);current=[];size=0;}
    current.push(row);size+=bytes+1;
   }
   if(current.length)batches.push(current);
   state.job={id:Utilities.getUuid(),full:isFull,captured,hashes,batches,next:0};
   dgSyncWriteCheckpoint_(file,state);
  }
  const result=dgSyncTransfer_(config,file,state,deadline);
  dgSyncAudit_(config,result,result==='completed'?'Carga confirmada.':'Lotes restantes serão retomados no próximo ciclo.');
  return result;
 }catch(error){
  if(config)dgSyncAudit_(config,'failed',String(error.message).slice(0,480));
  throw error;
 }finally{lock.releaseLock();}
}
function executarSincronizacaoIncremental(){return dgSyncExecute_(false);}
function executarReconciliacaoCompleta(){return dgSyncExecute_(true);}
