# Coletor Apps Script

Instale os quatro arquivos `.gs` em **um projeto Apps Script separado**, de preferência sob a conta institucional que já acessa a planilha. A separação evita compartilhar o lock com o script operacional. Preserve o projeto existente, seus menus, gatilhos, AppSheet e guias.

Em **Propriedades do script**, configure:

- `DG_SPREADSHEET_ID` — ID da cópia homologada e, depois do aceite, da planilha oficial.
- `DG_SYNC_URL` — URL HTTPS do endpoint `/functions/v1/ingest-estoque` do projeto escolhido.
- `DG_SYNC_SECRET` — HMAC de pelo menos 32 caracteres, equivalente ao segredo da Edge Function.
- `DG_CHECKPOINT_FILE` — ID de **arquivo de texto privado no Google Drive**, inicialmente vazio (`{}` não é necessário). O arquivo guarda hashes e a carga em andamento para recuperação; restrinja acesso, pois pode conter movimentações em trânsito.

As funções públicas podem ser executadas pelo editor Apps Script. Primeiro teste a conexão, depois rode a reconciliação completa e confira divergências no painel. Instale o polling e a reconciliação diária com **instalarSincronizacaoSupabase**. As quotas e o tempo de leitura devem ser verificados na conta real. Em caso de falha transitória, a próxima execução retoma o checkpoint. Confira **diagnosticarSincronizacao** sem copiar segredo nem dados de origem para logs.

O coletor faz duas leituras e compara hashes para identificar alterações durante a captura. A carga incremental compara pelo ID estável, sem depender da ordem ou de coluna de atualização. Uma execução completa é necessária para aplicar tombstones. IDs vazios ou duplicados interrompem o envio, com número da linha para diagnóstico local.

Em caso de aviso de execução rejeitada, examine o histórico no painel. Se a execução ficou definitivamente inválida, com os gatilhos parados, faça cópia privada do checkpoint e esvazie o arquivo para forçar uma carga integral. Não altere IDs existentes para contornar o diagnóstico.
