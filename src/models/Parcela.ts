import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { competenciaAtual, proximaCompetencia } from "../utils/format.js";
import { AssociationModel } from "./Association.js";

/**
 * Espelha a tabela `parcelas` (migration `version: 10`): calendário de
 * competências (mês/ano) da associação, SEM sócio. Quem deve o quê é
 * calculado cruzando isso com `membership_payments` (migration
 * `version: 13`, ver `MembershipPaymentModel`) — nunca fica gravado aqui.
 */
export interface Parcela {
  id: string;
  association_id: string;
  /** ISO `"AAAA-MM-01"` (sempre dia 1). */
  competence_month: string;
  created_at: string;
}

/**
 * Marco inicial do calendário de parcelas (`ParcelaModel.ensureAteMesAtual`):
 * a fundação da associação — ou, se não preenchida, só o mês atual (nada
 * pra trás).
 */
export async function marcoInicial(): Promise<string> {
  const associationId = getCurrentAssociationId();

  const associacao = await AssociationModel.get(associationId);
  if (associacao?.foundation_date) {
    const [ano, mes] = associacao.foundation_date.split("-");
    return `${ano}-${mes}-01`;
  }

  return competenciaAtual();
}

/** Acesso à tabela `parcelas`. */
export class ParcelaModel {
  static async list(): Promise<Parcela[]> {
    const db = await getDatabase();
    return db.select<Parcela[]>("SELECT * FROM parcelas WHERE association_id = $1 ORDER BY competence_month", [
      getCurrentAssociationId(),
    ]);
  }

  /** Busca a parcela da competência, criando se ainda não existir (idempotente). */
  static async getOrCreate(competenceMonth: string): Promise<Parcela> {
    const associationId = getCurrentAssociationId();
    const db = await getDatabase();

    const existentes = await db.select<Parcela[]>(
      "SELECT * FROM parcelas WHERE association_id = $1 AND competence_month = $2",
      [associationId, competenceMonth]
    );
    if (existentes[0]) return existentes[0];

    const id = newId();
    await db.execute("INSERT INTO parcelas (id, association_id, competence_month) VALUES ($1, $2, $3)", [
      id,
      associationId,
      competenceMonth,
    ]);

    const [criada] = await db.select<Parcela[]>("SELECT * FROM parcelas WHERE id = $1", [id]);
    return criada;
  }

  /**
   * Garante que existe uma parcela pra cada mês desde o marco (ver
   * `marcoInicial`) até o mês atual. Chamada ao selecionar a associação
   * (ver `useCurrentAssociation.ts`): é o ponto mais próximo de "iniciar o
   * app" que existe, já que cada banco só fica acessível depois que o
   * usuário escolhe a associação.
   */
  static async ensureAteMesAtual(): Promise<void> {
    const mesAtual = competenciaAtual();
    const associationId = getCurrentAssociationId();

    const [{ max_competencia: maxCompetencia }] = await (await getDatabase()).select<
      { max_competencia: string | null }[]
    >("SELECT MAX(competence_month) AS max_competencia FROM parcelas WHERE association_id = $1", [associationId]);

    // Já está em dia — caminho rápido, sem varrer nada.
    if (maxCompetencia && maxCompetencia >= mesAtual) return;

    const marco = maxCompetencia ? proximaCompetencia(maxCompetencia) : await marcoInicial();

    for (let competencia = marco; competencia <= mesAtual; competencia = proximaCompetencia(competencia)) {
      await ParcelaModel.getOrCreate(competencia);
    }
  }
}
