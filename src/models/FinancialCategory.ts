import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { comAtividade, verboAtualizacao } from "./ActivityLog.js";

/** Tipo de categoria do plano de contas (ver migration `version: 3`). */
export type TipoCategoria = "RECEITA" | "DESPESA" | "TRANSFERENCIA";

/** Espelha a tabela `financial_categories`. `parent_id` permite hierarquia
 * (ex.: "Receitas" > "Mensalidades"). */
export interface FinancialCategory {
  id: string;
  association_id: string;
  parent_id: string | null;
  code: string | null;
  name: string;
  category_type: TipoCategoria;
  is_active: 0 | 1;
}

export interface NovaCategoria {
  name: string;
  category_type: TipoCategoria;
  parent_id?: string | null;
  code?: string | null;
}

export type AtualizacaoCategoria = Partial<NovaCategoria> & { is_active?: 0 | 1 };

/** Acesso à tabela `financial_categories`. */
export class FinancialCategoryModel {
  static async list(): Promise<FinancialCategory[]> {
    const db = await getDatabase();
    return db.select<FinancialCategory[]>("SELECT * FROM financial_categories WHERE association_id = $1 ORDER BY name", [
      getCurrentAssociationId(),
    ]);
  }

  static async create(dados: NovaCategoria): Promise<FinancialCategory> {
    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();
        const db = await getDatabase();
        const id = newId();
        await db.execute(
          `INSERT INTO financial_categories (id, association_id, parent_id, code, name, category_type)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, associationId, dados.parent_id ?? null, dados.code ?? null, dados.name, dados.category_type]
        );

        const [criada] = await db.select<FinancialCategory[]>("SELECT * FROM financial_categories WHERE id = $1", [id]);
        return criada;
      },
      (criado) => ({
        module: "FINANCEIRO",
        description: `Categoria financeira cadastrada — ${criado.name}`,
      })
    );
  }

  static async update(id: string, dados: AtualizacaoCategoria): Promise<void> {
    const [atual] = await (await getDatabase()).select<{ name: string }[]>("SELECT name FROM financial_categories WHERE id = $1", [id]);

    return comAtividade(
      async () => {
        const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
        if (campos.length === 0) return;

        const db = await getDatabase();
        const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
        const valores = campos.map(([, valor]) => valor as string | number | null);

        await db.execute(`UPDATE financial_categories SET ${sets} WHERE id = $1`, [id, ...valores]);
      },
      () => ({
        module: "FINANCEIRO",
        description: `Categoria financeira ${verboAtualizacao(dados, "a")} — ${dados.name ?? atual?.name ?? id}`,
      })
    );
  }
}
