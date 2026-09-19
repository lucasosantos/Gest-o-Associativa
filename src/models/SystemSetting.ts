import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";

/**
 * Espelha a tabela `system_settings` (migration `version: 8`) — armazém
 * genérico de configuração chave/valor por associação (`value_json` é
 * sempre uma string JSON, serializada/desserializada por quem consome).
 * Só a camada de dados entra nesta etapa; nenhuma tela usa isso ainda —
 * fica pronta para o dia em que um valor configurável de verdade aparecer
 * (ex.: o limite de aprovação de despesa citado na seção 6 do documento de
 * domínio), sem precisar de uma migration nova para cada configuração.
 */
export interface SystemSetting {
  id: string;
  association_id: string;
  key: string;
  value_json: string;
  is_secret: 0 | 1;
}

export class SystemSettingModel {
  /** `key` é única por associação (`UNIQUE(association_id, key)`) — sempre filtrado pela associação ativa. */
  static async get(key: string): Promise<SystemSetting | null> {
    const db = await getDatabase();
    const rows = await db.select<SystemSetting[]>(
      "SELECT * FROM system_settings WHERE association_id = $1 AND key = $2",
      [getCurrentAssociationId(), key]
    );
    return rows[0] ?? null;
  }

  static async list(): Promise<SystemSetting[]> {
    const db = await getDatabase();
    return db.select<SystemSetting[]>("SELECT * FROM system_settings WHERE association_id = $1 ORDER BY key", [
      getCurrentAssociationId(),
    ]);
  }

  /** Cria ou substitui o valor de uma chave (não há histórico de configuração). */
  static async set(key: string, value: unknown, isSecret = false): Promise<void> {
    const associationId = getCurrentAssociationId();
    const db = await getDatabase();
    const existente = await SystemSettingModel.get(key);
    const valueJson = JSON.stringify(value);

    if (existente) {
      await db.execute("UPDATE system_settings SET value_json = $2, is_secret = $3 WHERE id = $1", [
        existente.id,
        valueJson,
        isSecret ? 1 : 0,
      ]);
    } else {
      await db.execute(
        "INSERT INTO system_settings (id, association_id, key, value_json, is_secret) VALUES ($1, $2, $3, $4, $5)",
        [newId(), associationId, key, valueJson, isSecret ? 1 : 0]
      );
    }
  }
}
