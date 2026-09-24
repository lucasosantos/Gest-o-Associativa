import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { comAtividade } from "./ActivityLog.js";
import { formatarMoeda } from "../utils/format.js";

/** Tipo de movimento de caixa (ver migration `version: 3`). */
export type TipoLancamento = "RECEITA" | "DESPESA" | "TRANSFERENCIA_ENTRADA" | "TRANSFERENCIA_SAIDA" | "ESTORNO";

/** Situação do lançamento. */
export type StatusLancamento = "PENDENTE" | "CONFIRMADA" | "ESTORNADA" | "CANCELADA";

/** Espelha a tabela `cash_transactions`. */
export interface CashTransaction {
  id: string;
  association_id: string;
  financial_account_id: string;
  transaction_type: TipoLancamento;
  /** Centavos. */
  amount: number;
  transaction_date: string;
  competence_date: string;
  description: string;
  financial_category_id: string | null;
  cost_center_id: string | null;
  payment_method_id: string | null;
  /** Origem polimórfica (ex.: `MEMBERSHIP_CHARGE`) — sem FK real, validada em código. */
  source_type: string | null;
  source_id: string | null;
  transfer_group_id: string | null;
  status: StatusLancamento;
  document_id: string | null;
  /** Sempre `null`: o app não tem usuários (correção pós-MVP removeu usuários/perfis/auditoria). */
  created_by: string | null;
  created_at: string;
}

/** Lançamento com nomes já resolvidos, para exibição em lista. */
export interface CashTransactionComNomes extends CashTransaction {
  category_name: string | null;
  cost_center_name: string | null;
  payment_method_name: string | null;
}

/** Lançamento manual (receita ou despesa) — transferências e estornos têm métodos próprios. */
export interface NovoLancamento {
  financial_account_id: string;
  transaction_type: "RECEITA" | "DESPESA";
  amount: number;
  transaction_date: string;
  competence_date: string;
  description: string;
  financial_category_id?: string | null;
  cost_center_id?: string | null;
  payment_method_id?: string | null;
  /**
   * Origem polimórfica (ex.: `PAYABLE_INSTALLMENT`, `RECEIVABLE_INSTALLMENT`,
   * `DONATION`) — usada pelas baixas de contas a pagar/receber e doações
   * (Etapa 5) para rastrear de onde veio o lançamento. Sem FK real; cada
   * chamador deve usar um valor de uma lista fechada conhecida.
   */
  source_type?: string | null;
  source_id?: string | null;
}

export interface NovaTransferencia {
  from_account_id: string;
  to_account_id: string;
  amount: number;
  transaction_date: string;
  description: string;
}

/**
 * Valor de um lançamento já com o sinal do seu efeito no saldo — mesma
 * lógica usada em `FinancialAccountModel` pra calcular saldo de conta
 * (RECEITA/TRANSFERENCIA_ENTRADA soma, DESPESA/TRANSFERENCIA_SAIDA
 * subtrai, ESTORNO inverte o efeito do lançamento original). Extraída aqui
 * pra não duplicar a mesma `CASE` em cada relatório que precisa somar
 * lançamentos (prestação de contas, extrato de conta) — exige as mesmas
 * duas junções (`cash_transaction_reversals`/lançamento original) em
 * qualquer query que a use, ver `listarPorPeriodo` abaixo e
 * `FinancialAccountModel.extrato`.
 */
export const SINAL_LANCAMENTO_SQL = `
  CASE
    WHEN t.transaction_type IN ('RECEITA', 'TRANSFERENCIA_ENTRADA') THEN t.amount
    WHEN t.transaction_type IN ('DESPESA', 'TRANSFERENCIA_SAIDA') THEN -t.amount
    WHEN t.transaction_type = 'ESTORNO' THEN
      CASE o.transaction_type
        WHEN 'RECEITA' THEN -t.amount
        WHEN 'TRANSFERENCIA_ENTRADA' THEN -t.amount
        WHEN 'DESPESA' THEN t.amount
        WHEN 'TRANSFERENCIA_SAIDA' THEN t.amount
        ELSE 0
      END
    ELSE 0
  END
`;

