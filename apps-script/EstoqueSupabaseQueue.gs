function dgSyncHex_(bytes){return bytes.map(n=>(n&255).toString(16).padStart(2,'0')).join('');}
function dgSyncHash_(text){return dgSyncHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8));}
function dgSyncRequest_(config,payload){
 const body=JSON.stringify(payload);
 for(let attempt=0;attempt<4;attempt++){
  const timestamp=String(Date.now());
  const signature=dgSyncHex_(Utilities.computeHmacSha256Signature(timestamp+'.'+body,config.secret,Utilities.Charset.UTF_8));
  let response=null;
  try{response=UrlFetchApp.fetch(config.url,{method:'post',contentType:'application/json',payload:body,
   followRedirects:false,muteHttpExceptions:true,headers:{'X-Estoque-Time':timestamp,'X-Estoque-Signature':signature}});}
  catch(error){if(attempt===3)throw Error('Falha de conexão com o Supabase.');}
  if(response){
   const code=response.getResponseCode();
   if(code>=200&&code<300)return JSON.parse(response.getContentText());
   if(code!==429&&code<500)throw Error('Ingestão recusada: HTTP '+code+'.');
  }
  if(attempt<3)Utilities.sleep(400*(2**attempt)+Math.floor(Math.random()*250));
 }
 throw Error('Supabase indisponível após quatro tentativas.');
}
function dgSyncReadCheckpoint_(file){
 const raw=file.getBlob().getDataAsString();
 return raw.trim()?JSON.parse(raw):{baseline:null,job:null};
}
function dgSyncWriteCheckpoint_(file,state){file.setContent(JSON.stringify(state));}
function dgSyncTransfer_(config,file,state,deadline){
 const job=state.job;
 const header=dgSyncRequest_(config,{action:'start',run_id:job.id,full:job.full,captured_at:job.captured,
  manifest:job.batches.map(rows=>({hash:dgSyncHash_(JSON.stringify(rows)),count:rows.length}))});
 if(header.state==='failed'){state.job=null;dgSyncWriteCheckpoint_(file,state);throw Error('Importação rejeitada. Revise o diagnóstico antes de refazer.');}
 if(header.state!=='completed'){
  while(job.next<job.batches.length&&Date.now()<deadline){
   const rows=job.batches[job.next];
   const ack=dgSyncRequest_(config,{action:'batch',run_id:job.id,index:job.next,hash:dgSyncHash_(JSON.stringify(rows)),rows});
   if(ack.state!=='received')throw Error('Lote sem confirmação.');
   job.next++;dgSyncWriteCheckpoint_(file,state);
  }
  if(job.next<job.batches.length)return 'retomar';
  const confirm=dgSyncRequest_(config,{action:'finish',run_id:job.id});
  if(confirm.state!=='completed'){
   if(confirm.state==='failed'){state.job=null;dgSyncWriteCheckpoint_(file,state);}
   throw Error('A importação não foi concluída. Consulte a Administração.');
  }
 }
 state.baseline=job.hashes;state.job=null;
 dgSyncWriteCheckpoint_(file,state);
 return 'completed';
}
