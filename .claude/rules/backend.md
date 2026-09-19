# Backend nativo — `src-tauri/src/**`

- Todo comando exposto ao frontend usa `#[tauri::command]` e precisa ser
  listado em `invoke_handler(tauri::generate_handler![...])` em
  [lib.rs](../../src-tauri/src/lib.rs) — comando sem isso não é chamável via `invoke()`.
- Erros retornados ao frontend usam `Result<T, String>` (veja
  [config.rs](../../src-tauri/src/config.rs) como referência), nunca `panic!`/`unwrap()`
  em código alcançável por um comando.
- Configuração persistida do app segue o padrão de `config.rs`: struct
  `serde::{Serialize, Deserialize}`, arquivo `config.json` ao lado do executável
  (`exe_dir()`), com `Default` sensato. Novas seções de config (ex.: dados da
  empresa, impressão) devem entrar como novo campo de `AppConfig`, espelhado
  manualmente na interface `AppConfig` de [src/services/config.ts](../../src/services/config.ts).
- Migrations SQL e regras de schema: ver [database.md](database.md).
