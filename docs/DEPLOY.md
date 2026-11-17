# Ativação, operação e rollback

1. Confirme que a planilha e o projeto Apps Script em execução correspondem aos artefatos de referência. Confira fuso America/Sao_Paulo, nomes das sete guias e chave ID no ledger. Preserve backups privados da planilha, script e banco.
2. Em projeto Supabase descartável, aplique as migrações em ordem. Verifique que apenas o schema público está exposto para este painel. Publique `ingest-estoque` com verificação JWT desabilitada no gateway e segredo HMAC exclusivo em `ESTOQUE_SYNC_SECRET`. A função rejeita chamadas sem assinatura válida e chama o banco com a credencial interna do Supabase.
3. Em Auth, crie ou convide os usuários da homologação e configure as URLs de redirecionamento autorizadas. O primeiro administrador é vinculado no SQL Editor por UUID já cadastrado em Auth. Exemplo parametrizado para preenchimento manual:

   ```sql
   insert into dstock.profiles(user_id,display_name,role)
   values ('UUID_DO_AUTH', 'Administrador de estoque', 'admin');
   ```

   Os demais perfis podem ser vinculados pelo painel. A criação da identidade e o convite ficam no Supabase Auth. Desativar o perfil bloqueia acesso a dados mesmo antes do vencimento do JWT.

4. Aponte o coletor para uma cópia representativa. Execute **testarConexaoSupabase** e depois **executarReconciliacaoCompleta**. Confira contagens, divergências e uma amostra por categoria. Compare os saldos com as três guias no mesmo checkpoint. Execute os cenários de homologação antes de pedir o aceite de produção.
5. Rotacione a senha PostgreSQL mencionada na especificação pelo painel do Supabase. Confirme os consumidores existentes antes da rotação. Use segredos distintos para conexão, ingestão e login. Para rodar uma rotação gradual do HMAC, publique temporariamente o segredo anterior em `ESTOQUE_SYNC_SECRET_PREVIOUS`; depois que o coletor usar a nova chave, remova o anterior.
6. Somente após aceite explícito, aplique a mesma sequência no projeto oficial `hwcxylgzhvjfagovucwq`. No GitHub, escolha **GitHub Actions** em Pages, configure `VITE_SUPABASE_PUBLISHABLE_KEY` como variável pública do repositório e execute manualmente o workflow. Aceite a URL de redirecionamento `https://pcpdallgree.github.io/estoque/` em Auth. As rotas usam hash e os assets são relativos a essa subpasta.
7. No Apps Script, após a primeira conciliação aprovada, instale os gatilhos dedicados. Monitore atraso maior que 15 minutos, estado da última tentativa e divergências. O processo do AppSheet continua valendo como antes. Polling de cinco minutos é a estratégia de captura habilitável; nenhuma chamada de Bot deve ser ativada antes de validar o evento e o debounce na origem.

## Rollback

Desative apenas os gatilhos do coletor pela função **desativarSincronizacaoSupabase**. Bloqueie a ingestão removendo o segredo da Edge Function, caso necessário. Mantenha o AppSheet e os gatilhos operacionais originais. No GitHub, faça checkout do último commit homologado e execute novamente o workflow, ou pause Pages. Preserve as execuções, o ledger e a trilha de auditoria para investigação. Para restabelecer a réplica, retome o checkpoint ou faça nova carga integral após validar a cópia e explicar divergências. Nunca apague a origem nem rode um rollback destrutivo no banco operativo.
