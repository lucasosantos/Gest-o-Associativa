import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";

/**
 * Espelha a tabela `payees` (criada na migration `version: 3`, Etapa 3 —
 * junto do resto do financeiro — mas só usada a partir da Etapa 5). Fornecedor
 * ou favorecido de uma conta a pagar.
 */
export interface Payee {
  id: string;
  association_id: string;
  name: string;
  document_number: string | null;
  person_id: string | null;
  email: string | null;
  phone: string | null;
  address_id: string | null;
  is_active: 0 | 1;
}

export interface NovoFornecedor {
  name: string;
  document_number?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Acesso à tabela `payees`. */
export class PayeeModel {
  static async list(): Promise<Payee[]> {
    const db = await getDatabase();
    return db.select<Payee[]>("SELECT * FROM payees WHERE association_id = $1 AND is_active = 1 ORDER BY name", [
      getCurrentAssociationId(),
    ]);
  }

  static async create(dados: NovoFornecedor): Promise<Payee> {
    const associationId = getCurrentAssociationId();
    const db = await getDatabase();
    const id = newId();
    await db.execute(
      `INSERT INTO payees (id, association_id, name, document_number, email, phone)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, associationId, dados.name, dados.document_number ?? null, dados.email ?? null, dados.phone ?? null]
    );

    const [criado] = await db.select<Payee[]>("SELECT * FROM payees WHERE id = $1", [id]);
    return criado;
  }
}
