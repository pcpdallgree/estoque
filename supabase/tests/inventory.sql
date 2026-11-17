-- Execute exclusively against a disposable database after migrations.
begin;
insert into auth.users(id,email) values
 ('db000000-0000-4000-8000-000000000001','admin@example.invalid'),
 ('db000000-0000-4000-8000-000000000002','leitor@example.invalid'),
 ('db000000-0000-4000-8000-000000000003','inactive@example.invalid');
insert into dstock.profiles(user_id,display_name,role,active) values
 ('db000000-0000-4000-8000-000000000001','Admin','admin',true),
 ('db000000-0000-4000-8000-000000000002','Leitor','leitor',true),
 ('db000000-0000-4000-8000-000000000003','Inativo','leitor',false);

set local role service_role;
do $$
declare run uuid:='db000000-0000-4000-8000-000000000010'; result jsonb; payload jsonb:='[
 {"kind":"product","key":"sulfato","name":"Sulfato","category":"MATÉRIA-PRIMA","unit":"kg","location":"A1"},
 {"kind":"movement","key":"L1","item":"Sulfato","unit":"kg","date":"2025-12-31","instant":"2026-01-01T02:00:00Z","qty":"10","operation":"ENTRADA"},
 {"kind":"movement","key":"L2","item":"Sulfato","unit":"kg","date":"2026-01-02","qty":"3","operation":"SAÍDA"},
 {"kind":"movement","key":"L3","item":"Desconhecido","unit":"kg","date":"2026-01-02","qty":"8","operation":"SAÍDA"},
 {"kind":"balance","key":"materia-prima:sulfato","category":"materia-prima","item_key":"sulfato","unit":"kg","balance":"7"}
 ]';
begin
 perform public.ingest_estoque(jsonb_build_object('action','start','run_id',run,'full',true,'captured_at','2026-01-05T00:00:00Z',
  'manifest','[{"hash":"h","count":5},{"hash":"i","count":0}]'::jsonb));
 perform public.ingest_estoque(jsonb_build_object('action','batch','run_id',run,'index',0,'hash','h','rows',payload));
 perform public.ingest_estoque(jsonb_build_object('action','batch','run_id',run,'index',0,'hash','h','rows',payload));
 result:=public.ingest_estoque(jsonb_build_object('action','finish','run_id',run));
 if result->>'state' is distinct from 'receiving' then raise exception 'Ingestão incompleta foi publicada';end if;
 perform public.ingest_estoque(jsonb_build_object('action','batch','run_id',run,'index',1,'hash','i','rows','[]'::jsonb));
 result:=public.ingest_estoque(jsonb_build_object('action','finish','run_id',run));
 if result->>'state' is distinct from 'completed' or result->'summary'->>'differences' is distinct from '0' then raise exception 'Carga ou conciliação falhou: %',result;end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','db000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
declare result jsonb;
begin
 result:=public.get_stock_as_of('2026-01-01','{}',50,0);
 if result->'rows'->0->>'balance' is distinct from '10.000000' then raise exception 'Carry-forward incorreto: %',result;end if;
 result:=public.get_stock_flow('2026-01-01','2026-01-03','{}','day');
 if (result->'rows'->0->>'opening')::numeric<>10 or (result->'rows'->2->>'closing')::numeric<>7 then raise exception 'Evolução incorreta: %',result;end if;
 result:=public.get_abc_analysis('2026-01-01','2026-01-03','financial');
 if result->>'total'<>'0' or result->'coverage'->>'with_cost'<>'0' then raise exception 'Custo inventado';end if;
 result:=public.get_inventory_movement_report('2026-01-01','2026-01-03','{"validity":"invalid"}');
 if result->>'total'<>'1' then raise exception 'Inconsistência invisível';end if;
 result:=public.get_inventory_kpis('2026-01-01','2026-01-03','{"categories":["Matéria Prima"]}');
 if result->'cards'->>'sku' is distinct from '1' or result->'cards'->>'costed' is distinct from '0'
 then raise exception 'Indicadores ou filtro por categorias incorretos: %',result;end if;
 result:=public.get_inventory_grouped('2026-01-01','2026-01-03','{}','product');
 if (result->'rows'->0->>'exits')::numeric is distinct from 3 then raise exception 'Agrupamento incorreto: %',result;end if;
 result:=public.get_inventory_indicators('2026-01-01','2026-01-03','{}');
 if result->>'total' is distinct from '1' or result->'rows'->0->>'coverage_days' is not null
 then raise exception 'Cobertura exibida para consumo insuficiente: %',result;end if;
 if public.get_inventory_reconciliation()->>'total' is distinct from '0' then raise exception 'Divergência inexistente';end if;
 begin perform public.inventory_admin('profile','{}');raise exception 'Leitor conseguiu administrar';
 exception when insufficient_privilege then null;end;
 begin update dstock.movements set qty=100;raise exception 'Leitor conseguiu editar ledger';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','db000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.inventory_admin('cost','{"key":"sulfato","valid_from":"2026-01-01","unit_cost":"5"}');
do $$ declare result jsonb;
begin
 result:=public.get_abc_analysis('2026-01-01','2026-01-03','financial');
 if (result->'rows'->0->>'score')::numeric<>15 or result->'rows'->0->>'class'<>'A' then raise exception 'ABC financeira incorreta: %',result;end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','db000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
 begin perform public.get_sync_health();raise exception 'Perfil inativo leu o estoque';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.get_sync_health()','EXECUTE') or has_function_privilege('authenticated','public.ingest_estoque(jsonb)','EXECUTE')
 then raise exception 'Acesso público indevido';end if;
end $$;

set local role service_role;
do $$
declare run uuid:='db000000-0000-4000-8000-000000000011'; result jsonb; payload jsonb:='[
 {"kind":"product","key":"sulfato","name":"Sulfato","category":"MATÉRIA-PRIMA","unit":"kg","location":"A1"},
 {"kind":"movement","key":"L1","item":"Sulfato","unit":"kg","date":"2025-12-30","qty":"15","operation":"ENTRADA"},
 {"kind":"balance","key":"materia-prima:sulfato","category":"materia-prima","item_key":"sulfato","unit":"kg","balance":"15"}
 ]';
begin
 perform public.ingest_estoque(jsonb_build_object('action','start','run_id',run,'full',true,'captured_at','2026-01-06T00:00:00Z',
  'manifest','[{"hash":"h","count":3}]'::jsonb));
 perform public.ingest_estoque(jsonb_build_object('action','batch','run_id',run,'index',0,'hash','h','rows',payload));
 result:=public.ingest_estoque(jsonb_build_object('action','finish','run_id',run));
 if result->>'state'<>'completed' then raise exception 'FULL após correção falhou';end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from dstock.movements where deleted_at is null)<>1
  or (select qty from dstock.movements where source_id='L1')<>15
  or (select count(*) from dstock.audit where entity='movements')<>3 then raise exception 'Tombstone ou auditoria incorreta';end if;
end $$;
rollback;
