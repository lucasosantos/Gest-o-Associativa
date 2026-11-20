import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { SINAL_LANCAMENTO_SQL, type CashTransactionComNomes } from "./CashTransaction.js";
import { comAtividade, verboAtualizacao } from "./ActivityLog.js";

/** Espelha a tabela `financial_accounts` (migration `version: 3`). */
export interface FinancialAccount {
  id: string;
  association_id: string;
  name: string;
  account_type: string;
  bank_name: string | null;
  agency: string | null;
  account_number_masked: string | null;
  /** Centavos (ver convenção de dinheiro em `.claude/docs/plano-implementacao.md`). */
  opening_balance: number;
  opening_date: string;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
}

/** Conta com o saldo atual já calculado (ver `FinancialAccountModel.list`). */
export interface FinancialAccountComSaldo extends FinancialAccount {
  balance: number;
}

export interface NovaContaFinanceira {
  name: string;
  account_type: string;
  bank_name?: string | null;
  agency?: string | null;
  account_number_masked?: string | null;
  opening_balance?: number;
  opening_date?: string;
}

export type AtualizacaoContaFinanceira = Partial<NovaContaFinanceira> & { is_active?: 0 | 1 };

/**
 * O saldo de uma conta NUNCA é persistido — é sempre calculado a partir de
 * `opening_balance` + a soma assinada dos lançamentos confirmados (ver
 * decisão em `.claude/docs/plano-implementacao.md`, Etapa 3, para não haver saldo
 * divergente do que os lançamentos realmente somam).
 *
 * Um lançamento com `status = 'ESTORNADA'` continua contando com seu sinal
 * original (a reversão em si é o que cancela o efeito, como um novo
 * lançamento do tipo `ESTORNO` — nunca apagando ou zerando o original).
 */
const SELECT_COM_SALDO = `
  SELECT
    fa.*,
    fa.opening_balance + COALESCE(SUM(${SINAL_LANCAMENTO_SQL}), 0) AS balance
  FROM financial_accounts fa
  LEFT JOIN cash_transactions t
    ON t.financial_account_id = fa.id AND t.status IN ('CONFIRMADA', 'ESTORNADA')
  LEFT JOIN cash_transaction_reversals r ON r.reversal_transaction_id = t.id
  LEFT JOIN cash_transactions o ON o.id = r.original_transaction_id
`;

/** Um movimento do extrato, com o valor já assinado (ver `SINAL_LANCAMENTO_SQL`). */
export interface MovimentoExtrato extends CashTransactionComNomes {
  signed_amount: number;
}

/** Extrato de uma conta específica num período — uso no relatório de "resumo de conta" (`Financeiro.vue`, aba Relatórios). */
export interface ExtratoConta {
  /** Saldo em centavos no início do período (`opening_balance` + tudo antes de `dataInicio`). */
  saldo_inicial: number;
  movimentos: MovimentoExtrato[];
  /** `saldo_inicial` + soma assinada dos movimentos do período. */
  saldo_final: number;
}

/** Acesso à tabela `financial_accounts`. */
export class FinancialAccountModel {
  static async list(): Promise<FinancialAccountComSaldo[]> {
    const db = await getDatabase();
    return db.select<FinancialAccountComSaldo[]>(
      `${SELECT_COM_SALDO} WHERE fa.association_id = $1 GROUP BY fa.id ORDER BY fa.name`,
      [getCurrentAssociationId()]
    );
  }

  static async get(id: string): Promise<FinancialAccountComSaldo | null> {
    const db = await getDatabase();
    const rows = await db.select<FinancialAccountComSaldo[]>(`${SELECT_COM_SALDO} WHERE fa.id = $1 GROUP BY fa.id`, [
      id,
    ]);
    return rows[0] ?? null;
  }

