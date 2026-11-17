import * as api from './lib/api.js';
import {collect,csv,download,xlsx} from './lib/export.js';
import {demoQuery} from './lib/demo.js';

const root=document.querySelector('#app');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3});
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
const instant=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
const today=()=>dayFormat.format(new Date());
const displayDate=date=>date?date.slice(0,10).split('-').reverse().join('/'):'—';
const shift=(date,delta)=>new Date(Date.parse(date+'T12:00:00Z')+86400000*delta).toISOString().slice(0,10);
const titles={dashboard:'Visão geral',stock:'Estoque atual',historical:'Posição histórica',movements:'Movimentações',flow:'Análise por período',abc:'Curva ABC',kpis:'Indicadores',reports:'Relatórios',admin:'Administração'};
const subtitle={dashboard:'Acompanhe a posição do estoque e as movimentações do período.',stock:'Saldos acumulados por produto, categoria e unidade.',historical:'Compare a posição na data selecionada com o saldo atual. A localização é a do cadastro vigente.',movements:'Consulte os lançamentos sincronizados e as inconsistências da origem.',flow:'Acompanhe entradas, saídas e saldo por unidade.',abc:'Compare participação e concentração de consumo.',kpis:'Identifique itens parados, saldos críticos e lacunas de cadastro.',reports:'Gere relatórios com o recorte e a versão da consulta.',admin:'Consulte sincronizações e configure parâmetros gerenciais.'};
const stock=[['product','Produto'],['category','Categoria'],['unit','Unidade'],['location','Localização'],['entries','Entradas'],['exits','Saídas'],['balance','Saldo'],['last_movement','Última movimentação'],['unit_cost','Custo (R$)'],['stock_value','Valor (R$)']];
const movement=[['source_id','ID'],['business_date','Data'],['item','Item'],['category','Categoria'],['unit','Unidade'],['operation','Operação'],['qty','Quantidade'],['operator_name','Operador'],['reason','Motivo'],['notes','Observação'],['location','Localização atual'],['issue','Inconsistência']];
const flow=[['day','Período'],['unit','Unidade'],['opening','Saldo inicial'],['entries','Entradas'],['exits','Saídas'],['closing','Saldo final']];
const abc=[['product','Produto'],['unit','Unidade'],['score','Valor / volume'],['share','Participação (%)'],['accumulated','Acumulado (%)'],['class','Classe']];
const grouped=[['name','Grupo'],['unit','Unidade'],['movements','Movimentos'],['entries','Entradas'],['exits','Saídas']];
const indicatorColumns=[['product','Produto'],['unit','Unidade'],['balance','Saldo'],['minimum_qty','Mínimo'],['maximum_qty','Máximo'],['reorder_qty','Reposição'],['days_idle','Dias parado'],['consumption','Saídas no período'],['coverage_days','Cobertura em dias'],['turnover','Giro no período'],['adjustments','Ajustes']];
const recon=[['product_key','Produto'],['category','Categoria'],['unit','Unidade'],['sheet_balance','Planilha'],['ledger_balance','Supabase'],['reason','Divergência']];
const reportOptions=[['stock','Posição atual'],['historical','Posição por data'],['movements','Movimentos no período'],['entries','Entradas por produto'],['exits','Saídas por produto'],['operator','Consumo por operador'],['reason','Consumo por motivo'],['abc','Curva ABC'],['idle','Itens parados'],['negative','Saldos negativos'],['missing','Sem localização'],['divergences','Divergências de conciliação'],['month','Resumo mensal'],['flow','Evolução de saldo']];
const localRead=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const defaultFilters=()=>({start:today().slice(0,7)+'-01',end:today(),cutoff:today(),granularity:'day',basis:'frequency',report:'stock',group:'',idle:'30'});
let filters={...defaultFilters(),...localRead('dg-filters',{})};
let mode='',health=null,route='dashboard',page=0,viewData=null,activePlan=null,requestId=0,stopSync=()=>{},timer=null,focusDetail=null;
let accountEpoch=0, recovery=false;
const query=(name,args)=>mode==='demo'?Promise.resolve(demoQuery(name,args)):api.rpc(name,args);
const allowed=()=>health?.profile?.role==='admin'||health?.profile?.role==='gestor';
const version=()=>health?.version||'0';
const currentRoute=()=>{const id=location.hash.slice(1);return titles[id]&&(id!=='admin'||allowed())?id:'dashboard';};
const field=(text,key,type='text',attributes='')=>'<label>'+text+'<input name="'+key+'" type="'+type+'" value="'+escape(filters[key])+'" '+attributes+'></label>';
const categories=[['MATÉRIA-PRIMA','Matéria-prima'],['PRODUTO ACABADO','Produto acabado'],['EMBALAGEM','Embalagem']];
const categoryFilter=()=>'<fieldset class="multi"><legend>Categoria</legend>'+categories.map(([value,label])=>'<label><input type="checkbox" name="categories" value="'+escape(value)+'" '+((filters.categories||[]).includes(value)?'checked':'')+'>'+label+'</label>').join('')+'</fieldset>';
const options=(text,key,values)=>'<label>'+text+'<select name="'+key+'">'+values.map(([v,label])=>'<option value="'+escape(v)+'"'+(String(filters[key]??'')===String(v)?' selected':'')+'>'+escape(label)+'</option>').join('')+'</select></label>';
function status(){
 if(mode==='demo')return 'Demonstração · dados fictícios';
 if(!health?.last_successful_sync)return 'Aguardando primeira sincronização';
 if(health.latest_state==='failed')return 'Última tentativa falhou';
 if(health.latest_state==='receiving')return 'Aguardando atualização';
 if(Number(health.differences)>0)return 'Conciliação com divergências';
 return Number(health.age_minutes)>15?'Sincronização com defasagem':'Base atualizada';
}
function paintLogin(message=''){
 root.innerHTML='<main class="login"><section class="login-brand"><img src="./brand/logo-transparente.png" alt="Dallgree"><h1 class="title">Gestão de Estoques</h1><p>Posição, movimentações e análise gerencial.</p></section>'+
 '<section class="login-form"><img src="./brand/simbolo.png" alt=""><h2>'+(recovery?'Defina uma nova senha':'Acesse sua conta')+'</h2>'+
 '<form id="login">'+(recovery?'':'<label>E-mail<input name="email" required type="email" autocomplete="username"></label>')+
 '<label>'+(recovery?'Nova senha':'Senha')+'<input name="password" type="password" required '+(recovery?'minlength="8" autocomplete="new-password"':'autocomplete="current-password"')+'></label>'+
 '<p id="login-error" class="error" role="alert">'+escape(message)+'</p><button class="primary">'+(recovery?'Salvar senha':'Entrar')+'</button></form>'+
 (recovery?'':'<div class="actions"><button id="recover">Recuperar senha</button><button id="demo">Abrir demonstração</button></div>'+
 (!api.configured()?'<p class="muted">O ambiente de homologação ainda precisa da chave publicável para acessar o Supabase.</p>':''))+'</section></main>';
 root.querySelector('#login').onsubmit=async event=>{
  event.preventDefault();const b=event.target.querySelector('button');b.disabled=true;
  const data=new FormData(event.target);
  try{
   if(recovery){await api.passwordUpdate(data.get('password'));await api.logout();recovery=false;paintLogin('Senha atualizada. Entre com a nova senha.');}
   else{await api.login(data.get('email'),data.get('password'));await enter('live');}
  }catch(error){root.querySelector('#login-error').textContent=error.message;}finally{b.disabled=false;}
 };
 root.querySelector('#recover')?.addEventListener('click',async()=>{
  const input=root.querySelector('input[type=email]');
  if(!input.reportValidity())return;
  try{await api.recover(input.value);root.querySelector('#login-error').textContent='Se o endereço estiver cadastrado, você receberá um link de recuperação.';}
  catch(error){root.querySelector('#login-error').textContent=error.message;}
 });
 root.querySelector('#demo')?.addEventListener('click',()=>enter('demo'));
}
async function enter(next){
 const result=next==='demo'?demoQuery('get_sync_health'):await api.rpc('get_sync_health');
 mode=next;health=result;accountEpoch++;route=currentRoute();renderShell();await load();
 if(next==='live'){
  const update=()=>void refreshHealth();
  stopSync=api.subscribeSync(update);
  timer=setInterval(update,30000);
 }
}
async function refreshHealth(){
 const epoch=accountEpoch;
 try{
  const updated=await query('get_sync_health');
  if(epoch!==accountEpoch||mode!=='live')return;
  const changed=updated.version!==version()||updated.profile.role!==health.profile.role;
  health=updated;syncText();
  if(changed){if(route==='admin'&&!allowed()){location.hash='dashboard';return;}await load();}
 }catch(error){
  if(epoch!==accountEpoch)return;
  if(error.status===401||error.status===403)await exit('Sua sessão terminou ou o acesso foi desativado.');
  else if(root.querySelector('#sync-state'))root.querySelector('#sync-state').textContent='Sem conexão para verificar a sincronização';
 }
}
async function exit(message=''){
 accountEpoch++;requestId++;stopSync();clearInterval(timer);const previous=mode;mode='';health=null;
 if(previous==='live')try{await api.logout();}catch{}
 history.replaceState(null,'',location.pathname);paintLogin(message);
}
function syncText(){
 const el=root.querySelector('#sync-state');if(!el)return;
 el.textContent=status()+(health?.last_successful_sync&&mode==='live'?' · '+instant.format(new Date(health.last_successful_sync)):'');
}
function renderShell(){
 const links=Object.entries(titles).filter(([id])=>id!=='admin'||allowed());
 root.innerHTML='<div class="layout"><aside id="sidebar"><img class="brand" src="./brand/logo-transparente.png" alt="Dallgree">'+
 '<nav aria-label="Navegação">'+links.map(([id,label])=>'<a href="#'+id+'" '+(id===route?'aria-current="page"':'')+'>'+label+'</a>').join('')+'</nav></aside><main>'+
 '<header class="top"><button class="menu" aria-expanded="false" aria-controls="sidebar">Menu</button><span id="sync-state" class="badge" role="status"></span>'+
 '<div><span>'+escape(health.profile.display_name)+'</span> <button id="logout">Sair</button></div></header>'+
 '<div class="content"><p class="eyebrow">DALLGREE · ESTOQUE</p><h1 class="title">'+titles[route]+'</h1><p>'+subtitle[route]+'</p>'+
 '<div id="filter-area"></div><div id="result" aria-live="polite"></div><p class="foot">DALLGREE | Gestão de Estoques</p></div></main></div>';
 syncText();
 root.querySelector('.menu').onclick=e=>{const open=root.querySelector('#sidebar').classList.toggle('open');e.currentTarget.setAttribute('aria-expanded',String(open));};
 root.querySelector('#logout').onclick=()=>exit();
 renderFilters();
}
function effective(){
 return route==='reports'?filters.report||'stock':route;
}
function renderFilters(){
 const area=root.querySelector('#filter-area');
 if(route==='admin'){area.innerHTML='';return;}
 const type=effective(),point=['historical','stock','idle','negative','missing'].includes(type);
 area.innerHTML='<form class="card no-print" id="filters"><div class="filters">'+
 (route==='reports'?options('Relatório','report',reportOptions):'')+
 (type==='divergences'?'':field('Produto','product')+categoryFilter()+field('Unidade','unit')+field('Localização','location')+
 (point?(type==='historical'?field('Data de corte','cutoff','date','required'):'')+
  (['stock','historical'].includes(type)?options('Estado do saldo','status',[['','Todos'],['positive','Positivo'],['zero','Zerado'],['negative','Negativo'],['missing','Sem localização'],['minimum','Abaixo do mínimo']])+options('Ordenação','sort',[['','Produto'],['balance','Maior saldo']]):'')+
  (type==='idle'?options('Dias sem movimentar','idle',[['30','30 dias'],['60','60 dias'],['90','90 dias'],['180','180 dias']]):''):
  options('Período rápido','preset',[['','Personalizado'],['today','Hoje'],['7','Últimos 7 dias'],['30','Últimos 30 dias'],['month','Este mês'],['prev','Mês passado']])+
  field('Data inicial','start','date','required')+field('Data final','end','date','required'))+
 (type==='movements'?field('ID do movimento','id')+field('Operador','operator')+field('Motivo','reason')+field('Observação','notes')+
  options('Operação','operation',[['','Todas'],['ENTRADA','Entrada'],['SAIDA','Saída']])+options('Validação','validity',[['','Todos'],['valid','Válidos'],['invalid','Inconsistências'],['unknown','Sem cadastro']])+
  field('Quantidade mínima','min','number','min="0" step="any"')+field('Quantidade máxima','max','number','min="0" step="any"'):'')+
 (type==='flow'?options('Granularidade','granularity',[['day','Diária'],['week','Semanal'],['month','Mensal']])+options('Agrupar movimentos','group',[['','Por período'],['product','Produto'],['category','Categoria'],['operator','Operador'],['reason','Motivo']])+field('Comparar desde','compareStart','date')+field('Comparar até','compareEnd','date'):'')+
 (type==='abc'?options('Base da análise','basis',[['frequency','Frequência de movimentos'],['financial','Financeira · valor de consumo'],['quantity','Quantidade de saídas · mesma unidade']])+field('Limite acumulado A (%)','a','number','min="1" max="98"')+field('Limite acumulado B (%)','b','number','min="2" max="99"'):'') )+
 '</div><div class="actions"><button class="primary">Visualizar</button><button type="button" id="clear">Limpar filtros</button>'+
 (route==='reports'?'<button type="button" id="save-filter">Salvar filtros</button><button type="button" id="restore-filter">Carregar filtros salvos</button>':'')+
 '<button type="button" id="reload">Atualizar consultas</button></div></form>';
 const form=area.querySelector('form');
 function capture(){
  const data=new FormData(form);
  filters={...filters,...Object.fromEntries(data),...(form.querySelector('.multi')?{categories:data.getAll('categories')}:{})};
  if(filters.preset&&form.elements.preset){
   const last=today();
   if(filters.preset==='prev'){filters.end=shift(last.slice(0,7)+'-01',-1);filters.start=filters.end.slice(0,7)+'-01';}
   else{filters.end=last;filters.start=filters.preset==='month'?last.slice(0,7)+'-01':shift(last,1-(Number(filters.preset)||1));}
  }
  localStorage.setItem('dg-filters',JSON.stringify(filters));page=0;focusDetail=null;
 }
 form.onsubmit=e=>{e.preventDefault();capture();renderFilters();void load();};
 form.elements.report?.addEventListener('change',()=>{capture();renderFilters();void load();});
 form.elements.preset?.addEventListener('change',()=>{capture();renderFilters();});
 for(const name of ['start','end'])form.elements[name]?.addEventListener('change',()=>{if(form.elements.preset)form.elements.preset.value='';});
 area.querySelector('#clear').onclick=()=>{filters=defaultFilters();page=0;localStorage.removeItem('dg-filters');renderFilters();void load();};
 area.querySelector('#reload').onclick=async()=>{if(mode==='live')await refreshHealth();await load();};
 area.querySelector('#save-filter')?.addEventListener('click',()=>{capture();localStorage.setItem('dg-report',JSON.stringify(filters));void load();});
 area.querySelector('#restore-filter')?.addEventListener('click',()=>{filters={...defaultFilters(),...localRead('dg-report',{})};page=0;renderFilters();void load();});
}
function plan(){
 const type=effective(),common={product:filters.product,categories:filters.categories,unit:filters.unit,location:filters.location};
 const interval={p_start_date:filters.start,p_end_date:filters.end,p_filters:common};
 const stockFilter={...common,sort:filters.sort,status:['idle','negative','missing'].includes(type)?type:filters.status,idle:filters.idle};
 const end=type==='historical'?filters.cutoff:today();
 if(['stock','historical','idle','negative','missing'].includes(type)){
  return {name:'get_stock_as_of',args:{p_cutoff_date:end,p_filters:stockFilter},paged:true,
   columns:[...stock,...(type==='historical'?[['current_balance','Saldo atual']]:type==='idle'?[['days_idle','Dias parado']]:[])]};
 }
 if(type==='divergences')return {name:'get_inventory_reconciliation',args:{},columns:recon};
 if(type==='admin')return {name:'inventory_admin',args:{p_action:'overview'}};
 if(!filters.start||!filters.end||filters.start>filters.end)throw Error('Informe um período válido.');
 if(type==='kpis')return {name:'get_inventory_indicators',args:interval,paged:true,columns:indicatorColumns,kpis:true};
 if(type==='movements'){
  if(filters.min&&filters.max&&Number(filters.min)>Number(filters.max))throw Error('A quantidade mínima deve ser menor ou igual à máxima.');
  const values=Object.fromEntries(['id','operator','reason','notes','operation','validity','min','max'].map(k=>[k,filters[k]]));
  return {name:'get_inventory_movement_report',args:{...interval,p_filters:{...common,...values}},paged:true,columns:movement};
 }
 if(type==='flow'&&!filters.group)return {name:'get_stock_flow',args:{...interval,p_granularity:filters.granularity},columns:flow,compare:!!(filters.compareStart&&filters.compareEnd)};
 if(type==='abc'){
  if(filters.basis==='quantity'&&!filters.unit?.trim())throw Error('Informe uma unidade para comparar quantidades.');
  return {name:'get_abc_analysis',args:{...interval,p_basis:filters.basis,p_a_limit:Number(filters.a||80),p_b_limit:Number(filters.b||95)},columns:abc};
 }
 if(['flow','entries','exits','operator','reason','month'].includes(type)){
  const group=type==='flow'?filters.group:['operator','reason','month'].includes(type)?type:'product';
  return {name:'get_inventory_grouped',args:{...interval,p_group:group,p_filters:{...common,operation:type==='entries'?'ENTRADA':['exits','operator','reason'].includes(type)?'SAIDA':''}},columns:grouped};
 }
 return {name:'get_inventory_kpis',args:{...interval}};
}
function valueCell(key,value){
 if(value==null||value==='')return key==='location'?'Sem localização':'—';
 if(['day','business_date','last_movement','valid_from'].includes(key))return displayDate(value);
 if(['unit_cost','stock_value'].includes(key)||(key==='score'&&filters.basis==='financial'))return money.format(Number(value));
 if(typeof value==='number')return number.format(value);
 if(key==='operation'&&value==='SAIDA')return 'SAÍDA';
 return String(value);
}
function table(columns,rows,detail=false){
 if(!rows.length)return '<p class="notice">Nenhum registro para este recorte.</p>';
 return '<div class="table-wrap"><table><thead><tr>'+columns.map(([,name])=>'<th scope="col">'+escape(name)+'</th>').join('')+
 (detail?'<th class="no-print">Histórico</th>':'')+'</tr></thead><tbody>'+rows.map((r,i)=>'<tr>'+
 columns.map(([key])=>'<td class="'+(key==='balance'&&r[key]<0?'error num':'')+'">'+escape(valueCell(key,r[key]))+'</td>').join('')+
 (detail?'<td class="no-print"><button data-detail="'+i+'">Movimentos</button></td>':'')+'</tr>').join('')+'</tbody></table></div>';
}
function cards(data){
 const labels={sku:'Produtos',positive:'Saldo positivo',zero:'Saldo zero',negative:'Saldo negativo',below_minimum:'Abaixo do mínimo',no_location:'Sem localização',
  idle_30:'Parados 30 dias',idle_60:'Parados 60 dias',idle_90:'Parados 90 dias',idle_180:'Parados 180 dias',costed:'Produtos com custo'};
 return '<div class="cards">'+Object.entries(data.cards).map(([key,n])=>'<div class="card"><span>'+labels[key]+'</span><strong class="metric">'+number.format(n)+'</strong></div>').join('')+
 '<div class="card"><span>Movimentos no período</span><strong class="metric">'+number.format(data.movements)+'</strong></div>'+
 '<div class="card"><span>Inconsistências</span><strong class="metric">'+number.format(data.invalid)+'</strong></div></div>'+
 '<div class="split"><section class="card"><h2>Saldo por categoria e unidade</h2>'+table([['category','Categoria'],['unit','Unidade'],['balance','Saldo'],['sku','Produtos']],data.totals)+'</section>'+
 '<section class="card"><h2>Entradas e saídas por unidade</h2>'+table([['unit','Unidade'],['entries','Entradas'],['exits','Saídas']],data.units)+'</section></div>'+
 '<section class="card"><h2>Produtos com mais movimentações</h2>'+table([['product','Produto'],['unit','Unidade'],['movements','Registros']],data.top)+'</section>';
}
function adminView(data){
 if(mode==='demo')return '<p class="notice">Administração disponível após login no ambiente configurado.</p>';
 const admin=health.profile.role==='admin';
 return (admin?'<section class="card"><h2>Perfis ativos e inativos</h2>'+table([['user_id','UUID'],['display_name','Nome'],['role','Perfil'],['active','Ativo']],data.users||[])+
 '<form data-admin="profile" class="filters"><label>UUID no Supabase Auth<input name="user_id" required></label><label>Nome<input name="display_name" required maxlength="120"></label>'+
 '<label>Perfil<select name="role"><option>leitor</option><option>gestor</option><option>admin</option></select></label><label>Situação<select name="active"><option value="true">Ativo</option><option value="false">Inativo</option></select></label><button class="primary">Salvar perfil</button></form></section>'+
 '<section class="card"><h2>Histórico de sincronizações</h2>'+table([['id','Execução'],['state','Estado'],['started_at','Início UTC'],['finished_at','Fim UTC'],['received','Linhas'],['differences','Divergências'],['error','Diagnóstico']],(data.runs||[]).map(run=>({...run,...run.summary})))+'</section>':'')+
 '<section class="card"><h2>Parâmetros de reposição</h2><form class="filters" data-admin="policy"><label>Chave do produto<input required name="key"></label>'+
 ['minimum_qty','maximum_qty','reorder_qty'].map((k,i)=>'<label>'+['Mínimo','Máximo','Ponto de reposição'][i]+'<input type="number" name="'+k+'" min="0" step="0.000001"></label>').join('')+
 '<button class="primary">Salvar política</button></form></section>'+
 '<section class="card"><h2>Custo histórico em reais</h2><form class="filters" data-admin="cost"><label>Chave do produto<input required name="key"></label>'+
 '<label>Vigência desde<input required type="date" name="valid_from"></label><label>Custo unitário (R$)<input required type="number" name="unit_cost" min="0" step="0.000001"></label><button class="primary">Salvar custo</button></form></section>';
}
function printHeader(data,job){
 const args=job.args;
 const dates=args.p_cutoff_date?'Corte '+displayDate(args.p_cutoff_date):args.p_start_date?displayDate(args.p_start_date)+' a '+displayDate(args.p_end_date):'';
 let active=Object.entries(args.p_filters||{}).filter(([,v])=>v!==''&&v!=null&&(!Array.isArray(v)||v.length)).map(([k,v])=>k+': '+v).join(' · ');
 return '<header class="print-header"><img src="./brand/logo-transparente.png" alt="Dallgree"><h1>'+escape(route==='reports'?reportOptions.find(([id])=>id===effective())?.[1]:titles[route])+
 '</h1><p>'+escape([dates,active].filter(Boolean).join(' · '))+'</p><p>'+escape(health.profile.display_name)+' · Gerado em '+instant.format(new Date())+' · São Paulo</p>'+
 '<p>'+data.total+' linhas · Versão '+escape(data.version)+' · Base sincronizada do Google Planilhas</p></header>';
}
function plot(canvas,rows,kind){
 const context=canvas.getContext('2d'),scale=devicePixelRatio||1;
 const w=canvas.clientWidth||700,h=canvas.clientHeight||260;
 canvas.width=w*scale;canvas.height=h*scale;context.scale(scale,scale);
 const data=rows.slice(0,kind==='abc'?18:40);
 if(!data.length)return;
 const x=44,y=20,pw=w-60,ph=h-56,step=pw/data.length;
 const keys=kind==='abc'?['score']:['entries','exits','closing'];
 const values=data.flatMap(row=>keys.map(k=>Number(row[k])||0));
 const lo=Math.min(0,...values),hi=Math.max(1,...values),pos=n=>y+ph*(hi-n)/(hi-lo);
 context.font='11px system-ui';context.fillStyle='#526761';
 for(let i=0;i<=4;i++){
  const val=lo+(hi-lo)*i/4,py=pos(val);context.fillText(number.format(val),2,py+3);
  context.strokeStyle='#dde8e1';context.beginPath();context.moveTo(x,py);context.lineTo(x+pw,py);context.stroke();
 }
 data.forEach((row,i)=>{
  const base=x+i*step+step*.17;
  for(const [j,k] of keys.slice(0,kind==='abc'?1:2).entries()){
   const py=pos(Number(row[k])||0);context.fillStyle=j?'#e9ad59':'#258563';context.fillRect(base+j*step*.27,Math.min(py,pos(0)),Math.max(1,step*.23),Math.abs(pos(0)-py));
  }
  if(i%Math.max(1,Math.ceil(data.length/8))===0){context.fillStyle='#526761';context.fillText(kind==='abc'?String(i+1):displayDate(row.day).slice(0,5),base,h-8);}
 });
 context.strokeStyle='#354e8b';context.lineWidth=2;context.beginPath();
 data.forEach((row,i)=>{const py=kind==='abc'?y+ph*(1-Number(row.accumulated)/100):pos(Number(row.closing));i?context.lineTo(x+(i+.5)*step,py):context.moveTo(x+(i+.5)*step,py);});context.stroke();
}
function renderResult(data,job,comparison,indicators){
 const el=root.querySelector('#result');
 if(activePlan.name==='inventory_admin'){el.innerHTML=adminView(data);for(const form of el.querySelectorAll('[data-admin]'))form.onsubmit=async e=>{
  e.preventDefault();const args=Object.fromEntries(new FormData(form));for(const k of Object.keys(args))if(args[k]==='')args[k]=null;
  const b=form.querySelector('button');b.disabled=true;
  try{await query('inventory_admin',{p_action:form.dataset.admin,p_data:args});await load();}
  catch(error){const output=document.createElement('p');output.className='error';output.textContent=error.message;form.append(output);}finally{b.disabled=false;}
 };return;}
 if(!job.columns){el.innerHTML=cards(data);return;}
 const type=effective(),stockView=job.name==='get_stock_as_of';
 const notes=type==='abc'&&filters.basis==='financial'?'<p class="notice">Cobertura de custo: '+data.coverage.with_cost+' de '+data.coverage.events+' saídas. As saídas sem custo ficam fora da ABC financeira.</p>':
 type==='historical'?'<p class="notice">Histórico recalculado · Corte em '+displayDate(job.args.p_cutoff_date)+' às 23:59:59 · São Paulo.</p>':
 type==='divergences'?'<p class="notice">'+(data.reconciled_at?'Última conciliação completa: '+instant.format(new Date(data.reconciled_at)):'Aguardando a primeira conciliação completa.')+'</p>':'';
 const units=[...new Set(data.rows.map(r=>r.unit))];
 const chart=(type==='flow'&&job.name==='get_stock_flow'||type==='abc')&&data.rows.length?
  '<section class="card"><h2>'+(type==='abc'?'Pareto de consumo':'Evolução de saldo')+'</h2><p class="legend">'+
  (type==='abc'?'Barras: volume no ranking · Linha: percentual acumulado · até 18 produtos':'Barras: entradas e saídas · Linha: saldo final · até 40 períodos por unidade')+'</p>'+
  (type==='abc'?'<canvas role="img" aria-label="Ranking ABC e percentual acumulado"></canvas>':units.map(u=>'<h3>'+escape(u||'Unidade')+'</h3><canvas role="img" aria-label="Evolução por unidade"></canvas>').join(''))+'</section>':'';
 el.innerHTML=(indicators?cards(indicators)+'<p class="notice">Cobertura e giro são exibidos quando houve saídas em pelo menos dois dias. O giro usa a média dos saldos inicial e final positivos.</p>':'')+notes+chart+(comparison?'<section class="card"><h2>Período de comparação</h2>'+table(job.columns,comparison.rows)+'</section>':'')+
 '<section class="card"><div id="print-view">'+printHeader(data,job)+'<h2>Resultado</h2><p class="muted">'+number.format(data.total)+' registros</p>'+
 table(job.columns,data.rows,stockView)+(data.totals?'<h3>Totais por categoria e unidade</h3>'+table([['category','Categoria'],['unit','Unidade'],['entries','Entradas'],['exits','Saídas'],['balance','Saldo']],data.totals):'')+'</div>'+
 '<div class="actions no-print"><button data-export="pdf">Imprimir / Salvar PDF</button><button data-export="csv">Exportar CSV</button><button data-export="xlsx">Exportar Excel</button>'+
 (job.paged?'<button data-page="-1" '+(!page?'disabled':'')+'>Anterior</button><button data-page="1" '+((page+1)*50>=data.total?'disabled':'')+'>Próxima</button><span>Página '+(page+1)+' de '+Math.max(1,Math.ceil(data.total/50))+'</span>':'')+
 '</div><p class="error no-print" id="export-error" role="alert"></p></section><div id="detail"></div>';
 [...el.querySelectorAll('canvas')].forEach((canvas,i)=>plot(canvas,type==='abc'?data.rows:data.rows.filter(r=>r.unit===units[i]),type));
 for(const button of el.querySelectorAll('[data-page]'))button.onclick=()=>{page+=Number(button.dataset.page);focusDetail=null;void load();};
 for(const button of el.querySelectorAll('[data-export]'))button.onclick=()=>exportResult(button,data,job);
 for(const button of el.querySelectorAll('[data-detail]'))button.onclick=()=>showDetail(data.rows[Number(button.dataset.detail)]);
}
async function showDetail(row){
 const el=root.querySelector('#detail');if(!el)return;focusDetail=row.key;
 el.textContent='Consultando movimentos…';
 try{
  const args={p_start_date:'1900-01-01',p_end_date:today(),p_filters:{product:row.product,product_key:row.key},p_limit:50,p_offset:0};
  const data=await query('get_inventory_movement_report',args);
  if(!el.isConnected||focusDetail!==row.key)return;
  el.innerHTML='<section class="card"><h2>'+escape(row.product)+'</h2><p>Últimos '+data.rows.length+' de '+data.total+' movimentos</p>'+table(movement,data.rows)+'</section>';
 }catch(error){if(el.isConnected)el.textContent=error.message;}
}
async function exportResult(button,data,job){
 button.disabled=true;const message=root.querySelector('#export-error');
 message.textContent='';
 try{
  const rows=job.paged?await collect(offset=>query(job.name,{...job.args,p_limit:500,p_offset:offset}),data):data.rows;
  const filename='dallgree-'+effective()+'-'+today();
  if(button.dataset.export==='csv')download(filename+'.csv',new Blob([csv(job.columns,rows)],{type:'text/csv;charset=utf-8'}));
  else if(button.dataset.export==='xlsx')download(filename+'.xlsx',xlsx(job.columns,rows));
  else{
   const preview=root.querySelector('#print-view');if(!preview)throw Error('A consulta mudou. Gere o PDF novamente.');
   const original=preview.innerHTML;
   const charts=[...root.querySelectorAll('#result canvas')].map(canvas=>'<img class="print-chart" src="'+canvas.toDataURL('image/png')+'" alt="'+escape(canvas.getAttribute('aria-label'))+'">').join('');
   preview.innerHTML=printHeader(data,job)+charts+table(job.columns,rows)+(data.totals?'<h3>Totais por categoria e unidade</h3>'+table([['category','Categoria'],['unit','Unidade'],['balance','Saldo']],data.totals):'')+
    '<p>DALLGREE | Gestão de Estoques</p>';
   document.body.classList.add('print-report');
   try{await Promise.all([...preview.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));window.print();}finally{document.body.classList.remove('print-report');preview.innerHTML=original;if(job.name==='get_stock_as_of')for(const b of preview.querySelectorAll('[data-detail]'))b.onclick=()=>showDetail(data.rows[Number(b.dataset.detail)]);}
  }
 }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
}
async function load(){
 const id=++requestId,el=root.querySelector('#result');if(!el||!mode)return;
 el.innerHTML='<p class="card" role="status">Consultando estoque…</p>';
 try{
  const job=plan();
  const response=await query(job.name,{...job.args,...(job.paged?{p_limit:50,p_offset:page*50}:{})});
  let comparison=null,indicators=null;
  if(job.kpis){
   indicators=await query('get_inventory_kpis',job.args);
   if(indicators.version!==response.version)throw Error('A base mudou durante a consulta. Atualize a página.');
  }
  if(job.compare){
   if(filters.compareStart>filters.compareEnd)throw Error('Informe datas válidas para o período de comparação.');
   comparison=await query(job.name,{...job.args,p_start_date:filters.compareStart,p_end_date:filters.compareEnd});
   if(comparison.version!==response.version)throw Error('A base mudou durante a comparação. Atualize a consulta.');
  }
  if(id!==requestId)return;
  viewData=response;activePlan=job;renderResult(viewData,job,comparison,indicators);
 }catch(error){if(id!==requestId)return;el.innerHTML='<p class="card error" role="alert">'+escape(error.message)+'</p>';}
}
window.addEventListener('hashchange',()=>{if(!mode)return;route=currentRoute();page=0;focusDetail=null;renderShell();void load();});
recovery=api.recoverySession();
if(recovery)paintLogin();
else if(api.saved()&&api.configured())enter('live').catch(error=>exit(error.message));
else paintLogin();
