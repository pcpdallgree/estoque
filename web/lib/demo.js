const localDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
const products=[
 ['sulfato','Sulfato de magnésio','MATÉRIA-PRIMA','kg','A-01',168,85,45],
 ['concentrado','Concentrado vegetal','MATÉRIA-PRIMA','L','A-02',350,124,90],
 ['bioverde','BioVerde 1 L','PRODUTO ACABADO','un','B-03',106,61,25],
 ['nutrifol','NutriFol 5 L','PRODUTO ACABADO','un','B-02',76,78,10],
 ['frasco','Frasco 1 L','EMBALAGEM','un','C-01',540,290,200],
 ['caixa','Caixa de embarque','EMBALAGEM','un','',120,120,20]
].map(([key,product,category,unit,location,entries,exits,minimum_qty])=>({key,product,category,unit,location,entries,exits,minimum_qty}));
const basis=(row,asOf)=>{
 const day=localDay(),entry=shift(day,-25),exit=shift(day,-2);
 const entries=asOf>=entry?row.entries:0,exits=asOf>=exit?row.exits:0;
 return {...row,entries,exits,balance:entries-exits,current_balance:row.entries-row.exits,last_movement:asOf>=exit?exit:asOf>=entry?entry:null,
  days_idle:asOf>=exit?Math.floor((Date.parse(asOf)-Date.parse(exit))/864e5):null,unit_cost:null,stock_value:null};
};
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const filter=(r,f)=>norm(r.product).includes(norm(f.product))&&(!f.categories?.length||f.categories.some(category=>norm(category)===norm(r.category)))&&(!f.unit||norm(r.unit)===norm(f.unit))&&norm(r.location).includes(norm(f.location));
const packet=(rows,limit=rows.length,offset=0)=>({rows:rows.slice(offset,offset+limit),total:rows.length,version:'DEMO'});
const groupBy=(rows,key)=>rows.reduce((groups,row)=>{const k=key(row);(groups[k]||=[]).push(row);return groups;},Object.create(null));
const sum=(rows,key)=>rows.reduce((s,r)=>s+Number(r[key]||0),0);
export function demoQuery(name,p={}){
 const f=p.p_filters||{},day=localDay();
 const selected=products.filter(r=>filter(r,f));
 const stock=selected.map(r=>basis(r,p.p_cutoff_date||p.p_end_date||day));
 const stockTotals=rows=>Object.values(groupBy(rows,r=>r.category+'|'+r.unit)).map(rows=>({category:rows[0].category,unit:rows[0].unit,
  sku:rows.length,entries:sum(rows,'entries'),exits:sum(rows,'exits'),balance:sum(rows,'balance')}));
 const all=selected.flatMap((r,i)=>['ENTRADA','SAIDA'].map((operation,n)=>({
  source_id:'DEMO-'+(i+1)+'-'+(n+1),business_date:shift(day,n?-2:-25),product:r.product,item:r.product,item_key:r.key,
  category:r.category,unit:r.unit,location:r.location,operation,qty:n?r.exits:r.entries,operator_name:n?'Equipe B':'Equipe A',
  notes:n?'Consumo de demonstração':'',reason:n?'Produção':'Recebimento',issue:null
 })));
 const start=p.p_start_date||'1900-01-01',end=p.p_end_date||day;
 const range=all.filter(v=>v.business_date>=start&&v.business_date<=end&&(!f.operation||v.operation===f.operation)&&(!f.id||v.source_id===f.id)
  &&(!f.product_key||v.item_key===f.product_key)&&(!f.validity||f.validity==='valid')&&norm(v.operator_name).includes(norm(f.operator))
  &&norm(v.reason).includes(norm(f.reason))&&norm(v.notes).includes(norm(f.notes))
  &&(!f.min||v.qty>=Number(f.min))&&(!f.max||v.qty<=Number(f.max)));
 const byUnit=rows=>Object.values(groupBy(rows,r=>r.unit)).map(v=>({unit:v[0].unit,movements:v.length,
  entries:sum(v.filter(x=>x.operation==='ENTRADA'),'qty'),exits:sum(v.filter(x=>x.operation==='SAIDA'),'qty')}));
 if(name==='get_sync_health')return {version:'DEMO',profile:{display_name:'Ambiente de demonstração',role:'leitor'}};
 if(name==='get_stock_as_of'){
  const rows=stock.filter(r=>({negative:r.balance<0,zero:r.balance===0,positive:r.balance>0,missing:!r.location,
   minimum:r.balance<r.minimum_qty,idle:r.days_idle!==null&&r.days_idle>=Number(f.idle||30)})[f.status]??true)
   .sort((a,b)=>(f.sort==='balance'?b.balance-a.balance:0)||a.product.localeCompare(b.product));
  return {...packet(rows,p.p_limit,p.p_offset),totals:stockTotals(rows)};
 }
 if(name==='get_inventory_movement_report')return packet(range.sort((a,b)=>b.business_date.localeCompare(a.business_date)||a.source_id.localeCompare(b.source_id)),p.p_limit,p.p_offset);
 if(name==='get_inventory_indicators')return packet(stock.map(row=>({...row,consumption:sum(range.filter(x=>x.item_key===row.key&&x.operation==='SAIDA'),'qty'),adjustments:0,coverage_days:null,turnover:null})),p.p_limit,p.p_offset);
 if(name==='get_inventory_reconciliation')return packet([]);
 if(name==='get_inventory_kpis'){
  const count=fn=>stock.filter(fn).length;
  return {version:'DEMO',cards:{sku:stock.length,positive:count(r=>r.balance>0),zero:count(r=>r.balance===0),negative:count(r=>r.balance<0),
   below_minimum:count(r=>r.balance<r.minimum_qty),no_location:count(r=>!r.location),idle_30:count(r=>r.days_idle>=30),
   idle_60:count(r=>r.days_idle>=60),idle_90:count(r=>r.days_idle>=90),idle_180:count(r=>r.days_idle>=180),costed:0},
   movements:range.length,invalid:0,totals:stockTotals(stock),units:byUnit(range),
   top:Object.values(groupBy(range,r=>r.product)).map(g=>({product:g[0].product,unit:g[0].unit,movements:g.length})).sort((a,b)=>b.movements-a.movements).slice(0,10)};
 }
 if(name==='get_stock_flow'){
  const bounds=p.p_granularity==='month'?d=>d.slice(0,7)+'-01':p.p_granularity==='week'?d=>shift(d,-((new Date(d+'T12:00Z').getUTCDay()+6)%7)):d=>d;
  const dates=new Set();for(let date=start;date<=end;date=shift(date,1)){dates.add(bounds(date));if(dates.size>3660)throw Error('Use um intervalo de até dez anos.');}
  const rows=[...new Set(all.map(v=>v.unit))].flatMap(unit=>{
   const prior=all.filter(v=>v.unit===unit&&v.business_date<start);
   let balance=prior.reduce((s,v)=>s+(v.operation==='ENTRADA'?v.qty:-v.qty),0);
   return [...dates].map(date=>{const group=range.filter(v=>v.unit===unit&&bounds(v.business_date)===date);
    const [{entries=0,exits=0}={}]=byUnit(group),opening=balance;balance+=entries-exits;
    return {day:date,unit,entries,exits,opening,closing:balance};});
  });return packet(rows);
 }
 if(name==='get_inventory_grouped'){
  const key=r=>p.p_group==='month'?r.business_date.slice(0,7):r[p.p_group==='operator'?'operator_name':p.p_group];
  return packet(Object.entries(groupBy(range,key)).flatMap(([name,rows])=>byUnit(rows).map(row=>({name,...row}))));
 }
 if(name==='get_abc_analysis'){
  const allowed=range.filter(r=>p.p_basis==='frequency'||r.operation==='SAIDA');
  if(p.p_basis==='financial')return {...packet([]),coverage:{events:allowed.length,with_cost:0}};
  const rows=Object.values(groupBy(allowed,r=>r.product)).map(g=>({product:g[0].product,unit:g[0].unit,score:p.p_basis==='frequency'?g.length:sum(g,'qty')})).sort((a,b)=>b.score-a.score||a.product.localeCompare(b.product));
  const total=sum(rows,'score');let accumulated=0;
  for(const row of rows){const share=100*row.score/total;row.class=accumulated<p.p_a_limit?'A':accumulated<p.p_b_limit?'B':'C';accumulated+=share;row.share=share;row.accumulated=accumulated;}
  return {...packet(rows),coverage:{events:allowed.length,with_cost:0}};
 }
 throw Error('Consulta indisponível na demonstração.');
}
