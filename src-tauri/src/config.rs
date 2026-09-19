// Configurações do programa, persistidas em um `config.json` que fica na
// mesma pasta do executável (ao lado do .exe/binário), fora de qualquer
// pasta de perfil/appdata do usuário — assim o arquivo pode ser aberto,
// versionado ou movido junto com a instalação.
//
// O app voltou ao modelo "1 arquivo `.db` por associação" (ver
// docs/plano-implementacao.md, mudança pós-MVP de reorganização de acesso):
// `config.json` guarda a LISTA de associações cadastradas nesta instalação
// — nome, hash de senha (opcional) e o caminho do `lc3database.db` de cada
// uma. Trocar de associação é trocar de conexão SQLite para outro arquivo;
// não há mais uma tabela `associations` compartilhada entre elas.

use crate::password;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Identificador do app (o mesmo de `tauri.conf.json`), usado só para achar
/// onde o banco de dados ficava guardado antes de existir `config.json`.
const APP_IDENTIFIER: &str = "com.example.appbase";
const LEGACY_DB_FILE_NAME: &str = "lc3database.db";
pub const DEFAULT_DB_FILE_NAME: &str = "lc3database.db";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssociationEntry {
    pub id: String,
    pub name: String,
    /// `None` = associação sem senha. Nunca guarda a senha em si, só o hash
    /// (ver `password.rs`).
    pub password_hash: Option<String>,
    /// Caminho absoluto até o `lc3database.db` desta associação.
    pub db_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub associations: Vec<AssociationEntry>,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            associations: Vec::new(),
        }
    }
}

/// Versão anterior de `config.json` (1 arquivo = 1 associação, sem lista).
/// Usada só para migrar automaticamente quem já tinha essa versão — ver
/// `load_or_init()`.
#[derive(Debug, Deserialize)]
struct LegacyAppConfigV1 {
    database: LegacyDatabaseConfig,
}

#[derive(Debug, Deserialize)]
struct LegacyDatabaseConfig {
    path: String,
}

/// Dados de uma associação sem o hash de senha — o que o frontend recebe
/// para listar/exibir (a verificação de senha acontece só no Rust).
#[derive(Debug, Serialize)]
pub struct AssociationSummary {
    pub id: String,
    pub name: String,
    pub has_password: bool,
    pub db_path: String,
}

impl From<&AssociationEntry> for AssociationSummary {
    fn from(entry: &AssociationEntry) -> Self {
        AssociationSummary {
            id: entry.id.clone(),
            name: entry.name.clone(),
            has_password: entry.password_hash.is_some(),
            db_path: entry.db_path.clone(),
        }
    }
}

/// Resultado de mover o arquivo de uma associação para um novo local —
/// mesmo espírito de antes, agora reaproveitado por `update_association`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MoveDbStatus {
    Same,
    Moved,
    KeptExisting,
    CreatedNew,
}

/// Pasta onde está o executável do programa — é ao lado dela que o
/// `config.json` mora.
pub fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn config_file_path() -> PathBuf {
    exe_dir().join("config.json")
}

/// Local sugerido para o banco de uma associação nova: uma subpasta com o
/// nome (normalizado) da associação, ao lado do executável — evita que
/// duas associações caiam no mesmo arquivo por acidente.
fn suggested_db_path(name: &str) -> PathBuf {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug.trim_matches('-');
    let slug = if slug.is_empty() { "associacao" } else { slug };
    exe_dir().join("associacoes").join(slug).join(DEFAULT_DB_FILE_NAME)
}

/// Antes de existir o `config.json`, o plugin de SQL guardava o banco na
/// pasta de configuração do sistema operacional (ex.: `%APPDATA%` no
/// Windows, `~/.config` no Linux). Usado só como último fallback ao migrar
/// uma instalação bem antiga.
fn legacy_db_path() -> PathBuf {
    let base = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME")
            .map(|home| PathBuf::from(home).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    };

    base.unwrap_or_else(exe_dir)
        .join(APP_IDENTIFIER)
        .join(LEGACY_DB_FILE_NAME)
}

/// Garante que um caminho de banco de dados seja absoluto, resolvendo
/// caminhos relativos a partir da pasta do executável.
fn normalize_db_path(path: &str) -> String {
    let candidate = PathBuf::from(path);
    let absolute = if candidate.is_absolute() {
        candidate
    } else {
        exe_dir().join(candidate)
    };
    absolute.to_string_lossy().to_string()
}

