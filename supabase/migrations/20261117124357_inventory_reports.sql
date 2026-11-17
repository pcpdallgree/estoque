begin;
create view dstock.ledger with (security_invoker=true) as
 select m.*,p.name as product,p.category,p.unit,p.location,
 case when p.source_key is null then 'Produto sem cadastro'
 when dstock.norm(p.category) not in ('materia-prima','materia prima','produto acabado','embalagem') then 'Categoria inválida'
 when dstock.norm(m.source_unit)<>dstock.norm(p.unit) or btrim(p.unit)='' then 'Unidade incompatível'
 when m.qty is null or m.qty<=0 then 'Quantidade inválida'
 when m.business_date is null then 'Data inválida'
 when m.operation not in ('ENTRADA','SAIDA') then 'Operação inválida' end as issue
 from dstock.movements m left join dstock.products p on p.source_key=m.item_key
 where m.deleted_at is null;

create function dstock.today() returns date language sql stable set search_path='' as $$
 select (now() at time zone 'America/Sao_Paulo')::date
$$;
create function dstock.version() returns text language sql stable set search_path='' as $$
 select coalesce((select id::text from dstock.runs where state='completed' order by captured_at desc limit 1),'0')
 ||':'||coalesce((select max(id)::text from dstock.audit),'0')
$$;
create function dstock.scope(f jsonb,n text,c text,u text,l text) returns boolean language sql immutable set search_path='' as $$
 select strpos(dstock.norm(n),dstock.norm(f->>'product'))>0
 and (nullif(f->>'category','') is null or replace(dstock.norm(c),'-',' ')=replace(dstock.norm(f->>'category'),'-',' '))
 and (case when jsonb_typeof(f->'categories')='array' then jsonb_array_length(f->'categories')=0 or exists(
  select 1 from jsonb_array_elements_text(f->'categories') t(category) where replace(dstock.norm(c),'-',' ')=replace(dstock.norm(t.category),'-',' ')) else true end)
 and (nullif(f->>'unit','') is null or dstock.norm(u)=dstock.norm(f->>'unit'))
 and strpos(dstock.norm(l),dstock.norm(f->>'location'))>0
$$;
create function dstock.page(rows jsonb,n bigint) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('rows',coalesce(rows,'[]'),'total',n,'version',dstock.version())
$$;
create function public.get_sync_health() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me jsonb:=dstock.profile(); s dstock.runs; latest dstock.runs;
begin
 select * into s from dstock.runs where state='completed' order by captured_at desc limit 1;
 select * into latest from dstock.runs order by started_at desc limit 1;
 return jsonb_build_object('version',dstock.version(),'profile',me,'last_successful_sync',s.finished_at,
  'differences',(select (summary->>'differences')::int from dstock.runs where state='completed' and full_run order by captured_at desc limit 1),
  'latest_state',latest.state,'age_minutes',extract(epoch from (now()-coalesce((select seen_at from dstock.sync_presence where id=1),s.finished_at)))/60,
  'latest',case when me->>'role'='admin' then latest.summary else null end);
end $$;
create function dstock.stock(p_cut date,f jsonb) returns table (
 key text,product text,category text,unit text,location text,entries numeric,exits numeric,balance numeric,
 current_balance numeric,last_movement date,unit_cost numeric,stock_value numeric,minimum_qty numeric,
 maximum_qty numeric,reorder_qty numeric,days_idle int
) language sql stable set search_path='' as $$
 with movements as (
  select item_key,
   coalesce(sum(qty) filter(where operation='ENTRADA' and business_date<=p_cut),0) entries,
   coalesce(sum(qty) filter(where operation='SAIDA' and business_date<=p_cut),0) exits,
   sum(case when operation='ENTRADA' then qty else -qty end) filter(where business_date<=dstock.today()) today,
   max(business_date) filter(where business_date<=p_cut) last_day
  from dstock.ledger where issue is null and business_date<=greatest(p_cut,dstock.today()) group by item_key
 ), stock as (
  select p.source_key,p.name,p.category,p.unit,p.location,coalesce(m.entries,0) entries,coalesce(m.exits,0) exits,
   coalesce(m.entries,0)-coalesce(m.exits,0) balance,coalesce(m.today,0) current_balance,m.last_day,
   c.unit_cost,(coalesce(m.entries,0)-coalesce(m.exits,0))*c.unit_cost as stock_value,
   s.minimum_qty,s.maximum_qty,s.reorder_qty,p_cut-m.last_day as days_idle
  from dstock.products p left join movements m on m.item_key=p.source_key
  left join dstock.policies s on s.product_key=p.source_key
  left join lateral (select k.unit_cost from dstock.costs k where k.product_key=p.source_key and k.valid_from<=p_cut order by k.valid_from desc limit 1) c on true
  where (p.active or m.last_day is not null) and dstock.scope(f,p.name,p.category,p.unit,p.location)
 )
 select * from stock s where case f->>'status' when 'negative' then s.balance<0 when 'zero' then s.balance=0
  when 'positive' then s.balance>0 when 'missing' then s.location=''
  when 'minimum' then s.balance<s.minimum_qty when 'idle' then s.days_idle>=coalesce(nullif(f->>'idle','')::int,30) else true end
