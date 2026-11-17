begin;
create schema dstock;
revoke all on schema dstock from public,anon,authenticated;
create table dstock.profiles (
 user_id uuid primary key references auth.users(id), display_name text not null,
 role text not null check(role in ('admin','gestor','leitor')), active boolean not null default true,
 created_at timestamptz not null default now()
);
create table dstock.runs (
 id uuid primary key, full_run boolean not null, captured_at timestamptz not null,
 manifest jsonb not null, started_at timestamptz not null default now(), finished_at timestamptz,
 state text not null default 'receiving' check(state in ('receiving','completed','failed')),
 summary jsonb not null default '{}'
);
create table dstock.sync_presence (id int primary key check(id=1), seen_at timestamptz not null);
create table dstock.batches (
 run_id uuid references dstock.runs(id), idx int, hash text not null, rows jsonb not null,
 received_at timestamptz not null default now(), primary key(run_id,idx)
);
create table dstock.products (
 id uuid not null unique default gen_random_uuid(), source_key text primary key, name text not null,
 category text not null, unit text not null, location text not null, raw jsonb not null,
 active boolean not null default true
);
create table dstock.operators (source_key text primary key, name text not null, active boolean not null default true);
create table dstock.movements (
 id uuid not null unique default gen_random_uuid(), source_id text primary key, item_key text not null,
 item text not null, business_date date, occurred_at timestamptz, qty numeric(20,6),
 operation text, source_unit text, source_category text, operator_name text, reason text, notes text,
 raw jsonb not null, deleted_at timestamptz
);
create table dstock.costs (
 product_key text references dstock.products, valid_from date, unit_cost numeric(20,6) not null check(unit_cost>=0),
 primary key(product_key,valid_from)
);
create table dstock.policies (
 product_key text primary key references dstock.products, minimum_qty numeric(20,6) check(minimum_qty>=0),
 maximum_qty numeric(20,6) check(maximum_qty>=minimum_qty), reorder_qty numeric(20,6) check(reorder_qty>=0)
);
create table dstock.audit (
 id bigint generated always as identity primary key, at timestamptz default now(), actor uuid,
 entity text not null, entity_key text not null, previous jsonb, current_value jsonb
);
create index movements_item_date on dstock.movements(item_key,business_date) where deleted_at is null;
create index movements_date_id on dstock.movements(business_date,source_id) where deleted_at is null;
create index runs_completed on dstock.runs(captured_at desc) where state='completed';
do $$ declare t text; begin
 foreach t in array array['profiles','runs','sync_presence','batches','products','operators','movements','costs','policies','audit'] loop
  execute format('alter table dstock.%I enable row level security',t);
 end loop;
end $$;
revoke all on all tables in schema dstock from public,anon,authenticated;

create function dstock.profile(p_roles text[] default null) returns jsonb language plpgsql stable
 set search_path='' as $$
declare result jsonb;
begin
 select to_jsonb(p) into result from dstock.profiles p
 where p.user_id=auth.uid() and p.active and (p_roles is null or p.role=any(p_roles));
 if result is null then raise exception 'Perfil ativo necessário.' using errcode='42501';end if;
 return result;
