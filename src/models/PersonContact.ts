import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";

/** Tipo de contato de uma pessoa (ver migration `version: 2`). */
export type TipoContato = "TELEFONE" | "CELULAR" | "EMAIL" | "OUTRO";

/** Espelha a tabela `person_contacts`. */
export interface PersonContact {
  id: string;
  person_id: string;
  contact_type: TipoContato;
  contact_value: string;
  /** SQLite não tem booleano nativo: 0 = falso, 1 = verdadeiro. */
  is_primary: 0 | 1;
  is_verified: 0 | 1;
  created_at: string;
}

export interface NovoContato {
  person_id: string;
  contact_type: TipoContato;
  contact_value: string;
  is_primary?: 0 | 1;
  is_verified?: 0 | 1;
}

export type AtualizacaoContato = Partial<Omit<NovoContato, "person_id">>;

/** Acesso à tabela `person_contacts`. */
export class PersonContactModel {
  static async listByPerson(personId: string): Promise<PersonContact[]> {
    const db = await getDatabase();
    return db.select<PersonContact[]>(
      "SELECT * FROM person_contacts WHERE person_id = $1 ORDER BY is_primary DESC, created_at",
      [personId]
    );
  }

  static async create(dados: NovoContato): Promise<PersonContact> {
    const db = await getDatabase();
    const id = newId();
    await db.execute(
      `INSERT INTO person_contacts (id, person_id, contact_type, contact_value, is_primary, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, dados.person_id, dados.contact_type, dados.contact_value, dados.is_primary ?? 0, dados.is_verified ?? 0]
    );

    const [criado] = await db.select<PersonContact[]>("SELECT * FROM person_contacts WHERE id = $1", [id]);
    return criado;
  }

  static async update(id: string, dados: AtualizacaoContato): Promise<void> {
    const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
    if (campos.length === 0) return;

    const db = await getDatabase();
    const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
    const valores = campos.map(([, valor]) => valor as string | number);

    await db.execute(`UPDATE person_contacts SET ${sets} WHERE id = $1`, [id, ...valores]);
  }

  static async remove(id: string): Promise<void> {
    const db = await getDatabase();
    await db.execute("DELETE FROM person_contacts WHERE id = $1", [id]);
  }
}
