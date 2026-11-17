function dgSyncAudit_(config,state,message){
 config.p.setProperty('DG_SYNC_STATUS',JSON.stringify({at:new Date().toISOString(),state,message}));
}
function diagnosticarSincronizacao(){
 const p=PropertiesService.getScriptProperties();
 const result=JSON.parse(p.getProperty('DG_SYNC_STATUS')||'null');
 console.log(JSON.stringify(result||{state:'não executada'}));
 return result;
}
