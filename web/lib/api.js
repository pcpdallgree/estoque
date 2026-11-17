import config from '../config.js';
const {url,key}=config;
const SESSION='dg-auth-v1';
let session=null, refresh=null;
export const configured=()=>key.startsWith('sb_publishable_')&&!key.includes('CONFIGURE_AQUI');
export function saved(){try{session=JSON.parse(sessionStorage.getItem(SESSION)||'null');}catch{session=null;}return session;}
function keep(value){session=value;if(value)sessionStorage.setItem(SESSION,JSON.stringify(value));else sessionStorage.removeItem(SESSION);return value;}
async function request(path,body,token){
 if(!configured())throw Error('O acesso ao Supabase ainda não foi configurado.');
 const response=await fetch(url+path,{method:'POST',headers:{apikey:key,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){const error=Error(response.status===401?'Sessão inválida ou expirada. Entre novamente.':data.message||data.msg||data.error_description||'Não foi possível completar a consulta.');error.status=response.status;throw error;}
 return data;
}
export async function login(email,password){return keep(await request('/auth/v1/token?grant_type=password',{email,password}));}
export function recover(email){return request('/auth/v1/recover?redirect_to='+encodeURIComponent(location.origin+location.pathname),{email});}
export function recoverySession(){
 const p=new URLSearchParams(location.hash.slice(1));
 if(!['recovery','invite'].includes(p.get('type'))||!p.get('access_token')||!p.get('refresh_token'))return false;
 keep({access_token:p.get('access_token'),refresh_token:p.get('refresh_token'),expires_in:Number(p.get('expires_in')||3600),received_at:Date.now()});
 history.replaceState(null,'',location.pathname);return true;
}
async function access(){
 if(!session)throw Error('Entre para consultar o estoque.');
 const expires=session.expires_at||((session.received_at||0)/1000+(session.expires_in||3600));
 if(expires<=Date.now()/1000+45){
  if(!refresh)refresh=request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token}).then(keep).finally(()=>{refresh=null;});
  await refresh;
 }
 return session.access_token;
}
export async function passwordUpdate(password){
 const token=await access();
 const r=await fetch(url+'/auth/v1/user',{method:'PUT',headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({password})});
 if(!r.ok)throw Error('Não foi possível atualizar a senha. Solicite outro link ou tente uma senha mais forte.');
}
export async function logout(){
 try{if(session&&configured())await request('/auth/v1/logout',{},session.access_token);}
 finally{keep(null);}
}
export async function rpc(name,args={}){return request('/rest/v1/rpc/'+name,args,await access());}

export function subscribeSync(onUpdate){
 let socket,heartbeat,retry,closed=false,delay=1000;
 const reconnect=()=>{
  clearInterval(heartbeat);
  if(closed||retry)return;
  retry=setTimeout(()=>{retry=null;void connect();},delay);
  delay=Math.min(delay*2,30000);
 };
 async function connect(){
  try{
   const token=await access();if(closed)return;
   socket=new WebSocket(url.replace(/^https:/,'wss:')+'/realtime/v1/websocket?apikey='+encodeURIComponent(key)+'&vsn=1.0.0');
   let ref=0;
   const send=(topic,event,payload)=>socket.send(JSON.stringify({topic,event,payload,ref:String(++ref)}));
   socket.onopen=()=>{
    delay=1000;
    send('realtime:dallgree-sync','phx_join',{config:{broadcast:{self:false},presence:{key:''},
     postgres_changes:[{event:'*',schema:'public',table:'dallgree_sync_notice'}]},access_token:token});
    onUpdate();
    heartbeat=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)send('phoenix','heartbeat',{});},25000);
   };
   socket.onmessage=e=>{try{if(JSON.parse(e.data).event==='postgres_changes')onUpdate();}catch{}};
   socket.onerror=()=>socket.close();
   socket.onclose=reconnect;
  }catch{reconnect();}
 }
 void connect();
 return ()=>{closed=true;clearInterval(heartbeat);clearTimeout(retry);socket?.close();};
}
