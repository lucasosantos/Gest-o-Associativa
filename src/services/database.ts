import Database from "@tauri-apps/plugin-sql";

let dbInstance: Database | null = null;
let currentDbPath: string | null = null;

/**
 * Conecta ao arquivo `.db` da associação escolhida, fechando a conexão
 * anterior (se houver) antes — reaproveitada por `useCurrentAssociation.ts`
 * ao trocar de associação. `dbPath` precisa ser exatamente o mesmo caminho
 * registrado em `src-tauri/src/lib.rs` (`add_migrations`) para essa
 * associação, senão a conexão abre num banco sem nenhuma tabela.
 */
export async function connectToAssociation(dbPath: string): Promise<Database> {
  if (dbInstance && currentDbPath === dbPath) return dbInstance;

  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
    currentDbPath = null;
  }

  dbInstance = await Database.load(`sqlite:${dbPath}`);
  currentDbPath = dbPath;
  return dbInstance;
}

/** Retorna a conexão SQLite atual — lança erro se nenhuma associação foi selecionada ainda. */
export async function getDatabase(): Promise<Database> {
  if (!dbInstance) {
    throw new Error("Nenhuma associação conectada. Escolha uma na tela Início.");
  }
  return dbInstance;
}

/** Caminho do `.db` atualmente conectado — usado para montar a pasta `docs` (ver `documentFiles.ts`). */
export function getCurrentDbPath(): string {
  if (!currentDbPath) {
    throw new Error("Nenhuma associação conectada. Escolha uma na tela Início.");
  }
  return currentDbPath;
}

/** Fecha a conexão atual (se existir) e esquece a instância em cache. */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
    currentDbPath = null;
  }
}
