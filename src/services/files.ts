import { invoke } from "@tauri-apps/api/core";

/**
 * Lê um arquivo de texto escolhido pelo usuário (via `@tauri-apps/plugin-dialog`).
 * Aceita UTF-8 e, como fallback, Latin-1 (CSV salvo pelo Excel sem a opção
 * "UTF-8"). Ver `src-tauri/src/files.rs`.
 */
export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

/** Grava `contents` em `path`, sobrescrevendo se já existir. */
export function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke<void>("write_text_file", { path, contents });
}
