# Roteiro de homologação

## Verificações reproduzíveis

- `node --test` valida assinatura, idade e conteúdo de lotes, retomada da fila, datas civis, formatos de exportação e proteção contra fórmula e mudança de versão.
- `node scripts/check.mjs` verifica sintaxe JavaScript, Apps Script e TypeScript da Edge Function. Use `deno check supabase/functions/ingest-estoque/index.ts` em ambiente com Deno para verificação estática de tipos.
- `node scripts/build.mjs` gera a aplicação estática. Teste a abertura de `/estoque/#movements` em servidor local.
- Aplique as migrações em um banco descartável. Execute `supabase/tests/inventory.sql` e `supabase/tests/volume.sql` com `psql -v ON_ERROR_STOP=1 -f arquivo.sql`. Os testes inserem dados fictícios em uma transação revertida. Use somente ambiente isolado.

## Aceite operacional

1. Carga inicial da cópia, conferência de contagens e reconciliação por item nas três guias de posição. Separe erros de identidade, ausência de cadastro, localização vazia e unidade incompatível.
2. Crie uma entrada fictícia no AppSheet de homologação. Confira a propagação com polling. Altere localização, quantidade, data e observação, conferindo o mesmo ID e o histórico recalculado. Exclua um lançamento fictício e verifique que somente a carga integral aplica tombstone.
3. Interrompa uma carga no meio e confirme que o painel mantém a versão anterior. Reative o coletor e confira a retomada. Desconecte Realtime e aguarde a verificação periódica com filtros mantidos.
4. Confirme login, recuperação de senha, permissões leitor/gestor/admin, desativação e bloqueio de DML por API. Confira custo vigente, custo ausente, unidades e classificação ABC.
5. Exporte o mesmo recorte em PDF, CSV e XLSX e compare número de linhas, valores e período. Inspecione marca, rodapé, margens e quebra de páginas em desktop, tablet e celular. Verifique a rota profunda e o Pages apenas após a publicação homologada.

A entrega local não prova a latência real do AppSheet, a entrega de e-mails do Auth nem o comportamento da conta Google. Esses resultados pertencem ao aceite da cópia de homologação.