  static async create(dados: NovaContaFinanceira): Promise<FinancialAccount> {
    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();
        const db = await getDatabase();
        const id = newId();
        await db.execute(
          `INSERT INTO financial_accounts
             (id, association_id, name, account_type, bank_name, agency, account_number_masked, opening_balance, opening_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, date('now', 'localtime')))`,
          [
            id,
            associationId,
            dados.name,
            dados.account_type,
            dados.bank_name ?? null,
            dados.agency ?? null,
            dados.account_number_masked ?? null,
            dados.opening_balance ?? 0,
            dados.opening_date ?? null,
          ]
        );

        const [criada] = await db.select<FinancialAccount[]>("SELECT * FROM financial_accounts WHERE id = $1", [id]);
        return criada;
      },
      (criado) => ({
        module: "FINANCEIRO",
        description: `Conta financeira cadastrada — ${criado.name}`,
      })
    );
  }

  static async update(id: string, dados: AtualizacaoContaFinanceira): Promise<void> {
    const [atual] = await (await getDatabase()).select<{ name: string }[]>("SELECT name FROM financial_accounts WHERE id = $1", [id]);

    return comAtividade(
      async () => {
        const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
        if (campos.length === 0) return;

        const db = await getDatabase();
        const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
        const valores = campos.map(([, valor]) => valor as string | number | null);

        await db.execute(`UPDATE financial_accounts SET ${sets} WHERE id = $1`, [id, ...valores]);
      },
      () => ({
        module: "FINANCEIRO",
        description: `Conta financeira ${verboAtualizacao(dados, "a")} — ${dados.name ?? atual?.name ?? id}`,
      })
    );
  }

  /**
   * Troca o nome da conta, com motivo obrigatório que vai pra Atividades
   * junto com o nome antigo (o `update` genérico não registra nenhum dos
   * dois). Lançamentos ligam pela conta (`financial_account_id`), não pelo
   * nome — extratos e relatórios passam a mostrar o nome novo sozinhos.
   * Nome repetido na associação é barrado com mensagem clara (a tabela tem
   * `UNIQUE(association_id, name)`, que barraria de qualquer jeito).
   */
  static async renomear(id: string, novoNome: string, motivo: string): Promise<void> {
    const nome = novoNome.trim();
    const justificativa = motivo.trim();
    if (!nome) throw new Error("Informe o novo nome da conta.");
    if (!justificativa) throw new Error("Informe o motivo da troca de nome.");

    const db = await getDatabase();
    const [atual] = await db.select<{ name: string; association_id: string }[]>(
      "SELECT name, association_id FROM financial_accounts WHERE id = $1",
      [id]
    );
    if (!atual) throw new Error("Conta financeira não encontrada.");
    if (atual.association_id !== getCurrentAssociationId()) {
      throw new Error("Esta conta não pertence à associação ativa.");
    }
    if (atual.name === nome) throw new Error("O nome não mudou.");

    const [{ total }] = await db.select<{ total: number }[]>(
      "SELECT COUNT(*) AS total FROM financial_accounts WHERE association_id = $1 AND name = $2 AND id <> $3",
      [atual.association_id, nome, id]
    );
    if (total > 0) throw new Error(`Já existe uma conta chamada "${nome}".`);

    await comAtividade(
      async () => {
        await db.execute("UPDATE financial_accounts SET name = $2 WHERE id = $1", [id, nome]);
      },
      () => ({
        module: "FINANCEIRO",
        description: `Conta financeira renomeada — "${atual.name}" → "${nome}" — motivo: ${justificativa}`,
      })
    );
  }

  /**
   * Saldo inicial (`opening_balance` + tudo confirmado ANTES de `dataInicio`),
   * movimentos do período e saldo final — mesma lógica de sinal do saldo
   * atual (`SELECT_COM_SALDO`), só filtrada por data em vez de somar tudo.
   */
  static async extrato(accountId: string, dataInicio: string, dataFim: string): Promise<ExtratoConta> {
    const db = await getDatabase();

    const [conta] = await db.select<{ opening_balance: number }[]>(
      "SELECT opening_balance FROM financial_accounts WHERE id = $1",
      [accountId]
    );
    if (!conta) throw new Error("Conta financeira não encontrada.");

    const [{ soma_anterior }] = await db.select<{ soma_anterior: number | null }[]>(
      `SELECT COALESCE(SUM(${SINAL_LANCAMENTO_SQL}), 0) AS soma_anterior
       FROM cash_transactions t
       LEFT JOIN cash_transaction_reversals r ON r.reversal_transaction_id = t.id
       LEFT JOIN cash_transactions o ON o.id = r.original_transaction_id
       WHERE t.financial_account_id = $1 AND t.status IN ('CONFIRMADA', 'ESTORNADA')
         AND t.transaction_date < $2`,
      [accountId, dataInicio]
    );

    const movimentos = await db.select<MovimentoExtrato[]>(
      `SELECT t.*, fa.name AS account_name, fc.name AS category_name, cc.name AS cost_center_name,
              pm.name AS payment_method_name, (${SINAL_LANCAMENTO_SQL}) AS signed_amount
       FROM cash_transactions t
       JOIN financial_accounts fa ON fa.id = t.financial_account_id
       LEFT JOIN financial_categories fc ON fc.id = t.financial_category_id
       LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
       LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
       LEFT JOIN cash_transaction_reversals r ON r.reversal_transaction_id = t.id
       LEFT JOIN cash_transactions o ON o.id = r.original_transaction_id
       WHERE t.financial_account_id = $1 AND t.status IN ('CONFIRMADA', 'ESTORNADA')
         AND t.transaction_date BETWEEN $2 AND $3
       ORDER BY t.transaction_date, t.created_at, t.id`,
      [accountId, dataInicio, dataFim]
    );

    const saldoInicial = conta.opening_balance + (soma_anterior ?? 0);
    // Saldo da conta logo depois de cada movimento (coluna "Saldo após").
    let saldo = saldoInicial;
    const comSaldo = movimentos.map((m) => ({ ...m, saldo_apos: (saldo += m.signed_amount) }));

    return { saldo_inicial: saldoInicial, movimentos: comSaldo, saldo_final: saldo };
  }
}
