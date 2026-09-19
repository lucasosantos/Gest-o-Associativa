import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { getCurrentDbPath } from "./database.js";

/**
 * Espelha a struct `ImportedFile` do lado Rust
 * (`src-tauri/src/documents.rs`) — os nomes já são os mesmos das colunas de
 * `document_versions` (migration `version: 7`) que recebem esses valores.
 */
export interface ImportedFile {
  storage_key: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  checksum_sha256: string;
}

/**
 * Copia o arquivo escolhido pelo usuário (`@tauri-apps/plugin-dialog`) para
 * a pasta `docs` ao lado do `.db` da associação ativa, calculando tamanho,
 * tipo MIME e hash SHA-256. `versionNumber` sempre 1: documento não tem
 * fluxo de "nova versão" (ver `DocumentModel.criarVersao`).
 */
export function importDocumentFile(
  sourcePath: string,
  documentId: string,
  versionNumber: number
): Promise<ImportedFile> {
  return invoke<ImportedFile>("import_document_file", {
    dbPath: getCurrentDbPath(),
    sourcePath,
    documentId,
    versionNumber,
  });
}

/** Abre o arquivo do documento com o programa padrão do sistema operacional. */
export async function abrirArquivoDocumento(storageKey: string): Promise<void> {
  const caminho = await invoke<string>("get_document_file_path", { dbPath: getCurrentDbPath(), storageKey });
  await openPath(caminho);
}

/**
 * Lê o arquivo do documento e devolve como data URL (base64) — usado pelo
 * botão "Visualizar" da ficha do documento pra mostrar o arquivo dentro do
 * próprio app (imagem/PDF), sem abrir um programa externo. Ver limite de
 * tamanho em `src-tauri/src/documents.rs`.
 */
export function lerArquivoDocumentoComoDataUrl(storageKey: string): Promise<string> {
  return invoke<string>("read_document_file_as_data_url", { dbPath: getCurrentDbPath(), storageKey });
}
