// Etapa 7 do módulo de associações (ver docs/plano-implementacao.md):
// comandos nativos para copiar o arquivo escolhido pelo usuário (via
// `@tauri-apps/plugin-dialog`) para uma pasta gerenciada pelo app e calcular
// seus metadados (tamanho, tipo MIME, hash SHA-256).
//
// Decisão registrada no plano: em vez de adicionar `@tauri-apps/plugin-fs`
// ao frontend, o app ganha comandos Rust dedicados aqui, seguindo o mesmo
// padrão de `config.rs` (`Result<T, String>`, sem `unwrap`/`panic!`
// alcançável por comando). Isso evita uma dependência nova no frontend só
// para uma operação que o backend já pode fazer com a stdlib + `sha2`.
//
// O banco guarda só os metadados (`document_versions`); o arquivo em si vive
// fora do SQLite, numa subpasta "docs" ao lado do arquivo `.db` da
// associação. Desde a correção pós-MVP que voltou a "1 arquivo .db por
// associação" (ver docs/plano-implementacao.md), não existe mais um
// `config::load_or_init().database.path` único — cada associação tem o
// seu, e o frontend já sabe qual é (é o mesmo caminho usado para abrir a
// conexão SQL dela), por isso os comandos abaixo recebem `db_path` como
// parâmetro em vez de lerem um config global.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

fn documents_dir(db_path: &str) -> PathBuf {
    let parent = Path::new(db_path).parent().unwrap_or_else(|| Path::new("."));
    parent.join("docs")
}

// Sem `rename_all`: os nomes dos campos já são `snake_case` de propósito,
// espelhando 1:1 as colunas de `document_versions` (migration `version: 7`)
// que recebem esses valores direto — mesma convenção dos demais models de
// `src/models/*.ts`.
#[derive(Debug, Clone, Serialize)]
pub struct ImportedFile {
    pub storage_key: String,
    pub original_filename: String,
    pub mime_type: String,
    pub file_size: i64,
    pub checksum_sha256: String,
}

/// Copia `source_path` para `<pasta_de_documentos>/<document_id>/vN_nome`,
/// calculando tamanho e SHA-256 no mesmo passo (evita ler o arquivo duas
/// vezes). `version_number` vem do model de TypeScript, que já sabe quantas
/// versões o documento tem.
#[tauri::command]
pub fn import_document_file(
    db_path: String,
    source_path: String,
    document_id: String,
    version_number: i64,
) -> Result<ImportedFile, String> {
    let source = Path::new(&source_path);
    let bytes = fs::read(source).map_err(|e| format!("não foi possível ler o arquivo escolhido: {e}"))?;

    let original_filename = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "arquivo".to_string());

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let checksum_sha256 = format!("{:x}", hasher.finalize());

    let dir = documents_dir(&db_path).join(&document_id);
    fs::create_dir_all(&dir).map_err(|e| format!("não foi possível criar a pasta de documentos: {e}"))?;

    let dest = unique_dest(dir.join(format!("v{version_number}_{original_filename}")));
    fs::write(&dest, &bytes).map_err(|e| format!("não foi possível salvar o arquivo copiado: {e}"))?;

    let dest_name = dest
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| original_filename.clone());
    let storage_key = format!("{document_id}/{dest_name}");

    Ok(ImportedFile {
        storage_key,
        original_filename,
        mime_type: guess_mime_type(source),
        file_size: bytes.len() as i64,
        checksum_sha256,
    })
}

/// Evita sobrescrever um arquivo já existente com o mesmo nome (duas
/// versões enviadas com o mesmo nome original), acrescentando um sufixo.
fn unique_dest(mut path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|s| s.to_string_lossy().to_string());
    let mut contador = 1;
    loop {
        let nome_candidato = match &ext {
            Some(ext) => format!("{stem}-{contador}.{ext}"),
            None => format!("{stem}-{contador}"),
        };
        path.set_file_name(nome_candidato);
        if !path.exists() {
            return path;
        }
        contador += 1;
    }
}

/// `pub(crate)` porque `photos.rs` também precisa adivinhar o tipo MIME
/// (mesma lógica, sem duplicar) pra validar que o arquivo escolhido é uma
/// imagem.
pub(crate) fn guess_mime_type(path: &Path) -> String {
    let extensao = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match extensao.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Caminho absoluto de uma versão já importada, para abrir com
/// `@tauri-apps/plugin-opener` (`openPath`) a partir do frontend.
#[tauri::command]
pub fn get_document_file_path(db_path: String, storage_key: String) -> Result<String, String> {
    let path = documents_dir(&db_path).join(&storage_key);

    if !path.exists() {
        return Err("Arquivo não encontrado na pasta de documentos.".to_string());
    }

    Ok(path.to_string_lossy().to_string())
}

/// Acima disso o botão "Visualizar" recusa: o arquivo inteiro vira uma
/// string base64 que atravessa o IPC pro frontend, então precisa de um
/// teto bem menor que o de uma foto de sócio (`photos.rs`) — um PDF de
/// atas ou um recibo digitalizado cabe tranquilo, um vídeo ou backup
/// anexado por engano não devia nem tentar.
const TAMANHO_MAXIMO_VISUALIZACAO: u64 = 20 * 1024 * 1024;

/// Lê o arquivo de uma versão já importada e devolve como data URL
/// (`data:<mime>;base64,...`) — usado pelo botão "Visualizar" da ficha do
/// documento pra mostrar o arquivo dentro do próprio app (imagem/PDF),
/// sem depender do programa padrão do sistema operacional como
/// `get_document_file_path`/`openPath` fazem pro "Abrir".
#[tauri::command]
pub fn read_document_file_as_data_url(db_path: String, storage_key: String) -> Result<String, String> {
    let path = documents_dir(&db_path).join(&storage_key);

    let metadata = fs::metadata(&path).map_err(|_| "Arquivo não encontrado na pasta de documentos.".to_string())?;
    if metadata.len() > TAMANHO_MAXIMO_VISUALIZACAO {
        return Err("Arquivo grande demais para visualizar aqui — use \"Abrir\" pra abrir no programa padrão.".to_string());
    }

    let bytes = fs::read(&path).map_err(|e| format!("não foi possível ler o arquivo: {e}"))?;
    let mime_type = guess_mime_type(&path);
    Ok(format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)))
}
