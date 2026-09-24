// Backup completo de uma associação (dashboard da tela Início): um arquivo
// `.zip` com o banco (`banco.db`) + a pasta `docs` (arquivos anexados em
// Documentos, que vivem fora do SQLite — ver `documents.rs`). Serve tanto
// pra guardar uma cópia de segurança quanto pra levar a associação pra
// outro computador.
//
// O banco NÃO é copiado direto do disco: o `tauri-plugin-sql` usa o SQLite
// em modo WAL, então o arquivo `.db` sozinho pode não ter as últimas
// gravações. O frontend gera antes uma cópia consistente com
// `VACUUM INTO` (ver `src/services/backup.ts`) no caminho devolvido por
// `prepare_backup_snapshot`, e só essa cópia entra no `.zip`.

use serde::Serialize;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const NOME_BANCO_NO_ZIP: &str = "banco.db";
const PASTA_DOCS_NO_ZIP: &str = "docs/";
const NOME_MANIFESTO_NO_ZIP: &str = "backup.json";
const CABECALHO_SQLITE: &[u8; 16] = b"SQLite format 3\0";

fn pasta_do_banco(db_path: &str) -> PathBuf {
    Path::new(db_path).parent().unwrap_or_else(|| Path::new(".")).to_path_buf()
}

fn documents_dir(db_path: &str) -> PathBuf {
    pasta_do_banco(db_path).join("docs")
}

fn snapshot_path(db_path: &str) -> PathBuf {
    pasta_do_banco(db_path).join(".backup-snapshot.db")
}

fn agora_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Caminho temporário (ao lado do `.db`) onde o frontend deve rodar
/// `VACUUM INTO` — apaga uma sobra de backup anterior, porque o SQLite
/// recusa `VACUUM INTO` num arquivo que já existe.
#[tauri::command]
pub fn prepare_backup_snapshot(db_path: String) -> Result<String, String> {
    let caminho = snapshot_path(&db_path);
    if caminho.exists() {
        fs::remove_file(&caminho).map_err(|e| format!("não foi possível limpar o backup temporário anterior: {e}"))?;
    }
    Ok(caminho.to_string_lossy().to_string())
}

#[derive(Serialize)]
struct Manifesto {
    formato: u32,
    app_versao: &'static str,
    gerado_em_unix: u64,
}

#[derive(Serialize)]
pub struct ResumoBackup {
    pub documentos: u32,
    pub tamanho_bytes: u64,
}

/// Monta o `.zip` em `dest_path` com a cópia do banco (gerada antes por
/// `VACUUM INTO` em `prepare_backup_snapshot`) e a pasta `docs`. A cópia
/// temporária é apagada no fim, com ou sem erro.
#[tauri::command]
pub fn export_backup(db_path: String, dest_path: String) -> Result<ResumoBackup, String> {
    let snapshot = snapshot_path(&db_path);
    let resultado = montar_zip(&db_path, &snapshot, Path::new(&dest_path));
    let _ = fs::remove_file(&snapshot);
    resultado
}

