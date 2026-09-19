import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";

/**
 * Espelha a tabela `payers` (criada na migration `version: 3`, Etapa 3, e só
 * usada a partir da Etapa 5). Pagador avulso de uma conta a receber — quando
 * a origem é um sócio, usa-se `receivables.member_id` em vez disto.
 */
export interface Payer {
  id: string;
  association_id: string;
  name: string;
  document_number: string | null;
  person_id: string | null;
  email: string | null;
  phone: string | null;
}

export interface NovoPagador {
  name: string;
  document_number?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Acesso à tabela `payers`. */
export class PayerModel {
  static async list(): Promise<Payer[]> {
    const db = await getDatabase();
    return db.select<Payer[]>("SELECT * FROM payers WHERE association_id = $1 ORDER BY name", [
      getCurrentAssociationId(),
    ]);
  }

  static async create(dados: NovoPagador): Promise<Payer> {
    const associationId = getCurrentAssociationId();
    const db = await getDatabase();
    const id = newId();
    await db.execute(
      `INSERT INTO payers (id, association_id, name, document_number, email, phone)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, associationId, dados.name, dados.document_number ?? null, dados.email ?? null, dados.phone ?? null]
    );

    const [criado] = await db.select<Payer[]>("SELECT * FROM payers WHERE id = $1", [id]);
    return criado;
  }
}
