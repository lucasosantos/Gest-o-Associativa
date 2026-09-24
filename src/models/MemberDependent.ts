import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { comAtividade, nomeDoSocio } from "./ActivityLog.js";

/** Espelha a tabela `member_dependents` (migration `version: 2`). Filhos e
 * demais dependentes de um sócio — vinculados a uma `Person` cadastrada ou,
 * na falta dela, só pelo nome (`dependent_name`). */
export interface MemberDependent {
  id: string;
  member_id: string;
  dependent_person_id: string | null;
  dependent_name: string | null;
  relationship: string;
  is_financial_dependent: 0 | 1;
  birth_date: string | null;
  observations: string | null;
}

export interface NovoDependente {
  member_id: string;
  dependent_person_id?: string | null;
  dependent_name?: string | null;
  relationship: string;
  is_financial_dependent?: 0 | 1;
  birth_date?: string | null;
  observations?: string | null;
}

export type AtualizacaoDependente = Partial<Omit<NovoDependente, "member_id">>;

/** Acesso à tabela `member_dependents`. */
export class MemberDependentModel {
  static async listByMember(memberId: string): Promise<MemberDependent[]> {
    const db = await getDatabase();
    return db.select<MemberDependent[]>(
      "SELECT * FROM member_dependents WHERE member_id = $1 ORDER BY dependent_name",
      [memberId]
    );
  }

  static async create(dados: NovoDependente): Promise<MemberDependent> {
    return comAtividade(
      async () => {
        if (!dados.dependent_person_id && !dados.dependent_name) {
          throw new Error("Informe a pessoa cadastrada ou o nome do dependente.");
        }

        const db = await getDatabase();
        const id = newId();
        await db.execute(
          `INSERT INTO member_dependents
             (id, member_id, dependent_person_id, dependent_name, relationship, is_financial_dependent, birth_date, observations)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            dados.member_id,
            dados.dependent_person_id ?? null,
            dados.dependent_name ?? null,
            dados.relationship,
            dados.is_financial_dependent ?? 0,
            dados.birth_date ?? null,
            dados.observations ?? null,
          ]
        );

        const [criado] = await db.select<MemberDependent[]>("SELECT * FROM member_dependents WHERE id = $1", [id]);
        return criado;
      },
      async (dep) => ({
        module: "SOCIOS",
        description: `Dependente ${dep.dependent_name ?? "sem nome"} incluído — sócio ${await nomeDoSocio(dep.member_id)}`,
        entity_type: "MEMBER",
        entity_id: dep.member_id,
      })
    );
  }

  static async update(id: string, dados: AtualizacaoDependente): Promise<void> {
    const [dep] = await (await getDatabase()).select<MemberDependent[]>("SELECT * FROM member_dependents WHERE id = $1", [id]);
    if (!dep) throw new Error("Dependente não encontrado.");

    return comAtividade(
      async () => {
        const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
        if (campos.length === 0) return;

        const db = await getDatabase();
        const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
        const valores = campos.map(([, valor]) => valor as string | number | null);

        await db.execute(`UPDATE member_dependents SET ${sets} WHERE id = $1`, [id, ...valores]);
      },
      async () => ({
        module: "SOCIOS",
        description: `Dependente ${dados.dependent_name ?? dep.dependent_name ?? "sem nome"} alterado — sócio ${await nomeDoSocio(dep.member_id)}`,
        entity_type: "MEMBER",
        entity_id: dep.member_id,
      })
    );
  }

  static async remove(id: string): Promise<void> {
    const [dep] = await (await getDatabase()).select<MemberDependent[]>("SELECT * FROM member_dependents WHERE id = $1", [id]);
    if (!dep) throw new Error("Dependente não encontrado.");

    return comAtividade(
      async () => {
        const db = await getDatabase();
        await db.execute("DELETE FROM member_dependents WHERE id = $1", [id]);
      },
      async () => ({
        module: "SOCIOS",
        description: `Dependente ${dep.dependent_name ?? "sem nome"} removido — sócio ${await nomeDoSocio(dep.member_id)}`,
        entity_type: "MEMBER",
        entity_id: dep.member_id,
      })
    );
  }
}