fn montar_zip(db_path: &str, snapshot: &Path, destino: &Path) -> Result<ResumoBackup, String> {
    if !snapshot.exists() {
        return Err("A cópia do banco não foi gerada.".to_string());
    }

    let arquivo = File::create(destino).map_err(|e| format!("não foi possível criar o arquivo de backup: {e}"))?;
    let mut zip = ZipWriter::new(arquivo);
    let opcoes = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .large_file(true);
    let erro_zip = |e: zip::result::ZipError| format!("erro ao montar o backup: {e}");
    let erro_io = |e: io::Error| format!("erro ao montar o backup: {e}");

    let manifesto = Manifesto {
        formato: 1,
        app_versao: env!("CARGO_PKG_VERSION"),
        gerado_em_unix: agora_unix(),
    };
    let manifesto_json = serde_json::to_vec_pretty(&manifesto).map_err(|e| format!("erro ao montar o backup: {e}"))?;
    zip.start_file(NOME_MANIFESTO_NO_ZIP, opcoes).map_err(erro_zip)?;
    zip.write_all(&manifesto_json).map_err(erro_io)?;

    zip.start_file(NOME_BANCO_NO_ZIP, opcoes).map_err(erro_zip)?;
    let mut banco = File::open(snapshot).map_err(erro_io)?;
    io::copy(&mut banco, &mut zip).map_err(erro_io)?;

    let mut documentos = 0;
    let docs = documents_dir(db_path);
    if docs.is_dir() {
        let mut pendentes = vec![docs.clone()];
        while let Some(pasta) = pendentes.pop() {
            for entrada in fs::read_dir(&pasta).map_err(erro_io)? {
                let caminho = entrada.map_err(erro_io)?.path();
                if caminho.is_dir() {
                    pendentes.push(caminho);
                    continue;
                }
                let relativo = caminho.strip_prefix(&docs).map_err(|e| format!("erro ao montar o backup: {e}"))?;
                let nome = format!("{PASTA_DOCS_NO_ZIP}{}", relativo.to_string_lossy().replace('\\', "/"));
                zip.start_file(nome, opcoes).map_err(erro_zip)?;
                let mut origem = File::open(&caminho).map_err(erro_io)?;
                io::copy(&mut origem, &mut zip).map_err(erro_io)?;
                documentos += 1;
            }
        }
    }

    zip.finish().map_err(erro_zip)?;
    let tamanho_bytes = fs::metadata(destino).map(|m| m.len()).unwrap_or(0);
    Ok(ResumoBackup { documentos, tamanho_bytes })
}

/// Substitui o banco (e a pasta `docs`) da associação pelo conteúdo de um
/// backup. Aceita o `.zip` gerado por `export_backup` ou um arquivo `.db`
/// solto (cópia manual do banco). O frontend PRECISA fechar a conexão com
/// o banco antes (`closeDatabase()`) e reiniciar o app depois — as
/// migrations do `tauri-plugin-sql` só rodam na abertura, e é isso que
/// atualiza um backup feito numa versão mais antiga do app.
///
/// Nada é apagado: o banco e a pasta `docs` atuais são renomeados com o
/// sufixo `.antes-da-importacao-<timestamp>`, e o caminho dessa cópia é
/// devolvido pra UI mostrar ao usuário.
#[tauri::command]
pub fn import_backup(db_path: String, backup_path: String) -> Result<String, String> {
    let origem = Path::new(&backup_path);
    let eh_zip = origem
        .extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case("zip"))
        .unwrap_or(false);

    // Valida tudo ANTES de mexer nos arquivos atuais.
    let mut arquivo_zip = if eh_zip {
        let arquivo = File::open(origem).map_err(|e| format!("não foi possível abrir o backup: {e}"))?;
        let mut zip = ZipArchive::new(arquivo).map_err(|_| "O arquivo escolhido não é um backup .zip válido.".to_string())?;
        let mut banco = zip
            .by_name(NOME_BANCO_NO_ZIP)
            .map_err(|_| "Backup inválido: o .zip não contém o banco de dados (banco.db).".to_string())?;
        validar_cabecalho_sqlite(&mut banco)?;
        drop(banco);
        Some(zip)
    } else {
        let mut arquivo = File::open(origem).map_err(|e| format!("não foi possível abrir o backup: {e}"))?;
        validar_cabecalho_sqlite(&mut arquivo)?;
        None
    };

    let banco_atual = PathBuf::from(&db_path);
    let docs_atual = documents_dir(&db_path);
    let sufixo = format!("antes-da-importacao-{}", agora_unix());
    let copia_seguranca = PathBuf::from(format!("{db_path}.{sufixo}"));

    // Banco atual + arquivos do WAL vão juntos, com o mesmo sufixo — assim
    // a cópia de segurança continua abrível se o WAL ainda tiver dados.
    if banco_atual.exists() {
        fs::rename(&banco_atual, &copia_seguranca).map_err(|e| {
            format!("não foi possível separar o banco atual (feche outros programas que estejam usando o arquivo): {e}")
        })?;
    }
    for extra in ["-wal", "-shm"] {
        let caminho = PathBuf::from(format!("{db_path}{extra}"));
        if caminho.exists() {
            let _ = fs::rename(&caminho, format!("{db_path}{extra}.{sufixo}"));
        }
    }

    let restaurar = || {
        let _ = fs::remove_file(&banco_atual);
        let _ = fs::rename(&copia_seguranca, &banco_atual);
        for extra in ["-wal", "-shm"] {
            let _ = fs::rename(format!("{db_path}{extra}.{sufixo}"), format!("{db_path}{extra}"));
        }
        let docs_separada = PathBuf::from(format!("{}.{sufixo}", docs_atual.to_string_lossy()));
        if docs_separada.exists() {
            let _ = fs::remove_dir_all(&docs_atual);
            let _ = fs::rename(&docs_separada, &docs_atual);
        }
    };

    let resultado = match arquivo_zip.as_mut() {
        Some(zip) => extrair_zip(zip, &banco_atual, &docs_atual, &sufixo),
        None => fs::copy(origem, &banco_atual)
            .map(|_| ())
            .map_err(|e| format!("não foi possível copiar o banco: {e}")),
    };

    if let Err(erro) = resultado {
        restaurar();
        return Err(erro);
    }

    Ok(copia_seguranca.to_string_lossy().to_string())
}

