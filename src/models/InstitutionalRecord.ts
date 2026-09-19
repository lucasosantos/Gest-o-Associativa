import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";

/**
 * Espelha a tabela `records` (migration `version: 7`) — "registros
 * institucionais genéricos". É a entrada mais rasa de todo o dicionário de
 * dados original (`docs/dominio-associacoes.md`, seção 4.5): aparece só na
 * tabela-resumo, sem `CREATE TABLE` correspondente e sem relação com
 * nenhuma outra tabela. Implementado aqui com exatamente os campos
 * descritos ali, sem inventar semântica que o documento-fonte não define —
 * serve para anotar algo institucional que não é nem um documento
 * (`documents`) nem um protocolo (`protocol_entries`), como um marco ou
 * evento (ex.: fundação, filiação a uma federação, mudança de sede).
 */
export type StatusRegistro = "ATIVO" | "ARQUIVADO" | "CANCELADO";

export interface InstitutionalRecord {
  id: string;
  association_id: string;
  record_type: string;
  reference_number: string | null;
  record_date: string;
  title: string;
  description: string | null;
  status: StatusRegistro;
  responsible_user_id: string | null;
  created_at: string;
}

export interface NovoRegistroInstitucional {
  record_type: string;
  reference_number?: string | null;
  record_date: string;
  title: string;
  description?: string | null;
}

export class InstitutionalRecordModel {
  static async list(): Promise<InstitutionalRecord[]> {
    const db = await getDatabase();
    return db.select<InstitutionalRecord[]>(
      "SELECT * FROM records WHERE association_id = $1 ORDER BY record_date DESC",
      [getCurrentAssociationId()]
    );
  }

  static async create(dados: NovoRegistroInstitucional): Promise<InstitutionalRecord> {
    const associationId = getCurrentAssociationId();
    const db = await getDatabase();
    const id = newId();
    await db.execute(
      `INSERT INTO records (id, association_id, record_type, reference_number, record_date, title, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        associationId,
        dados.record_type,
        dados.reference_number ?? null,
        dados.record_date,
        dados.title,
        dados.description ?? null,
      ]
    );

    const [criado] = await db.select<InstitutionalRecord[]>("SELECT * FROM records WHERE id = $1", [id]);
    return criado;
  }

  static async updateStatus(id: string, status: StatusRegistro): Promise<void> {
    const db = await getDatabase();
    await db.execute("UPDATE records SET status = $2 WHERE id = $1", [id, status]);
  }
}