const JUNCAO_SINAL_LANCAMENTO = `
  LEFT JOIN cash_transaction_reversals r ON r.reversal_transaction_id = t.id
  LEFT JOIN cash_transactions o ON o.id = r.original_transaction_id
`;

/** Lançamento com nomes resolvidos + o nome da conta + valor já assinado (ver `SINAL_LANCAMENTO_SQL`) — uso em relatórios que cruzam todas as contas (prestação de contas). */
export interface CashTransactionRelatorio extends CashTransactionComNomes {
  account_name: string;
  signed_amount: number;
}

const SELECT_COM_NOMES = `
  SELECT
    t.*,
    fc.name AS category_name,
    cc.name AS cost_center_name,
    pm.name AS payment_method_name
  FROM cash_transactions t
  LEFT JOIN financial_categories fc ON fc.id = t.financial_category_id
  LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
  LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
`;

/** Acesso à tabela `cash_transactions` e operações de negócio do caixa. */
export class CashTransactionModel {
  static async listByAccount(accountId: string): Promise<CashTransactionComNomes[]> {
    const db = await getDatabase();
    return db.select<CashTransactionComNomes[]>(
      `${SELECT_COM_NOMES} WHERE t.financial_account_id = $1 ORDER BY t.transaction_date DESC, t.created_at DESC`,
      [accountId]
    );
  }

  /**
   * Todos os lançamentos da associação (todas as contas) dentro de um
   * período — uso na prestação de contas (`Financeiro.vue`, aba
   * Relatórios). Totais (entradas/saídas/saldo do período) são somados em
   * JS a partir de `signed_amount` pelo chamador, sem agregação SQL extra
   * (volume baixo, mesmo espírito do resto do projeto).
   */
  static async listarPorPeriodo(dataInicio: string, dataFim: string): Promise<CashTransactionRelatorio[]> {
    const db = await getDatabase();
    return db.select<CashTransactionRelatorio[]>(
      `SELECT t.*, fc.name AS category_name, cc.name AS cost_center_name, pm.name AS payment_method_name,
              fa.name AS account_name, (${SINAL_LANCAMENTO_SQL}) AS signed_amount
       FROM cash_transactions t
       LEFT JOIN financial_categories fc ON fc.id = t.financial_category_id
       LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
       LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
       JOIN financial_accounts fa ON fa.id = t.financial_account_id
       ${JUNCAO_SINAL_LANCAMENTO}
       WHERE t.association_id = $1 AND t.status IN ('CONFIRMADA', 'ESTORNADA')
         AND t.transaction_date BETWEEN $2 AND $3
       ORDER BY t.transaction_date, t.created_at`,
      [getCurrentAssociationId(), dataInicio, dataFim]
    );
  }

  static async list(): Promise<CashTransactionComNomes[]> {
    const db = await getDatabase();
    return db.select<CashTransactionComNomes[]>(
      `${SELECT_COM_NOMES} WHERE t.association_id = $1 ORDER BY t.transaction_date DESC, t.created_at DESC`,
      [getCurrentAssociationId()]
    );
  }