end $$;
create function dstock.norm(p text) returns text language sql immutable set search_path='' as $$
 select lower(translate(regexp_replace(btrim(coalesce(p,'')),'[[:space:]]+',' ','g'),
 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
$$;
create function dstock.qty(p text) returns numeric language sql immutable set search_path='' as $$
 select case when p ~ '^[0-9]{1,14}(\.[0-9]{1,6})?$' then p::numeric end
$$;
create function dstock.day(p text) returns date language plpgsql immutable set search_path='' as $$
begin
 if p ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return p::date;end if;
 return null;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end $$;
create function dstock.instant(p text) returns timestamptz language plpgsql stable set search_path='' as $$
begin
 if p ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then return p::timestamptz;end if;
 return null;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end $$;

create function dstock.audit_change() returns trigger language plpgsql set search_path='' as $$
begin
 if to_jsonb(old) is distinct from to_jsonb(new) then
  insert into dstock.audit(actor,entity,entity_key,previous,current_value)
  values(auth.uid(),tg_table_name,coalesce(to_jsonb(new)->>'source_id',to_jsonb(new)->>'source_key'),to_jsonb(old),to_jsonb(new));
 end if;
 return new;
end $$;
create trigger movement_revision after update on dstock.movements for each row execute function dstock.audit_change();
create trigger product_revision after update on dstock.products for each row execute function dstock.audit_change();

create function public.ingest_estoque(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r dstock.runs; run uuid:=(p->>'run_id')::uuid; idx int; data jsonb; bad int; differences int; captured timestamptz;
begin
 if p->>'action'='health' then return jsonb_build_object('ready',true);end if;
 if p->>'action'='heartbeat' then
  insert into dstock.sync_presence values(1,clock_timestamp()) on conflict(id) do update set seen_at=excluded.seen_at;
  return jsonb_build_object('ready',true);
 end if;
 perform pg_advisory_xact_lock(342996,1);
 if p->>'action'='start' then
  captured:=(p->>'captured_at')::timestamptz;
  if captured is null or captured>clock_timestamp()+interval '5 minutes' or
     jsonb_typeof(p->'manifest') is distinct from 'array' or jsonb_array_length(p->'manifest') not between 1 and 1000
  then raise exception 'Manifesto inválido.';end if;
  insert into dstock.runs(id,full_run,captured_at,manifest)
  values(run,(p->>'full')::boolean,captured,p->'manifest') on conflict(id) do nothing;
  select * into r from dstock.runs where id=run;
  if r.manifest is distinct from p->'manifest' or r.full_run is distinct from (p->>'full')::boolean
   or r.captured_at is distinct from captured then raise exception 'Identificador da execução já utilizado.';end if;
  return jsonb_build_object('state',r.state,'summary',r.summary);
 end if;
 select * into strict r from dstock.runs where id=run;
 if r.state<>'receiving' then return jsonb_build_object('state',r.state,'summary',r.summary);end if;
 if p->>'action'='batch' then
  idx:=(p->>'index')::int;
  if idx is null or idx<0 or idx>=jsonb_array_length(r.manifest) or (r.manifest->idx->>'hash') is distinct from p->>'hash'
   or jsonb_typeof(p->'rows') is distinct from 'array' or jsonb_array_length(p->'rows')>400
   or jsonb_array_length(p->'rows') is distinct from (r.manifest->idx->>'count')::int
  then raise exception 'Lote incompatível com o manifesto.';end if;
  insert into dstock.batches(run_id,idx,hash,rows) values(run,idx,p->>'hash',p->'rows') on conflict do nothing;
  return jsonb_build_object('state','received','index',idx);
 end if;
 if p->>'action' is distinct from 'finish' then raise exception 'Ação inválida.';end if;
 if (select count(*) from dstock.batches b where b.run_id=run)<>jsonb_array_length(r.manifest) then
  return jsonb_build_object('state','receiving');end if;
 if exists(select 1 from dstock.runs x where x.state='completed' and x.captured_at>=r.captured_at) then
  update dstock.runs set state='failed',finished_at=now(),summary='{"error":"snapshot_desatualizado"}' where id=run;
  return jsonb_build_object('state','failed','summary','snapshot_desatualizado');
 end if;
 select coalesce(jsonb_agg(e.value),'[]') into data from dstock.batches b cross join lateral jsonb_array_elements(b.rows) e
 where b.run_id=run;
 select count(*) into bad from (
  select j->>'kind',j->>'key' from jsonb_array_elements(data) j group by 1,2
  having count(*)>1 or coalesce(j->>'key','')='' or length(j->>'key')>300
  or coalesce(j->>'kind','') not in ('product','movement','operator','balance')
 ) invalid;
 if bad>0 or (not r.full_run and not exists(select 1 from dstock.runs where state='completed' and full_run))
  or (r.full_run and not exists(select 1 from jsonb_array_elements(data) j where j->>'kind'='product')) then
  update dstock.runs set state='failed',finished_at=now(),summary=jsonb_build_object('error','identidades_ou_base_inconsistentes','invalid_keys',bad)
   where id=run;
  return jsonb_build_object('state','failed','invalid_keys',bad);
 end if;
 insert into dstock.products(source_key,name,category,unit,location,raw)
 select j->>'key',coalesce(j->>'name',''),coalesce(j->>'category',''),coalesce(j->>'unit',''),coalesce(j->>'location',''),j
 from jsonb_array_elements(data) j where j->>'kind'='product'
 on conflict(source_key) do update set name=excluded.name,category=excluded.category,unit=excluded.unit,
 location=excluded.location,raw=excluded.raw,active=true where dstock.products.raw is distinct from excluded.raw or not dstock.products.active;
 insert into dstock.operators(source_key,name)
 select j->>'key',coalesce(j->>'name','') from jsonb_array_elements(data) j where j->>'kind'='operator'
 on conflict(source_key) do update set name=excluded.name,active=true;
 insert into dstock.movements(source_id,item_key,item,business_date,occurred_at,qty,operation,source_unit,source_category,operator_name,reason,notes,raw)
 select j->>'key', dstock.norm(j->>'item'),coalesce(j->>'item',''),dstock.day(j->>'date'),dstock.instant(j->>'instant'),
  dstock.qty(j->>'qty'),upper(dstock.norm(j->>'operation')),j->>'unit',j->>'category',j->>'operator',j->>'reason',j->>'notes',j
 from jsonb_array_elements(data) j where j->>'kind'='movement'
 on conflict(source_id) do update set item_key=excluded.item_key,item=excluded.item,business_date=excluded.business_date,
 occurred_at=excluded.occurred_at,qty=excluded.qty,operation=excluded.operation,source_unit=excluded.source_unit,
 source_category=excluded.source_category,operator_name=excluded.operator_name,reason=excluded.reason,notes=excluded.notes,raw=excluded.raw,deleted_at=null
 where dstock.movements.raw is distinct from excluded.raw or dstock.movements.deleted_at is not null;
 if r.full_run then
  update dstock.movements m set deleted_at=now() where m.deleted_at is null and not exists(
   select 1 from jsonb_array_elements(data) j where j->>'kind'='movement' and j->>'key'=m.source_id);
  update dstock.products t set active=false where t.active and not exists(
   select 1 from jsonb_array_elements(data) j where j->>'kind'='product' and j->>'key'=t.source_key);
  update dstock.operators t set active=false where t.active and not exists(
   select 1 from jsonb_array_elements(data) j where j->>'kind'='operator' and j->>'key'=t.source_key);
 end if;
 if r.full_run then differences:=dstock.reconcile(run,data);end if;
 update dstock.runs set state='completed',finished_at=clock_timestamp(),summary=jsonb_build_object('received',jsonb_array_length(data),'differences',differences)
 where id=run returning * into r;
 insert into dstock.sync_presence values(1,clock_timestamp()) on conflict(id) do update set seen_at=excluded.seen_at;
 return jsonb_build_object('state',r.state,'version',run,'summary',r.summary);
end $$;
revoke all on function public.ingest_estoque(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_estoque(jsonb) to service_role;
commit;
