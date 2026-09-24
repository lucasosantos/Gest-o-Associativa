import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { comAtividade } from "./ActivityLog.js";

/** Espelha a tabela `donors` (migration `version: 4`). */
export interface Donor {
  id: string;
  association_id: string;
  name: string;
  document_number: string | null;
  person_id: string | null;
  contact_data: string | null;
  notes: string | null;
}

export interface NovoDoador {
  name: string;
  document_number?: string | null;
  contact_data?: string | null;
  notes?: string | null;
}

/** Acesso à tabela `donors`. */
export class DonorModel {
  static async list(): Promise<Donor[]> {
    const db = await getDatabase();
    return db.select<Donor[]>("SELECT * FROM donors WHERE association_id = $1 ORDER BY name", [
      getCurrentAssociationId(),
    ]);
  }

  /**
   * Localiza um doador já cadastrado pelo documento, para não duplicar —
   * restrito à associação ativa: o mesmo CPF pode aparecer como doador em
   * mais de uma associação do mesmo arquivo, cada uma com seu próprio
   * cadastro de doador.
   */
  static async findByDocument(documentNumber: string): Promise<Donor | null> {
    const db = await getDatabase();
    const rows = await db.select<Donor[]>("SELECT * FROM donors WHERE association_id = $1 AND document_number = $2", [
      getCurrentAssociationId(),
      documentNumber,
    ]);
    return rows[0] ?? null;
  }

  static async create(dados: NovoDoador): Promise<Donor> {
    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();
        const db = await getDatabase();
        const id = newId();
        await db.execute(
          `INSERT INTO donors (id, association_id, name, document_number, contact_data, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, associationId, dados.name, dados.document_number ?? null, dados.contact_data ?? null, dados.notes ?? null]
        );

        const [criado] = await db.select<Donor[]>("SELECT * FROM donors WHERE id = $1", [id]);
        return criado;
      },
      (criado) => ({
        module: "FINANCEIRO",
        description: `Doador cadastrado — ${criado.name}`,
      })
    );
  }
}
