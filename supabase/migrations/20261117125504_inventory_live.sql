begin;
create table dstock.reconciliation(
 run_id uuid references dstock.runs, product_key text, category text not null, unit text not null,
 sheet_balance numeric, ledger_balance numeric, reason text not null, primary key(run_id,product_key,category)
);
alter table dstock.reconciliation enable row level security;
revoke all on dstock.reconciliation from public,anon,authenticated;

create function dstock.reconcile(run uuid,data jsonb) returns int language plpgsql set search_path='' as $$
declare differences int;
begin
 with sheet as (
  select j->>'item_key' key,j->>'category' category,j->>'unit' unit,
   case when left(j->>'balance',1)='-' then -dstock.qty(substr(j->>'balance',2)) else dstock.qty(j->>'balance') end amount
  from jsonb_array_elements(data) j where j->>'kind'='balance'
 ), ledger as (
  select p.source_key key,dstock.norm(p.category) category,p.unit,
   coalesce(sum(case when m.operation='ENTRADA' then m.qty else -m.qty end),0) amount
  from dstock.products p left join dstock.ledger m on m.item_key=p.source_key and m.issue is null
  where p.active group by 1,2,3
 )
 insert into dstock.reconciliation(run_id,product_key,category,unit,sheet_balance,ledger_balance,reason)
 select run,coalesce(s.key,l.key),coalesce(s.category,l.category),coalesce(s.unit,l.unit,''),s.amount,l.amount,
  case when s.key is null then 'Sem posição na guia de saldo' when l.key is null then 'Sem cadastro correspondente'
  when s.amount is null then 'Saldo da planilha inválido' when dstock.norm(s.unit)<>dstock.norm(l.unit) then 'Unidade divergente'
  else 'Saldo divergente' end
 from sheet s full join ledger l on l.key=s.key and replace(l.category,'-',' ')=replace(s.category,'-',' ')
 where s.key is null or l.key is null or s.amount is distinct from l.amount or dstock.norm(s.unit)<>dstock.norm(l.unit);
 get diagnostics differences=row_count;
 return differences;
end $$;

create function public.get_inventory_grouped(p_start_date date,p_end_date date,p_filters jsonb,p_group text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform dstock.profile();
 if p_group not in ('product','operator','reason','category','month') then raise exception 'Agrupamento inválido.';end if;
 with grouped as (
  select coalesce(case p_group when 'product' then product when 'operator' then operator_name
   when 'reason' then reason when 'category' then category when 'month' then to_char(business_date,'YYYY-MM') end,'') name,
  unit,count(*) movements,coalesce(sum(qty) filter(where operation='ENTRADA'),0) entries,coalesce(sum(qty) filter(where operation='SAIDA'),0) exits
  from dstock.period(p_start_date,p_end_date,p_filters) where issue is null group by 1,2
 )
 select dstock.page(jsonb_agg(to_jsonb(g) order by g.name,g.unit),count(*)) into result from grouped g;
 return result;
end $$;
create function public.get_inventory_reconciliation() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform dstock.profile();
 with latest as (select id,finished_at from dstock.runs where state='completed' and full_run order by captured_at desc limit 1),
 details as (select r.product_key,r.category,r.unit,r.sheet_balance,r.ledger_balance,r.reason from dstock.reconciliation r join latest l on l.id=r.run_id)
 select dstock.page(jsonb_agg(to_jsonb(d) order by product_key,category),count(*))||jsonb_build_object('reconciled_at',(select finished_at from latest))
 into result from details d;
 return result;
end $$;
revoke all on function public.get_inventory_grouped(date,date,jsonb,text),public.get_inventory_reconciliation() from public,anon,authenticated;
grant execute on function public.get_inventory_grouped(date,date,jsonb,text),public.get_inventory_reconciliation() to authenticated;

create table public.dallgree_sync_notice (
 id int primary key check(id=1), version uuid not null, completed_at timestamptz not null
);
alter table public.dallgree_sync_notice enable row level security;
revoke all on public.dallgree_sync_notice from public,anon,authenticated;
grant select on public.dallgree_sync_notice to authenticated;
create function public.dallgree_can_read() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from dstock.profiles where user_id=auth.uid() and active)
$$;
revoke all on function public.dallgree_can_read() from public,anon,authenticated;
grant execute on function public.dallgree_can_read() to authenticated;
create policy sync_notice_read on public.dallgree_sync_notice for select to authenticated using ((select public.dallgree_can_read()));
create function dstock.signal_sync() returns trigger language plpgsql set search_path='' as $$
begin
 if new.state='completed' and old.state is distinct from new.state then
  insert into public.dallgree_sync_notice values(1,new.id,new.finished_at)
   on conflict(id) do update set version=excluded.version,completed_at=excluded.completed_at;
 end if;
 return new;
end $$;
create trigger signal_reset after update on dstock.runs for each row execute function dstock.signal_sync();
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.dallgree_sync_notice;
 end if;
end $$;

create function public.get_inventory_indicators(p_start_date date,p_end_date date,p_filters jsonb,p_limit int default 50,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform dstock.profile();
 if p_start_date is null or p_end_date is null or p_end_date-p_start_date not between 0 and 3660
 then raise exception 'Use um período válido de até dez anos.'; end if;
 with eligible as materialized (select * from dstock.stock(p_end_date,p_filters)),
 activity as (
  select m.item_key,
   coalesce(sum(case when operation='ENTRADA' then qty else -qty end) filter(where business_date<p_start_date),0) opening,
   coalesce(sum(qty) filter(where operation='SAIDA' and business_date>=p_start_date),0) consumption,
   count(distinct business_date) filter(where operation='SAIDA' and business_date>=p_start_date) consumption_days,
   count(*) filter(where business_date>=p_start_date and dstock.norm(reason) like '%ajuste%') adjustments
  from dstock.ledger m join eligible t on t.key=m.item_key
  where m.issue is null and business_date<=p_end_date group by m.item_key
 ), indicators as (
  select t.key,t.product,t.category,t.unit,t.location,t.balance,t.minimum_qty,t.maximum_qty,t.reorder_qty,t.days_idle,
   coalesce(a.consumption,0) consumption,coalesce(a.adjustments,0) adjustments,
   case when a.consumption_days>=2 and t.balance>=0 then t.balance*(p_end_date-p_start_date+1)/nullif(a.consumption,0) end coverage_days,
   case when a.consumption_days>=2 and t.balance>0 and a.opening>0 then a.consumption/((t.balance+a.opening)/2) end turnover
  from eligible t left join activity a on a.item_key=t.key
 ), rows as (
  select * from indicators order by product,key limit greatest(1,least(500,p_limit)) offset greatest(0,p_offset)
 )
 select dstock.page((select jsonb_agg(to_jsonb(r)) from rows r),(select count(*) from indicators)) into result;
 return result;
end $$;
revoke all on function public.get_inventory_indicators(date,date,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.get_inventory_indicators(date,date,jsonb,integer,integer) to authenticated;

commit;