/// Lê o `config.json` ao lado do executável. Ordem de tentativas:
/// 1. Formato atual (`{ associations: [...] }`).
/// 2. Formato anterior (`{ database: { path } }`, 1 associação só) — vira a
///    primeira entrada da lista nova, e o arquivo é regravado já no
///    formato atual (migração automática, sem passo manual).
/// 3. Nada de config.json, mas existe um banco no local legado (versões
///    bem antigas, anteriores ao próprio config.json) — mesma migração.
/// 4. Primeira execução de verdade: lista vazia, tela Início orienta a
///    cadastrar a primeira associação.
pub fn load_or_init() -> AppConfig {
    let path = config_file_path();

    if let Ok(text) = fs::read_to_string(&path) {
        if let Ok(config) = serde_json::from_str::<AppConfig>(&text) {
            return config;
        }

        if let Ok(legacy) = serde_json::from_str::<LegacyAppConfigV1>(&text) {
            let config = AppConfig {
                associations: vec![AssociationEntry {
                    id: generate_id(),
                    name: "Associação principal".to_string(),
                    password_hash: None,
                    db_path: legacy.database.path,
                }],
            };
            if let Err(err) = save(&config) {
                eprintln!("não foi possível regravar o config.json migrado: {err}");
            }
            return config;
        }

        eprintln!("config.json em {:?} não reconhecido; recriando", path);
    } else if legacy_db_path().exists() {
        let config = AppConfig {
            associations: vec![AssociationEntry {
                id: generate_id(),
                name: "Associação principal".to_string(),
                password_hash: None,
                db_path: legacy_db_path().to_string_lossy().to_string(),
            }],
        };
        if let Err(err) = save(&config) {
            eprintln!("não foi possível criar o config.json a partir do banco legado: {err}");
        }
        return config;
    }

    let config = AppConfig::default();
    if let Err(err) = save(&config) {
        eprintln!("não foi possível criar o config.json em {:?}: {err}", path);
    }
    config
}

pub fn save(config: &AppConfig) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(config)?;
    fs::write(config_file_path(), json)
}

/// Gera um identificador aleatório (16 bytes em hex) para uma nova entrada
/// de associação — sem depender da crate `uuid` como dependência direta;
/// reaproveita a mesma `getrandom` usada para o salt de senha.
fn generate_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("falha ao gerar id aleatório");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[tauri::command]
pub fn get_config_file_path() -> String {
    config_file_path().to_string_lossy().to_string()
}

#[tauri::command]
pub fn list_associations() -> Vec<AssociationSummary> {
    load_or_init().associations.iter().map(AssociationSummary::from).collect()
}

/// Cadastra uma associação nova no `config.json`. Se `db_path` vier vazio,
/// sugere uma pasta própria ao lado do executável. **Não** cria nem migra
/// o arquivo `.db` em si — isso só acontece quando o backend Rust sobe de
/// novo (`add_migrations` é registrado por URL no início do processo, ver
/// nota em `lib.rs`), por isso o frontend avisa que é preciso reiniciar o
/// app antes de conseguir abrir essa associação.
#[tauri::command]
pub fn create_association(
    name: String,
    password: Option<String>,
    db_path: Option<String>,
) -> Result<AssociationSummary, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Informe o nome da associação.".to_string());
    }

    let db_path = match db_path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()) {
        Some(p) => normalize_db_path(&p),
        None => suggested_db_path(&name).to_string_lossy().to_string(),
    };

    let mut config = load_or_init();
    if config.associations.iter().any(|a| a.db_path == db_path) {
        return Err("Já existe uma associação cadastrada com esse arquivo de banco.".to_string());
    }

    let entry = AssociationEntry {
        id: generate_id(),
        name,
        password_hash: password
            .filter(|p| !p.is_empty())
            .map(|p| password::hash_password(&p)),
        db_path,
    };

    let summary = AssociationSummary::from(&entry);
    config.associations.push(entry);
    save(&config).map_err(|e| format!("não foi possível salvar o config.json: {e}"))?;
    Ok(summary)
}

