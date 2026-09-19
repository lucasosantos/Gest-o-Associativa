import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";

/** Espelha a tabela `cost_centers` (migration `version: 3`). */
export interface CostCenter {
  id: string;
  association_id: string;
  code: string | null;
  name: string;
  is_active: 0 | 1;
}

export interface NovoCentroCusto {
  name: string;
  code?: string | null;
}

export type AtualizacaoCentroCusto = Partial<NovoCentroCusto> & { is_active?: 0 | 1 };

/** Acesso à tabela `cost_centers`. */
export class CostCenterModel {
  static async list(): Promise<CostCenter[]> {
    const db = await getDatabase();
    return db.select<CostCenter[]>("SELECT * FROM cost_centers WHERE association_id = $1 ORDER BY name", [
      getCurrentAssociationId(),
    ]);
  }

  static async create(dados: NovoCentroCusto): Promise<CostCenter> {
    const associationId = getCurrentAssociationId();
    const db = await getDatabase();
    const id = newId();
    await db.execute(`INSERT INTO cost_centers (id, association_id, code, name) VALUES ($1, $2, $3, $4)`, [
      id,
      associationId,
      dados.code ?? null,
      dados.name,
    ]);

    const [criado] = await db.select<CostCenter[]>("SELECT * FROM cost_centers WHERE id = $1", [id]);
    return criado;
  }

  static async update(id: string, dados: AtualizacaoCentroCusto): Promise<void> {
    const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
    if (campos.length === 0) return;

    const db = await getDatabase();
    const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
    const valores = campos.map(([, valor]) => valor as string | number | null);

    await db.execute(`UPDATE cost_centers SET ${sets} WHERE id = $1`, [id, ...valores]);
  }
}
