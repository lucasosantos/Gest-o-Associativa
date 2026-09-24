import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { comAtividade } from "./ActivityLog.js";

/** Situação cadastral da associação (ver docs/dominio-associacoes.md, seção 4.1). */
export type StatusAssociacao = "ATIVA" | "INATIVA" | "ENCERRADA";

/**
 * `UNICO`: todo sócio deve o mesmo valor (`monthly_contribution_amount`).
 * `MULTIPLO`: cada sócio é vinculado a um plano (`MembershipPlanModel`,
 * `members.membership_plan_id`), e o valor sugerido nos pagamentos vem de
 * lá — ver `MembershipPaymentModel.valorMensalSugerido` (migration `version: 20`).
 */
export type MembershipMode = "UNICO" | "MULTIPLO";

/** Espelha a tabela `associations` (migration `version: 1` em `src-tauri/src/lib.rs`). */
export interface Association {
  id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string | null;
  foundation_date: string | null;
  status: StatusAssociacao;
  email: string | null;
  phone: string | null;
  website: string | null;
  /**
   * Valor único de contribuição mensal, em centavos, e dia de vencimento —
   * substituem os planos de mensalidade (migration `version: 11`). Usado
   * pelo `MembershipPaymentModel` só como valor sugerido/pra calcular
   * vencimento — desde a `version: 13` não existe cobrança pré-gerada
   * nenhuma, então `null` aqui não bloqueia nada, só deixa o valor
   * sugerido em zero até alguém preencher.
   */
  monthly_contribution_amount: number | null;
  monthly_contribution_due_day: number | null;
  /** Modo de mensalidade — ver `MembershipMode` (migration `version: 20`). */
  membership_mode: MembershipMode;
  /**
   * Numeração automática de matrícula (migration `version: 21`). `0` = o
   * usuário digita a matrícula no cadastro de sócio, como sempre foi; `1` =
   * `MemberModel.create` ignora o que vier do formulário e gera sozinho via
   * `AssociationModel.proximaMatricula`.
   */
  auto_registration_number: 0 | 1;
  /**
   * Contador atômico usado por `AssociationModel.proximaMatricula` — mesmo
   * padrão de `ProtocolBook.next_number`. Só é lido/gravado quando
   * `auto_registration_number` está ligado; nunca deve ser editado
   * manualmente fora dali.
   */
  next_registration_number: number;
  /**
   * Meses mínimos de filiação (a partir de `members.association_date`) pra o
   * sócio aparecer na lista de aptos a votar — ver
   * `MemberModel.listarAptosAVotar` (migration `version: 23`). `0` = sem carência.
   */
  voting_min_membership_months: number;
  /** JSON serializado manualmente — SQLite não tem tipo JSONB nativo. */
  settings: string;
  created_at: string;
  updated_at: string;
}

export interface NovaAssociacao {
  legal_name: string;
  trade_name?: string | null;
  cnpj?: string | null;
  foundation_date?: string | null;
  status?: StatusAssociacao;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  monthly_contribution_amount?: number | null;
  monthly_contribution_due_day?: number | null;
  membership_mode?: MembershipMode;
  /** SQLite não tem booleano nativo: 0 = manual, 1 = automática. */
  auto_registration_number?: 0 | 1;
  voting_min_membership_months?: number;
}

export type AtualizacaoAssociacao = Partial<NovaAssociacao>;

/**
 * Acesso à tabela `associations`.
 *
 * O app suporta várias associações no mesmo arquivo `.db` — qual delas está
 * "ativa" é escolhido pelo usuário no dropdown da tela Início e mantido em
 * `useCurrentAssociation.ts` (persistido em `localStorage`, não no banco).
 * Este model só cuida do CRUD da tabela; a seleção de qual é a atual vive na
 * composable.
 */
export class AssociationModel {
  static async list(): Promise<Association[]> {
    const db = await getDatabase();
    return db.select<Association[]>("SELECT * FROM associations ORDER BY legal_name");
  }

  static async get(id: string): Promise<Association | null> {
    const db = await getDatabase();
    const rows = await db.select<Association[]>("SELECT * FROM associations WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  static async create(dados: NovaAssociacao): Promise<Association> {
    return comAtividade(
      async () => {
        const db = await getDatabase();
        const id = newId();
        await db.execute(
          `INSERT INTO associations
             (id, legal_name, trade_name, cnpj, foundation_date, status, email, phone, website,
              monthly_contribution_amount, monthly_contribution_due_day, membership_mode, auto_registration_number,
              voting_min_membership_months)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            id,
            dados.legal_name,
            dados.trade_name ?? null,
            dados.cnpj ?? null,
            dados.foundation_date ?? null,
            dados.status ?? "ATIVA",
            dados.email ?? null,
            dados.phone ?? null,
            dados.website ?? null,
            dados.monthly_contribution_amount ?? null,
            dados.monthly_contribution_due_day ?? null,
            dados.membership_mode ?? "UNICO",
            dados.auto_registration_number ?? 0,
            dados.voting_min_membership_months ?? 0,
          ]
        );

        const [criada] = await db.select<Association[]>("SELECT * FROM associations WHERE id = $1", [id]);
        return criada;
      },
      (criada) => ({
        association_id: criada.id,
        module: "INSTITUICAO",
        description: `Associação cadastrada — ${criada.legal_name}`,
      })
    );
  }

  /**
   * Gera o próximo número de matrícula, de forma atômica: incrementa
   * `next_registration_number` e retorna o valor anterior (mesmo padrão de
   * `protocol_books.next_number`/`ProtocolEntryModel.create` — `UPDATE ...
   * RETURNING`, SQLite ≥ 3.35). Só deve ser chamada quando
   * `auto_registration_number` está ligado; quem decide isso é
   * `MemberModel.create`.
   */
  static async proximaMatricula(associationId: string): Promise<string> {
    const db = await getDatabase();
    const [{ numero }] = await db.select<{ numero: number }[]>(
      "UPDATE associations SET next_registration_number = next_registration_number + 1 WHERE id = $1 RETURNING next_registration_number - 1 AS numero",
      [associationId]
    );
    return String(numero);
  }

  static async update(id: string, dados: AtualizacaoAssociacao): Promise<void> {
    return comAtividade(
      async () => {
        const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
        if (campos.length === 0) return;

        const db = await getDatabase();
        const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
        const valores = campos.map(([, valor]) => valor as string | number | null);

        await db.execute(`UPDATE associations SET ${sets} WHERE id = $1`, [id, ...valores]);
      },
      () => ({
        association_id: id,
        module: "INSTITUICAO",
        description: "Dados institucionais alterados",
      })
    );
  }
}
