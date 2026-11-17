# DALLGREE | Gestão de Estoques

Réplica gerencial de estoque para GitHub Pages, Supabase e Google Apps Script. O AppSheet e as planilhas continuam sendo a origem operacional. O painel consulta dados autenticados e mantém um modo de demonstração com dados fictícios para validação sem credenciais.

## Executar localmente

Requer Node.js 24. A aplicação web usa módulos JavaScript nativos, sem dependências externas em tempo de execução. A Edge Function usa TypeScript e Web Crypto.

```sh
node scripts/check.mjs
node --test
node scripts/build.mjs
node scripts/serve.mjs
```

Abra `http://127.0.0.1:4173/estoque/` e selecione **Abrir demonstração**. Para homologação autenticada, defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no ambiente antes do build. A chave deve ser publicável. O build sem chave ainda oferece a demonstração.

- [Ativação e rollback](docs/DEPLOY.md)
- [Arquitetura e dicionário](docs/ARCHITECTURE.md)
- [Homologação](docs/TEST_PLAN.md)
- [Configuração da sincronização](apps-script/README.md)

## Funcionalidades

Posição atual e histórica, filtros de movimentos, evolução por unidade, agrupamentos, comparação entre períodos, ABC financeira ou por quantidade/frequência, indicadores, divergências da última reconciliação, administração de perfis e parâmetros. CSV e Excel paginam todo o recorte e revalidam a versão a cada página. Use **Imprimir / Salvar PDF** para gerar PDF pelo navegador.

As políticas gerenciais e os custos são opcionais. A ABC financeira exclui saídas sem custo vigente e informa a cobertura. O saldo histórico é recalculado com a versão vigente da réplica e usa os atributos atuais do cadastro. Nenhum saldo inicial ou custo é presumido.
