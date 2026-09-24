import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { CashTransactionModel } from "./CashTransaction.js";
import { gerarParcelasIguais } from "../utils/installments.js";
import { comAtividade } from "./ActivityLog.js";
import { formatarMoeda } from "../utils/format.js";

export type StatusPayable = "ABERTA" | "APROVACAO_PENDENTE" | "PARCIAL" | "PAGA" | "CANCELADA";
export type StatusPayableInstallment = "ABERTA" | "PARCIAL" | "PAGA" | "CANCELADA";

/** Espelha a tabela `payables` (migration `version: 4`). */
export interface Payable {
  id: string;
  association_id: string;
  payee_id: string | null;
  description: string;
  document_number: string | null;
  issue_date: string | null;
  total_amount: number;
  financial_category_id: string | null;
  cost_center_id: string | null;
  status: StatusPayable;
  /** Soltos, sem FK: `projects` (Fase 2) e `documents` (Etapa 7) não existem ainda. */
  project_id: string | null;
  document_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PayableComFornecedor extends Payable {
  payee_name: string | null;
}

/** Espelha a tabela `payable_installments`. */
export interface PayableInstallment {
  id: string;
  payable_id: string;
  installment_number: number;
  due_date: string;
  original_amount: number;
  discount_amount: number;
  interest_amount: number;
  paid_amount: number;
  status: StatusPayableInstallment;
  paid_at: string | null;
}

export interface NovaContaPagar {
  payee_id?: string | null;
  description: string;
  document_number?: string | null;
  issue_date?: string | null;
  total_amount: number;
  financial_category_id?: string | null;
  cost_center_id?: string | null;
  /** Número de parcelas mensais iguais a gerar (mínimo 1). */
  installments: number;
  first_due_date: string;
}

export interface BaixaParcela {
  financial_account_id: string;
  payment_date: string;
  /** Valor pago em centavos; por padrão, quita o saldo restante da parcela. */
  amount?: number;
  payment_method_id?: string | null;
}

const SELECT_COM_FORNECEDOR = `
  SELECT p.*, pe.name AS payee_name
  FROM payables p
  LEFT JOIN payees pe ON pe.id = p.payee_id
`;

/** Acesso às tabelas `payables`/`payable_installments`/`payable_payments`. */
export class PayableModel {
  static async list(): Promise<PayableComFornecedor[]> {
    const db = await getDatabase();
    return db.select<PayableComFornecedor[]>(
      `${SELECT_COM_FORNECEDOR} WHERE p.association_id = $1 ORDER BY p.created_at DESC`,
      [getCurrentAssociationId()]
    );
  }

