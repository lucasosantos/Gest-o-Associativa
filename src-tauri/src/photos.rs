// Foto de identificação do sócio (`people.photo`, migration `version: 17`):
// o app não tem `@tauri-apps/plugin-fs` no frontend (decisão já registrada
// em `documents.rs`), então ler o arquivo de imagem escolhido pelo usuário
// (via `@tauri-apps/plugin-dialog`) e devolver como data URL em base64 é
// outro comando Rust dedicado, seguindo o mesmo padrão. Diferente de
// `documents.rs`, aqui não há cópia pro disco nem `document_versions`: a
// foto é só uma pessoa, sem versionamento, e vira uma string guardada
// direto na coluna — por isso o comando devolve o data URL pronto, sem
// nenhuma escrita em arquivo.

use crate::documents::guess_mime_type;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs;
use std::path::Path;

/// Acima disso o app recusa: uma foto de identificação não precisa ser
/// grande, e o valor vai inteiro (como texto base64) pra uma coluna do
/// SQLite — sem esse limite, uma escolha errada do usuário (ex.: uma foto
/// de câmera em alta resolução) infla o `.db` sem necessidade.
const TAMANHO_MAXIMO_BYTES: u64 = 5 * 1024 * 1024;

/// Lê `source_path` e devolve como data URL (`data:<mime>;base64,...`), já
/// pronta pra guardar em `people.photo` e exibir num `<img :src>` sem
/// nenhuma outra conversão do lado do frontend.
#[tauri::command]
pub fn read_image_as_data_url(source_path: String) -> Result<String, String> {
    let path = Path::new(&source_path);

    let metadata = fs::metadata(path).map_err(|e| format!("não foi possível ler o arquivo escolhido: {e}"))?;
    if metadata.len() > TAMANHO_MAXIMO_BYTES {
        return Err("Imagem muito grande — escolha um arquivo de até 5 MB.".to_string());
    }

    let mime_type = guess_mime_type(path);
    if !mime_type.starts_with("image/") {
        return Err("Escolha um arquivo de imagem (PNG, JPG ou GIF).".to_string());
    }

    let bytes = fs::read(path).map_err(|e| format!("não foi possível ler o arquivo escolhido: {e}"))?;
    Ok(format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)))
}
