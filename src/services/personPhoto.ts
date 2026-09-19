import { invoke } from "@tauri-apps/api/core";

/**
 * Lê o arquivo de imagem escolhido pelo usuário (via
 * `@tauri-apps/plugin-dialog`) e devolve como data URL em base64 — pronta
 * pra guardar em `people.photo` (migration `version: 17`) e exibir direto
 * num `<img :src>`. Ver `src-tauri/src/photos.rs`.
 */
export function readImageAsDataUrl(sourcePath: string): Promise<string> {
  return invoke<string>("read_image_as_data_url", { sourcePath });
}
