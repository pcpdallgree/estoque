# Evidências da validação local

A cópia DALLGREE_ESTOQUE.xlsx foi aberta somente para leitura e processada por um adaptador local que forneceu as células ao mesmo normalizador do Apps Script. A carga usou um PostgreSQL descartável em memória, com o fluxo de manifesto, lote e finalização, sem chamadas à origem Google ou a um projeto Supabase hospedado.

| Recorte | Resultado |
|---|---:|
| Produtos no cadastro | 305 |
| Posições das três guias de saldo | 305 |
| Operadores | 6 |
| Movimentos importados | 3.046 |
| Movimentos válidos para o saldo | 2.941 |
| Movimentos com produto sem cadastro | 76 |
| Movimentos com quantidade inválida | 29 |
| Divergências de saldo ou unidade frente às guias do arquivo | 0 |

Os movimentos inconsistentes foram preservados no relatório e não afetaram saldos. Não são automaticamente corrigidos. A planilha, as linhas importadas e os segredos não são distribuídos neste repositório.

A massa sintética de 20 mil movimentos passou nas verificações de paginação e contagem. O plano de uma consulta por produto e data usou o índice parcial movements_item_date. Esses números medem o ambiente local, não a latência do projeto hospedado.

No navegador, a demonstração abriu em desktop, tablet e celular, exibiu a posição histórica e gráficos separados por unidade. O download de CSV foi confirmado. A exportação XLSX e a proteção de versão foram verificadas por testes automatizados. O roteiro de aceite ainda cobre a inspeção visual do PDF multipágina, o fluxo real do Auth e a execução do coletor na conta Google homologada.