$$;

create function public.get_stock_as_of(p_cutoff_date date,p_filters jsonb default '{}',p_limit int default 50,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform dstock.profile();
 if p_cutoff_date is null or not isfinite(p_cutoff_date) then raise exception 'Data inválida.';end if;
 with matches as materialized(select * from dstock.stock(p_cutoff_date,p_filters)),
 page as (select * from matches order by case when p_filters->>'sort'='balance' then balance end desc,product,key
  limit greatest(1,least(p_limit,500)) offset greatest(p_offset,0)),
 totals as (select category,unit,sum(entries) entries,sum(exits) exits,sum(balance) balance from matches group by category,unit)
 select dstock.page((select jsonb_agg(to_jsonb(p)) from page p),(select count(*) from matches))
 ||jsonb_build_object('totals',coalesce((select jsonb_agg(to_jsonb(t) order by category,unit) from totals t),'[]'))
 into result;
 return result;
end $$;

create function dstock.period(a date,b date,f jsonb) returns setof dstock.ledger language sql stable set search_path='' as $$
 select * from dstock.ledger m
 where ((m.business_date between a and b) or (m.business_date is null and f->>'validity'='invalid'))
 and dstock.scope(f,coalesce(m.product,m.item),coalesce(m.category,m.source_category),coalesce(m.unit,m.source_unit),m.location)
 and (nullif(f->>'operation','') is null or m.operation=f->>'operation')
 and strpos(dstock.norm(m.operator_name),dstock.norm(f->>'operator'))>0
 and strpos(dstock.norm(m.reason),dstock.norm(f->>'reason'))>0
 and strpos(dstock.norm(m.notes),dstock.norm(f->>'notes'))>0
 and (nullif(f->>'product_key','') is null or m.item_key=f->>'product_key')
 and (nullif(f->>'id','') is null or m.source_id=f->>'id')
 and (nullif(f->>'min','') is null or m.qty>=(f->>'min')::numeric)
 and (nullif(f->>'max','') is null or m.qty<=(f->>'max')::numeric)
 and (f->>'validity' is distinct from 'invalid' or m.issue is not null)
 and (f->>'validity' is distinct from 'valid' or m.issue is null)
 and (f->>'validity' is distinct from 'unknown' or m.product is null)
$$;
create function public.get_inventory_movement_report(p_start_date date,p_end_date date,p_filters jsonb default '{}',p_limit int default 50,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform dstock.profile();
 with matches as materialized (select source_id,business_date,occurred_at,item,coalesce(unit,source_unit) unit,
  coalesce(category,source_category) category,location,operation,qty,operator_name,reason,notes,issue
  from dstock.period(p_start_date,p_end_date,p_filters)),
 rows as(select * from matches order by business_date desc nulls last,occurred_at desc nulls last,source_id
  limit greatest(1,least(p_limit,500)) offset greatest(p_offset,0))
 select dstock.page((select jsonb_agg(to_jsonb(r)) from rows r),(select count(*) from matches)) into result;
 return result;
end $$;

create function public.get_stock_flow(p_start_date date,p_end_date date,p_filters jsonb default '{}',p_granularity text default 'day')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform dstock.profile();
 if p_granularity not in ('day','week','month') or p_end_date-p_start_date not between 0 and 3660 or
  p_start_date is null or p_end_date is null then raise exception 'Use um intervalo de até dez anos.';end if;
 with bucket as (
  select distinct date_trunc(p_granularity,g)::date as day from generate_series(p_start_date::timestamp,p_end_date::timestamp,interval '1 day') g
 ), movements as materialized (
  select business_date,m.unit,m.qty,m.operation from dstock.ledger m
  where issue is null and business_date<=p_end_date and dstock.scope(p_filters,m.product,m.category,m.unit,m.location)
 ), units as (select distinct unit from movements),
 opening as (select unit,sum(case when operation='ENTRADA' then qty else -qty end) balance
  from movements where business_date<p_start_date group by unit),
 by_period as (select date_trunc(p_granularity,business_date::timestamp)::date as day,unit,
  sum(qty) filter(where operation='ENTRADA') entries,sum(qty) filter(where operation='SAIDA') exits
  from movements where business_date>=p_start_date group by 1,2),
 dense as (select b.day,u.unit,coalesce(p.entries,0) entries,coalesce(p.exits,0) exits,coalesce(o.balance,0) base
  from bucket b cross join units u left join by_period p on p.day=b.day and p.unit=u.unit left join opening o on o.unit=u.unit),
 series as (select day,unit,entries,exits,
  base+coalesce(sum(entries-exits) over(partition by unit order by day rows between unbounded preceding and 1 preceding),0) opening,
  base+sum(entries-exits) over(partition by unit order by day) closing from dense)
 select dstock.page(jsonb_agg(to_jsonb(s) order by unit,day),count(*)) into result from series s;
 return result;
end $$;

create function public.get_abc_analysis(p_start_date date,p_end_date date,p_basis text,p_filters jsonb default '{}',p_a_limit numeric default 80,p_b_limit numeric default 95)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform dstock.profile();
 if p_basis not in ('financial','quantity','frequency') or p_a_limit<=0 or p_a_limit>=p_b_limit or p_b_limit>=100
  or (p_basis='quantity' and coalesce(p_filters->>'unit','')='') then raise exception 'Selecione uma unidade para ABC por quantidade e confira os limites.';end if;
 with source as materialized (
  select m.item_key,m.product,m.unit,m.qty,c.unit_cost
  from dstock.period(p_start_date,p_end_date,p_filters) m
  left join lateral (select k.unit_cost from dstock.costs k where k.product_key=m.item_key and k.valid_from<=m.business_date order by k.valid_from desc limit 1)c on true
  where m.issue is null and (p_basis='frequency' or m.operation='SAIDA')
 ), ranks as (
  select item_key,product,unit,
   case p_basis when 'financial' then sum(qty*unit_cost) when 'quantity' then sum(qty) else count(*) end score
  from source group by 1,2,3
 ), shares as (
  select *,100*score/nullif(sum(score) over(),0) share,
   100*sum(score) over(order by score desc,item_key rows unbounded preceding)/nullif(sum(score) over(),0) accumulated
  from ranks where score>0
 ), final as (
  select product,unit,score,share,accumulated,
   case when accumulated-share<p_a_limit then 'A' when accumulated-share<p_b_limit then 'B' else 'C' end class
  from shares
 )
 select dstock.page((select jsonb_agg(to_jsonb(t) order by score desc,product) from final t),(select count(*) from final))||
  jsonb_build_object('coverage',(select jsonb_build_object('events',count(*),'with_cost',count(unit_cost)) from source)) into result;
 return result;
end $$;

create function public.get_inventory_kpis(p_start_date date,p_end_date date,p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform dstock.profile();
 with stock as materialized (select * from dstock.stock(p_end_date,p_filters)),
 movement as materialized (select * from dstock.period(p_start_date,p_end_date,p_filters)),
 totals as (select category,unit,sum(balance) balance,count(*) sku from stock group by 1,2),
 units as (select coalesce(unit,source_unit) unit,count(*) movements,
  sum(qty) filter(where operation='ENTRADA') entries,sum(qty) filter(where operation='SAIDA') exits
  from movement where issue is null group by 1),
 top_items as (select product,unit,count(*) movements from movement where issue is null group by 1,2 order by 3 desc,1 limit 10)
 select jsonb_build_object('version',dstock.version(),'cards',(select jsonb_build_object(
  'sku',count(*),'positive',count(*) filter(where balance>0),'zero',count(*) filter(where balance=0),
  'negative',count(*) filter(where balance<0),'below_minimum',count(*) filter(where balance<minimum_qty),
  'no_location',count(*) filter(where location=''),'idle_30',count(*) filter(where days_idle>=30),
  'idle_60',count(*) filter(where days_idle>=60),'idle_90',count(*) filter(where days_idle>=90),
  'idle_180',count(*) filter(where days_idle>=180),'costed',count(unit_cost)) from stock),
  'movements',(select count(*) from movement),'invalid',(select count(*) from movement where issue is not null),
  'totals',coalesce((select jsonb_agg(to_jsonb(t) order by category,unit) from totals t),'[]'),
  'units',coalesce((select jsonb_agg(to_jsonb(t) order by unit) from units t),'[]'),
  'top',coalesce((select jsonb_agg(to_jsonb(t) order by movements desc,product) from top_items t),'[]')) into result;
 return result;
end $$;

create function public.inventory_admin(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare me jsonb:=dstock.profile(array['admin','gestor']); t uuid; r text; enabled boolean; k text:=p_data->>'key'; result jsonb;
begin
 if p_action='overview' then
  return jsonb_build_object('runs',case when me->>'role'='admin' then
   (select coalesce(jsonb_agg(to_jsonb(s) order by started_at desc),'[]') from
    (select id,state,captured_at,started_at,finished_at,full_run,summary from dstock.runs order by started_at desc limit 25)s) end,
   'users',case when me->>'role'='admin' then (select coalesce(jsonb_agg(to_jsonb(p) order by display_name),'[]') from dstock.profiles p) end);
 elsif p_action='profile' then
  perform dstock.profile(array['admin']);
  perform pg_advisory_xact_lock(342996,2);
  t:=(p_data->>'user_id')::uuid;r:=p_data->>'role';enabled:=(p_data->>'active')::boolean;
  if exists(select 1 from dstock.profiles where user_id=t and role='admin' and active)
   and (r<>'admin' or not enabled) and not exists(select 1 from dstock.profiles where role='admin' and active and user_id<>t)
  then raise exception 'Mantenha ao menos um administrador ativo.';end if;
  insert into dstock.profiles(user_id,display_name,role,active) values(t,btrim(p_data->>'display_name'),r,enabled)
   on conflict(user_id) do update set display_name=excluded.display_name,role=excluded.role,active=excluded.active;
 elsif p_action='cost' then
  insert into dstock.costs values(k,(p_data->>'valid_from')::date,(p_data->>'unit_cost')::numeric)
   on conflict(product_key,valid_from) do update set unit_cost=excluded.unit_cost;
 elsif p_action='policy' then
  insert into dstock.policies values(k,(p_data->>'minimum_qty')::numeric,(p_data->>'maximum_qty')::numeric,(p_data->>'reorder_qty')::numeric)
   on conflict(product_key) do update set minimum_qty=excluded.minimum_qty,maximum_qty=excluded.maximum_qty,reorder_qty=excluded.reorder_qty;
 else raise exception 'Ação desconhecida.';end if;
 insert into dstock.audit(actor,entity,entity_key,current_value) values(auth.uid(),p_action,coalesce(k,t::text),p_data);
 return jsonb_build_object('saved',true,'version',dstock.version());
end $$;

do $$ declare f text; begin
 foreach f in array array['get_sync_health()','get_stock_as_of(date,jsonb,integer,integer)',
 'get_inventory_movement_report(date,date,jsonb,integer,integer)','get_stock_flow(date,date,jsonb,text)',
 'get_abc_analysis(date,date,text,jsonb,numeric,numeric)','get_inventory_kpis(date,date,jsonb)','inventory_admin(text,jsonb)'] loop
  execute 'revoke all on function public.'||f||' from public,anon,authenticated';
  execute 'grant execute on function public.'||f||' to authenticated';
 end loop;
end $$;
commit;