  static async get(id: string): Promise<CashTransaction | null> {
    const db = await getDatabase();
    const rows = await db.select<CashTransaction[]>("SELECT * FROM cash_transactions WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  static async create(dados: NovoLancamento): Promise<CashTransaction> {
    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();
        const db = await getDatabase();
        const id = newId();
        await db.execute(
          `INSERT INTO cash_transactions
             (id, association_id, financial_account_id, transaction_type, amount, transaction_date, competence_date,
              description, financial_category_id, cost_center_id, payment_method_id, source_type, source_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            id,
            associationId,
            dados.financial_account_id,
            dados.transaction_type,
            dados.amount,
            dados.transaction_date,
            dados.competence_date,
            dados.description,
            dados.financial_category_id ?? null,
            dados.cost_center_id ?? null,
            dados.payment_method_id ?? null,
            dados.source_type ?? null,
            dados.source_id ?? null,
          ]
        );

        const [criado] = await db.select<CashTransaction[]>("SELECT * FROM cash_transactions WHERE id = $1", [id]);
        return criado;
      },
      (lancamento) => ({
        module: "FINANCEIRO",
        description: `${dados.transaction_type === "RECEITA" ? "Receita" : "Despesa"} lançada — ${dados.description} — ${formatarMoeda(dados.amount)}`,
        entity_type: "CASH_TRANSACTION",
        entity_id: lancamento.id,
      })
    );
  }

  /**
   * Transferência entre contas da própria associação: gera dois lançamentos
   * vinculados por um mesmo `transfer_group_id` — uma saída na origem, uma
   * entrada no destino. Não entram como receita/despesa operacional nos
   * relatórios (ver `docs/dominio-associacoes.md`, seção 2.4).
   */
  static async transfer(dados: NovaTransferencia): Promise<void> {
    if (dados.from_account_id === dados.to_account_id) {
      throw new Error("A conta de origem e a de destino não podem ser a mesma.");
    }

    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();
        const db = await getDatabase();
        const grupo = newId();

        await db.execute(
          `INSERT INTO cash_transactions
             (id, association_id, financial_account_id, transaction_type, amount, transaction_date, competence_date, description, transfer_group_id)
           VALUES ($1, $2, $3, 'TRANSFERENCIA_SAIDA', $4, $5, $5, $6, $7)`,
          [newId(), associationId, dados.from_account_id, dados.amount, dados.transaction_date, dados.description, grupo]
        );

        await db.execute(
          `INSERT INTO cash_transactions
             (id, association_id, financial_account_id, transaction_type, amount, transaction_date, competence_date, description, transfer_group_id)
           VALUES ($1, $2, $3, 'TRANSFERENCIA_ENTRADA', $4, $5, $5, $6, $7)`,
          [newId(), associationId, dados.to_account_id, dados.amount, dados.transaction_date, dados.description, grupo]
        );
      },
      () => ({
        module: "FINANCEIRO",
        description: `Transferência entre contas — ${dados.description} — ${formatarMoeda(dados.amount)}`,
      })
    );
  }

  /**
   * Estorna um lançamento: cria um novo lançamento do tipo `ESTORNO` com o
   * efeito inverso e marca o original como `ESTORNADA` — nunca apaga nem
   * altera o valor do registro original (ver `docs/dominio-associacoes.md`,
   * seção 6, regra de estorno). Um lançamento só pode ser estornado uma vez
   * (garantido por `UNIQUE(original_transaction_id)` em
   * `cash_transaction_reversals`).
   */
  static async reverse(id: string, reason?: string | null): Promise<void> {
    const original = await CashTransactionModel.get(id);
    if (!original) throw new Error("Lançamento não encontrado.");
    if (original.status !== "CONFIRMADA") {
      throw new Error("Só é possível estornar um lançamento confirmado.");
    }
    if (original.transaction_type === "ESTORNO") {
      throw new Error("Um estorno não pode ser estornado.");
    }

    return comAtividade(
      async () => {
        const db = await getDatabase();
        const reversalId = newId();

        await db.execute(
          `INSERT INTO cash_transactions
             (id, association_id, financial_account_id, transaction_type, amount, transaction_date, competence_date,
              description, source_type, source_id)
           VALUES ($1, $2, $3, 'ESTORNO', $4, $5, $5, $6, 'CASH_TRANSACTION_REVERSAL', $7)`,
          [
            reversalId,
            original.association_id,
            original.financial_account_id,
            original.amount,
            new Date().toISOString().slice(0, 10),
            `Estorno de: ${original.description}`,
            original.id,
          ]
        );

        await db.execute("UPDATE cash_transactions SET status = 'ESTORNADA' WHERE id = $1", [id]);

        await db.execute(
          `INSERT INTO cash_transaction_reversals (id, original_transaction_id, reversal_transaction_id, reason)
           VALUES ($1, $2, $3, $4)`,
          [newId(), id, reversalId, reason ?? null]
        );
      },
      () => ({
        module: "FINANCEIRO",
        description: `Lançamento estornado — ${original.description} — ${formatarMoeda(original.amount)}${
          reason ? ` (motivo: ${reason})` : ""
        }`,
        entity_type: "CASH_TRANSACTION",
        entity_id: id,
      })
    );
  }
}
