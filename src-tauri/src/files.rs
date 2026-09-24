// Leitura/gravação de arquivos de texto escolhidos pelo usuário via
// `@tauri-apps/plugin-dialog` — usado pela importação/exportação de sócios
// em CSV (`src/services/memberCsv.ts`). Mesmo motivo de `documents.rs` e
// `photos.rs`: o frontend não tem `@tauri-apps/plugin-fs`, então cada
// operação de arquivo vira um comando Rust dedicado.

use std::fs;
use std::path::Path;

/// Acima disso o app recusa: um CSV de sócios com milhares de linhas fica
/// bem abaixo desse teto — um arquivo maior quase certamente foi escolhido
/// por engano, e o conteúdo inteiro atravessa o IPC como string.
const TAMANHO_MAXIMO_TEXTO: u64 = 20 * 1024 * 1024;

/// Lê um arquivo de texto (UTF-8). Se não for UTF-8 válido, cai para
/// Latin-1/Windows-1252 — CSV salvo pelo Excel no Windows sem a opção
/// "CSV UTF-8" chega assim, e sem esse fallback os acentos viravam lixo.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let caminho = Path::new(&path);
    let metadata = fs::metadata(caminho).map_err(|e| format!("não foi possível ler o arquivo escolhido: {e}"))?;
    if metadata.len() > TAMANHO_MAXIMO_TEXTO {
        return Err("Arquivo muito grande — escolha um arquivo de até 20 MB.".to_string());
    }

    let bytes = fs::read(caminho).map_err(|e| format!("não foi possível ler o arquivo escolhido: {e}"))?;
    match String::from_utf8(bytes) {
        Ok(texto) => Ok(texto.trim_start_matches('\u{feff}').to_string()),
        Err(erro) => Ok(erro.into_bytes().iter().map(|&b| b as char).collect()),
    }
}

/// Grava `contents` em `path` (sobrescreve se já existir — o diálogo de
/// "Salvar como" do sistema já confirma a sobrescrita com o usuário).
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("não foi possível salvar o arquivo: {e}"))
}
