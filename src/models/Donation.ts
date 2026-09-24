import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { DonorModel } from "./Donor.js";
import { CashTransactionModel } from "./CashTransaction.js";
import { comAtividade } from "./ActivityLog.js";
import { formatarMoeda } from "../utils/format.js";

/** Espelha a tabela `donations` (migration `version: 4`). */
export interface Donation {
  id: string;
  association_id: string;
  donor_id: string | null;
  amount: number;
  donation_date: string;
  donation_type: string | null;
  purpose: string | null;
  cash_transaction_id: string | null;
  document_id: string | null;
}

export interface DonationComDoador extends Donation {
  donor_name: string | null;
}

export interface NovaDoacao {
  /** Nome do doador — reaproveita um `Donor` existente pelo documento, se houver, senão cadastra um novo. */
  donor_name: string;
  donor_document?: string | null;
  financial_account_id: string;
  amount: number;
  donation_date: string;
  donation_type?: string | null;
  purpose?: string | null;
  financial_category_id?: string | null;
}

/** Acesso à tabela `donations`, incluindo o registro do recebimento no caixa. */
export class DonationModel {
  static async list(): Promise<DonationComDoador[]> {
    const db = await getDatabase();
    return db.select<DonationComDoador[]>(
      `SELECT d.*, don.name AS donor_name
       FROM donations d
       LEFT JOIN donors don ON don.id = d.donor_id
       WHERE d.association_id = $1
       ORDER BY d.donation_date DESC`,
      [getCurrentAssociationId()]
    );
  }

  static async create(dados: NovaDoacao): Promise<Donation> {
    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();

        let doador = dados.donor_document ? await DonorModel.findByDocument(dados.donor_document) : null;
        if (!doador) {
          doador = await DonorModel.create({ name: dados.donor_name, document_number: dados.donor_document ?? null });
        }

        const transacao = await CashTransactionModel.create({
          financial_account_id: dados.financial_account_id,
          transaction_type: "RECEITA",
          amount: dados.amount,
          transaction_date: dados.donation_date,
          competence_date: dados.donation_date,
          description: `Doação de ${doador.name}`,
          financial_category_id: dados.financial_category_id ?? null,
          source_type: "DONATION",
        });

        const db = await getDatabase();
        const id = newId();
        await db.execute(
          `INSERT INTO donations (id, association_id, donor_id, amount, donation_date, donation_type, purpose, cash_transaction_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            associationId,
            doador.id,
            dados.amount,
            dados.donation_date,
            dados.donation_type ?? null,
            dados.purpose ?? null,
            transacao.id,
          ]
        );

        // Referencia a doação de volta na transação, para navegação nos dois sentidos.
        await db.execute("UPDATE cash_transactions SET source_id = $2 WHERE id = $1", [transacao.id, id]);

        const [criada] = await db.select<Donation[]>("SELECT * FROM donations WHERE id = $1", [id]);
        return criada;
      },
      () => ({
        module: "FINANCEIRO",
        description: `Doação recebida — ${dados.donor_name} — ${formatarMoeda(dados.amount)}`,
      })
    );
  }
}
