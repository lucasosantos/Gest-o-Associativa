# Banco de dados — `src-tauri/src/lib.rs` (migrations) e `src/models/**` (acesso)

- Migrations SQLite ficam todas em `migrations` dentro de
  [lib.rs](../../src-tauri/src/lib.rs), registradas via `tauri-plugin-sql`.
  **São append-only**: nunca edite uma `Migration` já existente — toda mudança de
  schema é uma nova entrada com `version` incrementado. Hoje a lista está vazia
  (base neutra, sem tabelas de domínio); a primeira migration de um novo
  módulo começa em `version: 1`.
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
