import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { CashTransactionModel } from "./CashTransaction.js";
import { gerarParcelasIguais } from "../utils/installments.js";

export type StatusReceivable = "ABERTA" | "PARCIAL" | "RECEBIDA" | "CANCELADA";
export type StatusReceivableInstallment = "ABERTA" | "PARCIAL" | "RECEBIDA" | "CANCELADA";

/** Espelha a tabela `receivables` (migration `version: 4`). */
export interface Receivable {
  id: string;
  association_id: string;
  payer_id: string | null;
  member_id: string | null;
  description: string;
  /** Ex.: `EVENTO`, `CONVENIO`, `ALUGUEL` — sem FK real, valor livre. */
  source_type: string | null;
  total_amount: number;
  financial_category_id: string | null;
  cost_center_id: string | null;
  status: StatusReceivable;
  document_id: string | null;
  created_at: string;
}

export interface ReceivableComOrigem extends Receivable {
  payer_name: string | null;
  member_name: string | null;
}

/** Espelha a tabela `receivable_installments`. */
export interface ReceivableInstallment {
  id: string;
  receivable_id: string;
  installment_number: number;
  due_date: string;
  original_amount: number;
  discount_amount: number;
  interest_amount: number;
  received_amount: number;
  status: StatusReceivableInstallment;
  received_at: string | null;
}

export interface NovaContaReceber {
  payer_id?: string | null;
  member_id?: string | null;
  description: string;
  source_type?: string | null;
  total_amount: number;
  financial_category_id?: string | null;
  cost_center_id?: string | null;
  installments: number;
  first_due_date: string;
}

export interface BaixaParcelaReceber {
  financial_account_id: string;
  payment_date: string;
  /** Valor recebido em centavos; por padrão, quita o saldo restante da parcela. */
  amount?: number;
  payment_method_id?: string | null;
}

const SELECT_COM_ORIGEM = `
  SELECT r.*, pa.name AS payer_name, p.full_name AS member_name
  FROM receivables r
  LEFT JOIN payers pa ON pa.id = r.payer_id
  LEFT JOIN members m ON m.id = r.member_id
  LEFT JOIN people p ON p.id = m.person_id
`;

/** Acesso às tabelas `receivables`/`receivable_installments`/`receivable_payments`. */
export class ReceivableModel {
  static async list(): Promise<ReceivableComOrigem[]> {
    const db = await getDatabase();
    return db.select<ReceivableComOrigem[]>(
      `${SELECT_COM_ORIGEM} WHERE r.association_id = $1 ORDER BY r.created_at DESC`,
      [getCurrentAssociationId()]
    );
  }

  static async get(id: string): Promise<Receivable | null> {
    const db = await getDatabase();
    const rows = await db.select<Receivable[]>("SELECT * FROM receivables WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  static async installments(receivableId: string): Promise<ReceivableInstallment[]> {
    const db = await getDatabase();
    return db.select<ReceivableInstallment[]>(
      "SELECT * FROM receivable_installments WHERE receivable_id = $1 ORDER BY installment_number",
      [receivableId]
    );
  }

  static async create(dados: NovaContaReceber): Promise<Receivable> {
    if (!dados.payer_id && !dados.member_id) {
      throw new Error("Informe o sócio ou o pagador de origem da conta a receber.");
    }

    const associationId = getCurrentAssociationId();
    const db = await getDatabase();
    const id = newId();

    await db.execute(
      `INSERT INTO receivables (id, association_id, payer_id, member_id, description, source_type, total_amount, financial_category_id, cost_center_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        associationId,
        dados.payer_id ?? null,
        dados.member_id ?? null,
        dados.description,
        dados.source_type ?? null,
        dados.total_amount,
        dados.financial_category_id ?? null,
        dados.cost_center_id ?? null,
      ]
    );

    const parcelas = gerarParcelasIguais(dados.total_amount, dados.installments, dados.first_due_date);
    for (const parcela of parcelas) {
      await db.execute(
        `INSERT INTO receivable_installments (id, receivable_id, installment_number, due_date, original_amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [newId(), id, parcela.installment_number, parcela.due_date, parcela.original_amount]
      );
    }

    const [criada] = await db.select<Receivable[]>("SELECT * FROM receivables WHERE id = $1", [id]);
    return criada;
  }

  /** Baixa (total ou parcial) de uma parcela — mesma lógica de `PayableModel.payInstallment`, em receita. */
  static async receiveInstallment(installmentId: string, dados: BaixaParcelaReceber): Promise<void> {
    const db = await getDatabase();
    const [parcela] = await db.select<ReceivableInstallment[]>(
      "SELECT * FROM receivable_installments WHERE id = $1",
      [installmentId]
    );
    if (!parcela) throw new Error("Parcela não encontrada.");

    const receivable = await ReceivableModel.get(parcela.receivable_id);
    if (!receivable) throw new Error("Conta a receber não encontrada.");

    const restante =
      parcela.original_amount + parcela.interest_amount - parcela.discount_amount - parcela.received_amount;
    const valorRecebido = dados.amount ?? restante;
    if (valorRecebido <= 0) throw new Error("Valor a receber deve ser maior que zero.");
    if (valorRecebido > restante) {
      throw new Error("Valor a receber não pode ser maior que o saldo restante da parcela.");
    }

    const totalParcelas = (await ReceivableModel.installments(receivable.id)).length;
    const transacao = await CashTransactionModel.create({
      financial_account_id: dados.financial_account_id,
      transaction_type: "RECEITA",
      amount: valorRecebido,
      transaction_date: dados.payment_date,
      competence_date: dados.payment_date,
      description: `Recebimento ${parcela.installment_number}/${totalParcelas} — ${receivable.description}`,
      financial_category_id: receivable.financial_category_id,
      cost_center_id: receivable.cost_center_id,
      payment_method_id: dados.payment_method_id ?? null,
      source_type: "RECEIVABLE_INSTALLMENT",
      source_id: installmentId,
    });

    await db.execute(
      `INSERT INTO receivable_payments (id, receivable_installment_id, cash_transaction_id, amount, received_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [newId(), installmentId, transacao.id, valorRecebido, dados.payment_date]
    );

    const novoRecebido = parcela.received_amount + valorRecebido;
    const quitada = novoRecebido >= parcela.original_amount + parcela.interest_amount - parcela.discount_amount;
    await db.execute(
      "UPDATE receivable_installments SET received_amount = $2, status = $3, received_at = $4 WHERE id = $1",
      [installmentId, novoRecebido, quitada ? "RECEBIDA" : "PARCIAL", quitada ? dados.payment_date : null]
    );

    await ReceivableModel.refreshStatus(receivable.id);
  }

  /** Recalcula `receivables.status` a partir da situação de todas as parcelas. */
  static async refreshStatus(receivableId: string): Promise<void> {
    const parcelas = await ReceivableModel.installments(receivableId);
    const naoCanceladas = parcelas.filter((p) => p.status !== "CANCELADA");
    let novoStatus: StatusReceivable;
    if (naoCanceladas.length === 0) {
      novoStatus = "CANCELADA";
    } else if (naoCanceladas.every((p) => p.status === "RECEBIDA")) {
      novoStatus = "RECEBIDA";
    } else if (naoCanceladas.some((p) => p.status === "RECEBIDA" || p.status === "PARCIAL")) {
      novoStatus = "PARCIAL";
    } else {
      novoStatus = "ABERTA";
    }

    const db = await getDatabase();
    await db.execute("UPDATE receivables SET status = $2 WHERE id = $1", [receivableId, novoStatus]);
  }
}
