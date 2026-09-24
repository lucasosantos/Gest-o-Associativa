import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { comAtividade, nomeDaPessoa, nomeDoSocio } from "./ActivityLog.js";

/** Espelha a tabela `member_representatives` (migration `version: 2`).
 * Responsável ou representante do sócio (ex.: cônjuge, tutor). */
export interface MemberRepresentative {
  id: string;
  member_id: string;
  person_id: string;
  relationship: string;
  start_date: string | null;
  end_date: string | null;
}

export interface NovoRepresentante {
  member_id: string;
  person_id: string;
  relationship: string;
  start_date?: string | null;
  end_date?: string | null;
}

export type AtualizacaoRepresentante = Partial<Pick<NovoRepresentante, "relationship" | "start_date" | "end_date">>;

/** Acesso à tabela `member_representatives`. */
export class MemberRepresentativeModel {
  static async listByMember(memberId: string): Promise<MemberRepresentative[]> {
    const db = await getDatabase();
    return db.select<MemberRepresentative[]>(
      "SELECT * FROM member_representatives WHERE member_id = $1",
      [memberId]
    );
  }

  static async create(dados: NovoRepresentante): Promise<MemberRepresentative> {
    return comAtividade(
      async () => {
        const db = await getDatabase();
        const id = newId();
        await db.execute(
          `INSERT INTO member_representatives (id, member_id, person_id, relationship, start_date, end_date)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, dados.member_id, dados.person_id, dados.relationship, dados.start_date ?? null, dados.end_date ?? null]
        );

        const [criado] = await db.select<MemberRepresentative[]>(
          "SELECT * FROM member_representatives WHERE id = $1",
          [id]
        );
        return criado;
      },
      async (rep) => ({
        module: "SOCIOS",
        description: `Representante ${await nomeDaPessoa(rep.person_id)} (${rep.relationship}) incluído — sócio ${await nomeDoSocio(rep.member_id)}`,
        entity_type: "MEMBER",
        entity_id: rep.member_id,
      })
    );
  }

  static async update(id: string, dados: AtualizacaoRepresentante): Promise<void> {
    const [rep] = await (await getDatabase()).select<MemberRepresentative[]>("SELECT * FROM member_representatives WHERE id = $1", [id]);
    if (!rep) throw new Error("Representante não encontrado.");

    return comAtividade(
      async () => {
        const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
        if (campos.length === 0) return;

        const db = await getDatabase();
        const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
        const valores = campos.map(([, valor]) => valor as string | null);

        await db.execute(`UPDATE member_representatives SET ${sets} WHERE id = $1`, [id, ...valores]);
      },
      async () => ({
        module: "SOCIOS",
        description: `Representante ${await nomeDaPessoa(rep.person_id)} alterado — sócio ${await nomeDoSocio(rep.member_id)}`,
        entity_type: "MEMBER",
        entity_id: rep.member_id,
      })
    );
  }

  static async remove(id: string): Promise<void> {
    const [rep] = await (await getDatabase()).select<MemberRepresentative[]>("SELECT * FROM member_representatives WHERE id = $1", [id]);
    if (!rep) throw new Error("Representante não encontrado.");

    return comAtividade(
      async () => {
        const db = await getDatabase();
        await db.execute("DELETE FROM member_representatives WHERE id = $1", [id]);
      },
      async () => ({
        module: "SOCIOS",
        description: `Representante ${await nomeDaPessoa(rep.person_id)} removido — sócio ${await nomeDoSocio(rep.member_id)}`,
        entity_type: "MEMBER",
        entity_id: rep.member_id,
      })
    );
  }
}