fn validar_cabecalho_sqlite(leitor: &mut impl Read) -> Result<(), String> {
    let mut cabecalho = [0u8; 16];
    leitor
        .read_exact(&mut cabecalho)
        .map_err(|_| "O arquivo escolhido não é um banco de dados válido.".to_string())?;
    if &cabecalho != CABECALHO_SQLITE {
        return Err("O arquivo escolhido não é um banco de dados válido.".to_string());
    }
    Ok(())
}

fn extrair_zip(zip: &mut ZipArchive<File>, banco: &Path, docs: &Path, sufixo: &str) -> Result<(), String> {
    let erro_io = |e: io::Error| format!("erro ao restaurar o backup: {e}");

    {
        let mut origem = zip.by_name(NOME_BANCO_NO_ZIP).map_err(|e| format!("erro ao restaurar o backup: {e}"))?;
        let mut destino = File::create(banco).map_err(erro_io)?;
        io::copy(&mut origem, &mut destino).map_err(erro_io)?;
    }

    // Pasta `docs` atual sai de cena (renomeada, não apagada) e a do backup
    // entra no lugar — mesmo que o backup não tenha nenhum documento.
    if docs.exists() {
        let destino = PathBuf::from(format!("{}.{sufixo}", docs.to_string_lossy()));
        fs::rename(docs, destino).map_err(|e| format!("não foi possível separar a pasta de documentos atual: {e}"))?;
    }

    for indice in 0..zip.len() {
        let mut entrada = zip.by_index(indice).map_err(|e| format!("erro ao restaurar o backup: {e}"))?;
        // `enclosed_name` recusa caminhos com `..`/absolutos (zip slip).
        let Some(relativo) = entrada.enclosed_name() else { continue };
        let Ok(dentro_de_docs) = relativo.strip_prefix("docs") else { continue };
        if entrada.is_dir() || dentro_de_docs.as_os_str().is_empty() {
            continue;
        }

        let destino = docs.join(dentro_de_docs);
        if let Some(pasta) = destino.parent() {
            fs::create_dir_all(pasta).map_err(erro_io)?;
        }
        let mut arquivo = File::create(&destino).map_err(erro_io)?;
        io::copy(&mut entrada, &mut arquivo).map_err(erro_io)?;
    }

    Ok(())
}
