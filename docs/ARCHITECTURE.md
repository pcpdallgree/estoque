# Arquitetura e dados

```text
AppSheet → Planilha → Apps Script operacional existente (inalterado)
                 └→ coletor Dallgree → HTTPS/HMAC → Edge Function
                    → lotes privados → commit íntegro → PostgreSQL
                    → RPC protegida → navegador
                                    └→ aviso Realtime sem dados operacionais
```

| Entidade | Fonte e integridade |
| --- | --- |
| dstock.products | CADASTRO, chave pelo nome normalizado. Conflitos de identidade bloqueiam a carga. Renomes sem chave estável exigem conciliação operacional. |
| dstock.operators | OPERADOR, chave textual normalizada. |
| dstock.movements | MOVIMENTAÇÃO, chave original ID e identificador interno UUID. Correções atualizam o mesmo ID. Ausência só produz tombstone em reconciliação integral. |
| dstock.runs / batches | Manifesto com quantidades e SHA-256 por índice. Captura mais antiga nunca substitui uma versão concluída mais recente. |
| dstock.reconciliation | Comparação por produto, categoria e unidade entre ledger e guias de posição na última carga integral. |
| dstock.audit | Versões anteriores de movimentos e produtos, mudanças administrativas e de parâmetros. |
| dstock.costs / policies | Custo BRL com início de vigência e políticas opcionais. A próxima vigência encerra a anterior. |
| dstock.profiles | Vínculo Auth protegido. Leitor consulta. Gestor consulta e mantém parâmetros gerenciais. Administrador também gerencia os perfis vinculados ao Auth e acompanha as execuções. |
| public.dallgree_sync_notice | Apenas identificador de versão e instante. SELECT sujeito a RLS. |

As tabelas operacionais estão em esquema privado com RLS e sem privilégios para o navegador. Os RPCs públicos fixam o caminho de busca, consultam o perfil ativo e expõem apenas o resultado necessário. A ingestão aceita somente service_role, que fica na Edge Function. O Apps Script usa HMAC-SHA256 e janela de cinco minutos. Um pedido repetido dentro da janela só reusa a execução e o lote existentes.

Uma versão combina o último commit da réplica e a revisão de auditoria dos parâmetros. Uma exportação que cruza versões falha com instrução de recarregar. O navegador refaz a consulta ao receber uma notificação e verifica a versão a cada 30 segundos como fallback de conexão. Nenhum canal WebSocket é fonte de saldo.

Dados inválidos permanecem no relatório de movimentos. Apenas entradas/saídas com produto conhecido, data válida, quantidade positiva e unidade compatível compõem o saldo. A conciliação exibe diferenças de unidade, cadastro e quantidade. Ausência de localização e saldo negativo são sinais operacionais, sem alteração dos dados de origem. Custos e saldos são calculados em PostgreSQL; a interface formata para pt-BR.
