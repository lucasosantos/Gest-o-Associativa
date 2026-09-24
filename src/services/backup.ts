import { invoke } from "@tauri-apps/api/core";
import { closeDatabase, connectToAssociation, getCurrentDbPath, getDatabase } from "./database.js";

/** Espelha `ResumoBackup` de `src-tauri/src/backup.rs`. */
export interface ResumoBackup {
  documentos: number;
  tamanho_bytes: number;
}

/**
 * Gera o backup completo da associação conectada (banco + pasta `docs`)
 * num `.zip` em `destPath`. O banco sai de um `VACUUM INTO` — cópia
 * consistente mesmo com a conexão aberta em modo WAL (copiar o `.db` direto
 * do disco podia perder as últimas gravações). Ver `src-tauri/src/backup.rs`.
 */
export async function exportarBackup(destPath: string): Promise<ResumoBackup> {
  const dbPath = getCurrentDbPath();
  const snapshot = await invoke<string>("prepare_backup_snapshot", { dbPath });
  const db = await getDatabase();
  await db.execute("VACUUM INTO $1", [snapshot]);
  return invoke<ResumoBackup>("export_backup", { dbPath, destPath });
}

/**
 * Substitui o banco (e a pasta `docs`) da associação conectada pelo
 * conteúdo de `backupPath` (`.zip` gerado por `exportarBackup` ou um `.db`
 * solto). Fecha a conexão antes — se a importação falhar, reconecta no
 * banco original, que o Rust já devolveu ao lugar. Depois de sucesso, o
 * app PRECISA ser reiniciado (`restartApp`) pra rodar as migrations no
 * banco importado. Devolve o caminho da cópia de segurança do banco antigo.
 */
export async function importarBackup(backupPath: string): Promise<string> {
  const dbPath = getCurrentDbPath();
  await closeDatabase();
  try {
    return await invoke<string>("import_backup", { dbPath, backupPath });
  } catch (error) {
    await connectToAssociation(dbPath);
    throw error;
  }
}
