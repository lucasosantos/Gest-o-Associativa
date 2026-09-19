/**
 * Ponto único de geração de identificador para os registros de domínio.
 *
 * Não há ORM nem geração automática de PK pelo SQLite (ver
 * `.claude/rules/database.md`), então cada `model` gera o próprio `id`
 * antes do `INSERT`. Usa `crypto.randomUUID()`, nativo do webview do Tauri
 * (WebView2/WebKit), sem depender de um pacote `uuid` externo.
 */
export function newId(): string {
  return crypto.randomUUID();
}