  static async get(id: string): Promise<Payable | null> {
    const db = await getDatabase();
    const rows = await db.select<Payable[]>("SELECT * FROM payables WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  static async installments(payableId: string): Promise<PayableInstallment[]> {
    const db = await getDatabase();
    return db.select<PayableInstallment[]>(
      "SELECT * FROM payable_installments WHERE payable_id = $1 ORDER BY installment_number",
      [payableId]
    );
  }

  static async create(dados: NovaContaPagar): Promise<Payable> {
    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();
        const db = await getDatabase();
        const id = newId();

        await db.execute(
          `INSERT INTO payables (id, association_id, payee_id, description, document_number, issue_date, total_amount, financial_category_id, cost_center_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            associationId,
            dados.payee_id ?? null,
            dados.description,
            dados.document_number ?? null,
            dados.issue_date ?? null,
            dados.total_amount,
            dados.financial_category_id ?? null,
            dados.cost_center_id ?? null,
          ]
        );

        const parcelas = gerarParcelasIguais(dados.total_amount, dados.installments, dados.first_due_date);
        for (const parcela of parcelas) {
          await db.execute(
            `INSERT INTO payable_installments (id, payable_id, installment_number, due_date, original_amount)
             VALUES ($1, $2, $3, $4, $5)`,
            [newId(), id, parcela.installment_number, parcela.due_date, parcela.original_amount]
          );
        }

        const [criada] = await db.select<Payable[]>("SELECT * FROM payables WHERE id = $1", [id]);
        return criada;
      },
      () => ({
        module: "FINANCEIRO",
        description: `Conta a pagar cadastrada — ${dados.description} — ${formatarMoeda(dados.total_amount)} em ${dados.installments}x`,
      })
    );
  }

  /**
   * Baixa (total ou parcial) de uma parcela: cria a `cash_transaction` de
   * despesa correspondente, registra em `payable_payments` e atualiza a
   * situação da parcela e da conta a pagar (ver
   * `docs/dominio-associacoes.md`, seção 2.5 e regra de baixa da seção 6).
   */
  static async payInstallment(installmentId: string, dados: BaixaParcela): Promise<void> {
    const db = await getDatabase();
    const [parcela] = await db.select<PayableInstallment[]>("SELECT * FROM payable_installments WHERE id = $1", [
      installmentId,
    ]);
    if (!parcela) throw new Error("Parcela não encontrada.");

    const payable = await PayableModel.get(parcela.payable_id);
    if (!payable) throw new Error("Conta a pagar não encontrada.");

    const restante = parcela.original_amount + parcela.interest_amount - parcela.discount_amount - parcela.paid_amount;
    const valorPago = dados.amount ?? restante;
    if (valorPago <= 0) throw new Error("Valor a pagar deve ser maior que zero.");
    if (valorPago > restante) throw new Error("Valor a pagar não pode ser maior que o saldo restante da parcela.");

    return comAtividade(
      async () => {
        const transacao = await CashTransactionModel.create({
          financial_account_id: dados.financial_account_id,
          transaction_type: "DESPESA",
          amount: valorPago,
          transaction_date: dados.payment_date,
          competence_date: dados.payment_date,
          description: `Pagamento ${parcela.installment_number}/${(await PayableModel.installments(payable.id)).length} — ${payable.description}`,
          financial_category_id: payable.financial_category_id,
          cost_center_id: payable.cost_center_id,
          payment_method_id: dados.payment_method_id ?? null,
          source_type: "PAYABLE_INSTALLMENT",
          source_id: installmentId,
        });

        await db.execute(
          `INSERT INTO payable_payments (id, payable_installment_id, cash_transaction_id, amount, paid_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [newId(), installmentId, transacao.id, valorPago, dados.payment_date]
        );

        const novoPago = parcela.paid_amount + valorPago;
        const quitada = novoPago >= parcela.original_amount + parcela.interest_amount - parcela.discount_amount;
        await db.execute("UPDATE payable_installments SET paid_amount = $2, status = $3, paid_at = $4 WHERE id = $1", [
          installmentId,
          novoPago,
          quitada ? "PAGA" : "PARCIAL",
          quitada ? dados.payment_date : null,
        ]);

        await PayableModel.refreshStatus(payable.id);
      },
      () => ({
        module: "FINANCEIRO",
        description: `Pagamento de conta — ${payable.description} — parcela ${parcela.installment_number} — ${formatarMoeda(valorPago)}`,
      })
    );
  }

  /** Recalcula `payables.status` a partir da situação de todas as parcelas. */
  static async refreshStatus(payableId: string): Promise<void> {
    const parcelas = await PayableModel.installments(payableId);
    const naoCanceladas = parcelas.filter((p) => p.status !== "CANCELADA");
    let novoStatus: StatusPayable;
    if (naoCanceladas.length === 0) {
      novoStatus = "CANCELADA";
    } else if (naoCanceladas.every((p) => p.status === "PAGA")) {
      novoStatus = "PAGA";
    } else if (naoCanceladas.some((p) => p.status === "PAGA" || p.status === "PARCIAL")) {
      novoStatus = "PARCIAL";
    } else {
      novoStatus = "ABERTA";
    }

    const db = await getDatabase();
    await db.execute("UPDATE payables SET status = $2 WHERE id = $1", [payableId, novoStatus]);
  }
}
