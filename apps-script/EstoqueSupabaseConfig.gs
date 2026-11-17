const DG_SYNC_TZ='America/Sao_Paulo';
const DG_SYNC_HANDLERS=['executarSincronizacaoIncremental','executarReconciliacaoCompleta'];
function dgSyncConfig_(){
 const p=PropertiesService.getScriptProperties();
 const url=p.getProperty('DG_SYNC_URL')||'',secret=p.getProperty('DG_SYNC_SECRET')||'';
 const spreadsheet=p.getProperty('DG_SPREADSHEET_ID')||'';
 if(!/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/ingest-estoque$/.test(url)||secret.length<32||!spreadsheet)
  throw Error('Configure DG_SYNC_URL, DG_SYNC_SECRET e DG_SPREADSHEET_ID.');
 return {p,url,secret,spreadsheet};
}
function instalarSincronizacaoSupabase(){
 const config=dgSyncConfig_();
 if(!config.p.getProperty('DG_CHECKPOINT_FILE'))throw Error('Configure DG_CHECKPOINT_FILE antes de instalar.');
 testarConexaoSupabase();
 desativarSincronizacaoSupabase();
 ScriptApp.newTrigger('executarSincronizacaoIncremental').timeBased().everyMinutes(5).create();
 ScriptApp.newTrigger('executarReconciliacaoCompleta').timeBased().atHour(3).everyDays(1).inTimezone(DG_SYNC_TZ).create();
}
function desativarSincronizacaoSupabase(){
 for(const trigger of ScriptApp.getProjectTriggers())if(DG_SYNC_HANDLERS.includes(trigger.getHandlerFunction()))ScriptApp.deleteTrigger(trigger);
}
function testarConexaoSupabase(){return dgSyncRequest_(dgSyncConfig_(),{action:'health'});}
