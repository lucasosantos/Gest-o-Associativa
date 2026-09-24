import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { comAtividade, verboAtualizacao } from "./ActivityLog.js";

/**
 * Espelha a tabela `membership_plans` (migration `version: 20`) — plano de
 * mensalidade, só usado quando a associação está no modo "Múltiplos planos"
 * (`Association.membership_mode`, ver `InstitutionalDataEditor.vue`). No
 * modo "Plano único" o valor vem direto de
 * `Association.monthly_contribution_amount`, sem nenhuma linha aqui.
 * Cada sócio é vinculado a um plano (`members.membership_plan_id`) na
 * própria ficha (`SocioForm.vue`).
 */
export interface MembershipPlan {
  id: string;
  association_id: string;
  name: string;
  description: string | null;
  /** Valor da mensalidade do plano, em centavos. */
  amount: number;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface NovoPlano {
  name: string;
  description?: string | null;
  amount: number;
}

export type AtualizacaoPlano = Partial<NovoPlano>;

/** Acesso à tabela `membership_plans`. */
export class MembershipPlanModel {
  static async list(): Promise<MembershipPlan[]> {
    const db = await getDatabase();
    return db.select<MembershipPlan[]>("SELECT * FROM membership_plans WHERE association_id = $1 ORDER BY name", [
      getCurrentAssociationId(),
    ]);
  }

  static async listActive(): Promise<MembershipPlan[]> {
    const db = await getDatabase();
    return db.select<MembershipPlan[]>(
      "SELECT * FROM membership_plans WHERE association_id = $1 AND is_active = 1 ORDER BY name",
      [getCurrentAssociationId()]
    );
  }

  static async create(dados: NovoPlano): Promise<MembershipPlan> {
    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();
        const db = await getDatabase();
        const id = newId();
        await db.execute(
          `INSERT INTO membership_plans (id, association_id, name, description, amount)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, associationId, dados.name, dados.description ?? null, dados.amount]
        );

        const [criado] = await db.select<MembershipPlan[]>("SELECT * FROM membership_plans WHERE id = $1", [id]);
        return criado;
      },
      (criado) => ({
        module: "MENSALIDADES",
        description: `Plano de mensalidade cadastrado — ${criado.name}`,
      })
    );
  }

  static async update(id: string, dados: AtualizacaoPlano): Promise<void> {
    const [atual] = await (await getDatabase()).select<{ name: string }[]>("SELECT name FROM membership_plans WHERE id = $1", [id]);

    return comAtividade(
      async () => {
        const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
        if (campos.length === 0) return;

        const db = await getDatabase();
        const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
        const valores = campos.map(([, valor]) => valor as string | number | null);
        await db.execute(`UPDATE membership_plans SET ${sets} WHERE id = $1`, [id, ...valores]);
      },
      () => ({
        module: "MENSALIDADES",
        description: `Plano de mensalidade ${verboAtualizacao(dados, "o")} — ${dados.name ?? atual?.name ?? id}`,
      })
    );
  }

  static async setActive(id: string, ativo: boolean): Promise<void> {
    const [atual] = await (await getDatabase()).select<{ name: string }[]>("SELECT name FROM membership_plans WHERE id = $1", [id]);

    return comAtividade(
      async () => {
        const db = await getDatabase();
        await db.execute("UPDATE membership_plans SET is_active = $2 WHERE id = $1", [id, ativo ? 1 : 0]);
      },
      () => ({
        module: "MENSALIDADES",
        description: `Plano de mensalidade ${ativo ? "reativado" : "desativado"} — ${atual?.name ?? id}`,
      })
    );
  }

  /**
   * Valor mensal esperado de um sócio específico, em centavos — plano
   * vinculado a ele (`members.membership_plan_id`), ou 0 se ele não tiver
   * plano vinculado (ou o plano vinculado tiver sido desativado depois).
   * Uso interno de `MembershipPaymentModel.valorMensalSugerido` — só faz
   * sentido no modo "Múltiplos planos".
   */
  static async valorDoSocio(memberId: string): Promise<number> {
    const db = await getDatabase();
    const rows = await db.select<{ amount: number }[]>(
      `SELECT mp.amount AS amount
       FROM members m
       JOIN membership_plans mp ON mp.id = m.membership_plan_id
       WHERE m.id = $1 AND mp.is_active = 1`,
      [memberId]
    );
    return rows[0]?.amount ?? 0;
  }
}
