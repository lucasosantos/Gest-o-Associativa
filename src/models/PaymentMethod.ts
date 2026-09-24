import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { comAtividade, verboAtualizacao } from "./ActivityLog.js";

/** Espelha a tabela `payment_methods` (migration `version: 3`). */
export interface PaymentMethod {
  id: string;
  association_id: string;
  name: string;
  method_type: string;
  is_active: 0 | 1;
}

export interface NovaFormaPagamento {
  name: string;
  method_type: string;
}

export type AtualizacaoFormaPagamento = Partial<NovaFormaPagamento> & { is_active?: 0 | 1 };

/** Acesso à tabela `payment_methods`. */
export class PaymentMethodModel {
  static async list(): Promise<PaymentMethod[]> {
    const db = await getDatabase();
    return db.select<PaymentMethod[]>("SELECT * FROM payment_methods WHERE association_id = $1 ORDER BY name", [
      getCurrentAssociationId(),
    ]);
  }

  static async create(dados: NovaFormaPagamento): Promise<PaymentMethod> {
    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();
        const db = await getDatabase();
        const id = newId();
        await db.execute(`INSERT INTO payment_methods (id, association_id, name, method_type) VALUES ($1, $2, $3, $4)`, [
          id,
          associationId,
          dados.name,
          dados.method_type,
        ]);

        const [criada] = await db.select<PaymentMethod[]>("SELECT * FROM payment_methods WHERE id = $1", [id]);
        return criada;
      },
      (criado) => ({
        module: "FINANCEIRO",
        description: `Forma de pagamento cadastrada — ${criado.name}`,
      })
    );
  }

  static async update(id: string, dados: AtualizacaoFormaPagamento): Promise<void> {
    const [atual] = await (await getDatabase()).select<{ name: string }[]>("SELECT name FROM payment_methods WHERE id = $1", [id]);

    return comAtividade(
      async () => {
        const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
        if (campos.length === 0) return;

        const db = await getDatabase();
        const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
        const valores = campos.map(([, valor]) => valor as string | number | null);

        await db.execute(`UPDATE payment_methods SET ${sets} WHERE id = $1`, [id, ...valores]);
      },
      () => ({
        module: "FINANCEIRO",
        description: `Forma de pagamento ${verboAtualizacao(dados, "a")} — ${dados.name ?? atual?.name ?? id}`,
      })
    );
  }
}
