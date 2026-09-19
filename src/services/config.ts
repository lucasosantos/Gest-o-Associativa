import { invoke } from "@tauri-apps/api/core";

/**
 * Espelha `AssociationSummary` do lado Rust (`src-tauri/src/config.rs`) —
 * uma entrada do registro de associações do `config.json`, sem o hash de
 * senha (a verificação acontece só no Rust, via `verifyAssociationPassword`).
 */
export interface AssociationSummary {
  id: string;
  name: string;
  has_password: boolean;
  db_path: string;
}

export type MoveDbStatus = "same" | "moved" | "kept_existing" | "created_new";

/** Caminho do `config.json`, só para exibir/depurar na tela de Configurações. */
export function getConfigFilePath(): Promise<string> {
  return invoke<string>("get_config_file_path");
}

/** Lista as associações cadastradas nesta instalação (config.json). */
export function listAssociations(): Promise<AssociationSummary[]> {
  return invoke<AssociationSummary[]>("list_associations");
}

/**
 * Cadastra uma associação nova. Se `dbPath` vier vazio, o Rust sugere um
 * local padrão (pasta própria ao lado do executável). O arquivo `.db` só
 * fica utilizável depois de reiniciar o app — `tauri-plugin-sql` registra
 * migrations por URL de banco uma vez, no início do processo (ver nota em
 * `src-tauri/src/lib.rs`).
 */
export function createAssociation(name: string, password: string | null, dbPath: string | null): Promise<AssociationSummary> {
  return invoke<AssociationSummary>("create_association", { name, password, dbPath });
}

/**
 * Atualiza nome e/ou local do arquivo de uma associação já cadastrada.
 * Feche a conexão do banco (`closeDatabase()`) antes de mudar `dbPath` se
 * essa associação for a que está aberta no momento.
 */
export function updateAssociation(id: string, name: string | null, dbPath: string | null): Promise<MoveDbStatus> {
  return invoke<MoveDbStatus>("update_association", { id, name, dbPath });
}

/** Define, troca ou remove (`password: null`) a senha de acesso de uma associação. */
export function setAssociationPassword(id: string, password: string | null): Promise<void> {
  return invoke<void>("set_association_password", { id, password });
}

/** Confere a senha digitada contra o hash guardado — `true` também quando a associação não tem senha. */
export function verifyAssociationPassword(id: string, password: string): Promise<boolean> {
  return invoke<boolean>("verify_association_password", { id, password });
}

/** Remove só a entrada do config.json — o arquivo `.db`/pasta `docs` não são apagados. */
export function removeAssociation(id: string): Promise<void> {
  return invoke<void>("remove_association", { id });
}

/** Reinicia o aplicativo (necessário depois de cadastrar uma associação nova). */
export function restartApp(): Promise<void> {
  return invoke<void>("restart_app");
}
