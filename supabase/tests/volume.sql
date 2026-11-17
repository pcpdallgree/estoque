-- Execute only in a disposable database. Synthetic 20k events.
begin;
insert into auth.users(id,email) values ('db000000-0000-4000-8000-000000000021','volume@example.invalid');
insert into dstock.profiles(user_id,display_name,role) values ('db000000-0000-4000-8000-000000000021','Volume','leitor');
insert into dstock.products(source_key,name,category,unit,location,raw)
 select 'produto '||i,'Produto '||i,'EMBALAGEM','un','A'||i,'{}' from generate_series(1,125) i;
insert into dstock.movements(source_id,item_key,item,business_date,qty,operation,source_unit,raw)
 select 'T'||n,'produto '||((n-1)%125+1),'Produto '||((n-1)%125+1),'2025-01-01'::date+(n%365),1,
 case when n%3=0 then 'SAIDA' else 'ENTRADA' end,'un','{}' from generate_series(1,20000) n;
analyze dstock.movements;
explain (analyze,buffers) select source_id from dstock.movements
 where item_key='produto 12' and business_date between '2025-01-01' and '2025-12-31' and deleted_at is null;
select set_config('request.jwt.claim.sub','db000000-0000-4000-8000-000000000021',true);
set local role authenticated;
do $$
declare a jsonb;b jsonb;c jsonb;
begin
 a:=public.get_inventory_movement_report('2025-01-01','2025-12-31','{}',500,0);
 b:=public.get_inventory_movement_report('2025-01-01','2025-12-31','{}',500,19500);
 c:=public.get_stock_as_of('2025-12-31','{}',50,0);
 if a->>'total'<>'20000' or b->>'total'<>'20000' or jsonb_array_length(a->'rows')<>500 or jsonb_array_length(b->'rows')<>500
  or c->>'total'<>'125' then raise exception 'Massa ou paginação incorreta';end if;
 if exists(select 1 from jsonb_array_elements(a->'rows') x join jsonb_array_elements(b->'rows') y on x->>'source_id'=y->>'source_id')
 then raise exception 'Páginas sobrepostas';end if;
end $$;
rollback;