/// Atualiza nome e/ou local do arquivo de uma associação já cadastrada.
/// Quando `db_path` muda, o arquivo (e os sidecars `-wal`/`-shm`, se
/// existirem) são movidos fisicamente para o novo lugar.
#[tauri::command]
pub fn update_association(
    id: String,
    name: Option<String>,
    db_path: Option<String>,
) -> Result<MoveDbStatus, String> {
    let mut config = load_or_init();
    let entry = config
        .associations
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or_else(|| "Associação não encontrada.".to_string())?;

    if let Some(name) = name {
        let name = name.trim().to_string();
        if !name.is_empty() {
            entry.name = name;
        }
    }

    let mut status = MoveDbStatus::Same;
    if let Some(new_path) = db_path {
        let new_path = normalize_db_path(&new_path);
        let old_path = entry.db_path.clone();
        status = move_database_file(&old_path, &new_path)?;
        entry.db_path = new_path;
    }

    save(&config).map_err(|e| format!("não foi possível salvar o config.json: {e}"))?;
    Ok(status)
}

#[tauri::command]
pub fn set_association_password(id: String, password: Option<String>) -> Result<(), String> {
    let mut config = load_or_init();
    let entry = config
        .associations
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or_else(|| "Associação não encontrada.".to_string())?;

    entry.password_hash = password
        .filter(|p| !p.is_empty())
        .map(|p| password::hash_password(&p));

    save(&config).map_err(|e| format!("não foi possível salvar o config.json: {e}"))
}

#[tauri::command]
pub fn verify_association_password(id: String, password: String) -> Result<bool, String> {
    let config = load_or_init();
    let entry = config
        .associations
        .iter()
        .find(|a| a.id == id)
        .ok_or_else(|| "Associação não encontrada.".to_string())?;

    Ok(match &entry.password_hash {
        Some(hash) => password::verify_password(&password, hash),
        None => true,
    })
}

/// Remove só a entrada do `config.json` — o arquivo `.db` e a pasta `docs`
/// dessa associação **não** são apagados (cancelamento lógico, mesmo
/// espírito do resto do app: nunca excluir dado fisicamente sem que o
/// usuário peça isso explicitamente fora do app).
#[tauri::command]
pub fn remove_association(id: String) -> Result<(), String> {
    let mut config = load_or_init();
    let tamanho_antes = config.associations.len();
    config.associations.retain(|a| a.id != id);
    if config.associations.len() == tamanho_antes {
        return Err("Associação não encontrada.".to_string());
    }
    save(&config).map_err(|e| format!("não foi possível salvar o config.json: {e}"))
}

/// Move o arquivo do banco (e os arquivos auxiliares -wal/-shm, se
/// existirem) do local antigo para o novo.
fn move_database_file(old_path: &str, new_path: &str) -> Result<MoveDbStatus, String> {
    if old_path == new_path {
        return Ok(MoveDbStatus::Same);
    }

    let old = Path::new(old_path);
    let new = Path::new(new_path);

    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("não foi possível criar a pasta de destino: {e}"))?;
    }

    if new.exists() {
        return Ok(MoveDbStatus::KeptExisting);
    }

    if !old.exists() {
        return Ok(MoveDbStatus::CreatedNew);
    }

    move_file(old, new).map_err(|e| format!("não foi possível mover o banco de dados: {e}"))?;

    for suffix in ["-wal", "-shm"] {
        let sidecar_old = PathBuf::from(format!("{old_path}{suffix}"));
        if sidecar_old.exists() {
            let sidecar_new = PathBuf::from(format!("{new_path}{suffix}"));
            let _ = move_file(&sidecar_old, &sidecar_new);
        }
    }

    Ok(MoveDbStatus::Moved)
}

/// Move um arquivo de `from` para `to`. Tenta primeiro um `rename`
/// (atômico e rápido, funciona quando origem e destino estão no mesmo
/// disco/partição); se falhar — por exemplo ao mover entre discos
/// diferentes — cai para copiar o conteúdo e só então apagar o arquivo
/// original.
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }

    fs::copy(from, to)?;
    fs::remove_file(from)?;
    Ok(())
}

/// Reinicia o aplicativo — necessário depois de cadastrar uma associação
/// nova (ver nota em `create_association`) ou mover o arquivo de uma já
/// existente enquanto ela está conectada.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}
