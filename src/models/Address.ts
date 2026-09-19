import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";

/**
 * Espelha a tabela `addresses` (migration `version: 1`). Endereço
 * institucional (`association_id` preenchido) ou de uma pessoa (`person_id`
 * preenchido, a partir da Etapa 2 do módulo) — nunca os dois nulos.
 */
export interface Address {
  id: string;
  association_id: string | null;
  person_id: string | null;
  address_type: string;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
  country: string;
  zip_code: string | null;
  /** SQLite não tem booleano nativo: 0 = falso, 1 = verdadeiro. */
  is_primary: 0 | 1;
  created_at: string;
}

export interface NovoEndereco {
  association_id?: string | null;
  person_id?: string | null;
  address_type?: string;
  street: string;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city: string;
  state: string;
  country?: string;
  zip_code?: string | null;
  is_primary?: 0 | 1;
}

export type AtualizacaoEndereco = Partial<NovoEndereco>;

/** Acesso à tabela `addresses`. */
export class AddressModel {
  static async listByAssociation(associationId: string): Promise<Address[]> {
    const db = await getDatabase();
    return db.select<Address[]>(
      "SELECT * FROM addresses WHERE association_id = $1 ORDER BY is_primary DESC, created_at",
      [associationId]
    );
  }

  /** Endereço institucional principal (`is_primary`) da associação, se houver — uso nos cabeçalhos de impressão (`PrintHeader.vue`). */
  static async primaryForAssociation(associationId: string): Promise<Address | null> {
    const enderecos = await this.listByAssociation(associationId);
    return enderecos[0] ?? null;
  }

  static async listByPerson(personId: string): Promise<Address[]> {
    const db = await getDatabase();
    return db.select<Address[]>(
      "SELECT * FROM addresses WHERE person_id = $1 ORDER BY is_primary DESC, created_at",
      [personId]
    );
  }

  static async create(dados: NovoEndereco): Promise<Address> {
    if (!dados.association_id && !dados.person_id) {
      throw new Error("Endereço precisa pertencer a uma associação ou a uma pessoa.");
    }

    const db = await getDatabase();
    const id = newId();
    await db.execute(
      `INSERT INTO addresses
         (id, association_id, person_id, address_type, street, number, complement, district, city, state, country, zip_code, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        dados.association_id ?? null,
        dados.person_id ?? null,
        dados.address_type ?? "RESIDENCIAL",
        dados.street,
        dados.number ?? null,
        dados.complement ?? null,
        dados.district ?? null,
        dados.city,
        dados.state,
        dados.country ?? "Brasil",
        dados.zip_code ?? null,
        dados.is_primary ?? 0,
      ]
    );

    const [criado] = await db.select<Address[]>("SELECT * FROM addresses WHERE id = $1", [id]);
    return criado;
  }

  static async update(id: string, dados: AtualizacaoEndereco): Promise<void> {
    const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
    if (campos.length === 0) return;

    const db = await getDatabase();
    const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
    const valores = campos.map(([, valor]) => valor as string | number | null);

    await db.execute(`UPDATE addresses SET ${sets} WHERE id = $1`, [id, ...valores]);
  }

  static async remove(id: string): Promise<void> {
    const db = await getDatabase();
    await db.execute("DELETE FROM addresses WHERE id = $1", [id]);
  }
}
