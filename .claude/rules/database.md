# Banco de dados — `src-tauri/src/lib.rs` (migrations) e `src/models/**` (acesso)

- Migrations SQLite ficam todas em `migrations` dentro de
  [lib.rs](../../src-tauri/src/lib.rs), registradas via `tauri-plugin-sql`.
  **São append-only**: nunca edite uma `Migration` já existente — toda mudança de
  schema é uma nova entrada com `version` incrementado (hoje a última é
  `version: 24`). Só declare `REFERENCES` para tabela que já existe — o
  `sqlx` liga `PRAGMA foreign_keys = ON` e não dá pra desligar dentro da
  transação da migration (ver `docs/plano-implementacao.md`).
- SQLite não aceita `DEFAULT CURRENT_TIMESTAMP` em `ALTER TABLE ... ADD COLUMN`.
  Para adicionar `created_at`/`updated_at` a uma tabela já existente: coluna sem
  default → `UPDATE` de backfill → um trigger `AFTER INSERT` e um `AFTER UPDATE`
  por tabela. Tabela **nova** pode usar `DEFAULT CURRENT_TIMESTAMP` direto no
  `CREATE TABLE`, só precisando do trigger de `updated_at`.
- Placeholders de query são posicionais (`$1`, `$2`, ...), conforme a API do
  `tauri-plugin-sql` usada em `db.select()`/`db.execute()`.
- Não há ORM nem geração automática de tipos: cada model em `src/models/*.ts`
  espelha manualmente as colunas da tabela. Ao criar ou alterar uma migration,
  atualize também a interface do model correspondente.
- Toda escrita feita por um model (criar, alterar, excluir, baixar...) deve
  passar por `comAtividade(acao, descrever)` de
  [ActivityLog.ts](../../src/models/ActivityLog.ts), pra entrar no histórico
  de atividades (tela Atividades). Só a chamada mais externa registra — um
  método que chama outros models vira uma linha só. Descrição em português,
  legível pro usuário final, com o nome do registro (ex.: `Novo sócio — Lucas
  (matrícula 12)`). `activity_logs` é imutável (triggers bloqueiam
  UPDATE/DELETE).
