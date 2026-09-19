import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { CashTransactionModel } from "./CashTransaction.js";
import { criarReciboDeProtocolo } from "./MembershipPayment.js";
import { formatarCompetencia } from "../utils/format.js";

/**
 * Espelha a tabela `membership_agreements` (migration `version: 16`) —
 * renegociação de mensalidades atrasadas: o sócio quita, de uma vez, um
 * conjunto de parcelas vencidas por um valor único negociado (geralmente
 * menor que a soma original) — não é uma redução do valor mensal daqui pra
 * frente, só uma quitação em lote. `MembershipPaymentModel` continua sendo
 * quem guarda a quitação de cada parcela (`membership_payments`, uma linha
 * por parcela coberta, todas com o mesmo `cash_transaction_id` — um único
 * lançamento de caixa pelo valor negociado — e o mesmo
 * `membership_agreement_id`, apontando pra cá).
 */
export interface MembershipAgreement {
  id: string;
  association_id: string;
  member_id: string;
  /** Soma em centavos do que as parcelas cobertas valiam originalmente (referência — o app não historiza valor mensal por mês). */
  original_amount: number;
  /** Valor em centavos efetivamente recebido — o que gera o lançamento de caixa. */
  negotiated_amount: number;
  agreement_date: string;
  /** Texto livre: o app não tem usuários/login pra vincular a um aprovador de verdade. */
  approved_by: string | null;
  notes: string | null;
  created_at: string;
}

/** Acordo com os dados de exibição do recibo já unidos (sócio, matrícula, meses cobertos). */
export interface MembershipAgreementComDetalhes extends MembershipAgreement {
  full_name: string;
  registration_number: string;
  receipt_number: string | null;
  /** Competências (`"AAAA-MM-01"`) cobertas pelo acordo, em ordem. */
  competence_months: string[];
}

export interface NovoAcordoMensalidade {
  parcela_ids: string[];
  /** Centavos. */
  original_amount: number;
  /** Centavos — valor efetivamente recebido. */
  negotiated_amount: number;
  agreement_date: string;
  approved_by?: string | null;
  notes?: string | null;
  financial_account_id: string;
  payment_method_id?: string | null;
  payment_method_label?: string | null;
  /** Mesmo mecanismo de numeração de `BaixaMensalidade.protocol_book_id` — um único recibo cobrindo todas as parcelas. */
  protocol_book_id?: string | null;
}

/** Acesso à tabela `membership_agreements` e à quitação em lote que ela representa. */
export class MembershipAgreementModel {
  /**
   * Efetiva o acordo: valida que nenhuma parcela selecionada já tem
   * pagamento (checado ANTES de consumir número de protocolo, mesma regra
   * de `MembershipPaymentModel.pagar`), cria UM lançamento de caixa pelo
   * valor negociado, UM recibo (se um livro foi escolhido) cobrindo o
   * intervalo de competências, UMA linha em `membership_agreements` e UMA
   * linha em `membership_payments` por parcela coberta — valor rateado em
   * centavos (divisão inteira, sobra de arredondamento na última parcela),
   * de forma que a soma bate exatamente com o valor negociado.
   */
  static async criar(memberId: string, dados: NovoAcordoMensalidade): Promise<MembershipAgreementComDetalhes> {
    if (dados.parcela_ids.length === 0) throw new Error("Selecione ao menos uma mensalidade para o acordo.");
    if (dados.negotiated_amount <= 0) throw new Error("Valor negociado deve ser maior que zero.");

    const associationId = getCurrentAssociationId();
    const db = await getDatabase();

    const placeholdersExistentes = dados.parcela_ids.map((_, i) => `$${i + 2}`).join(", ");
    const existentes = await db.select<{ id: string }[]>(
      `SELECT id FROM membership_payments WHERE member_id = $1 AND parcela_id IN (${placeholdersExistentes})`,
      [memberId, ...dados.parcela_ids]
    );
    if (existentes.length > 0) {
      throw new Error("Uma ou mais mensalidades selecionadas já têm pagamento registrado.");
    }

    const placeholdersParcelas = dados.parcela_ids.map((_, i) => `$${i + 1}`).join(", ");
    const parcelas = await db.select<{ id: string; competence_month: string }[]>(
      `SELECT id, competence_month FROM parcelas WHERE id IN (${placeholdersParcelas}) ORDER BY competence_month`,
      dados.parcela_ids
    );
    if (parcelas.length !== dados.parcela_ids.length) {
      throw new Error("Uma ou mais competências selecionadas não foram encontradas.");
    }

    const [membro] = await db.select<{ full_name: string }[]>(
      `SELECT pe.full_name AS full_name FROM members m JOIN people pe ON pe.id = m.person_id WHERE m.id = $1`,
      [memberId]
    );
    const nomeSocio = membro?.full_name ?? null;

    const meses = parcelas.map((p) => formatarCompetencia(p.competence_month));
    const intervaloTexto = meses.length === 1 ? meses[0] : `${meses[0]} a ${meses[meses.length - 1]}`;

    let receiptNumber: string | null = null;
    let protocolEntryId: string | null = null;
    if (dados.protocol_book_id) {
      const recibo = await criarReciboDeProtocolo(dados.protocol_book_id, {
        protocolDate: dados.agreement_date,
        recipientName: nomeSocio,
        subject: `Acordo de mensalidade${nomeSocio ? ` — ${nomeSocio}` : ""} — ${intervaloTexto}`,
        memberId,
      });
      receiptNumber = recibo.receiptNumber;
      protocolEntryId = recibo.protocolEntryId;
    }

    const agreementId = newId();
    const transacao = await CashTransactionModel.create({
      financial_account_id: dados.financial_account_id,
      transaction_type: "RECEITA",
      amount: dados.negotiated_amount,
      transaction_date: dados.agreement_date,
      competence_date: parcelas[0].competence_month,
      description: `Acordo de mensalidade${nomeSocio ? ` — ${nomeSocio}` : ""} — ${intervaloTexto}`,
      payment_method_id: dados.payment_method_id ?? null,
      source_type: "MEMBERSHIP_AGREEMENT",
      source_id: agreementId,
    });

    await db.execute(
      `INSERT INTO membership_agreements
         (id, association_id, member_id, original_amount, negotiated_amount, agreement_date, approved_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        agreementId,
        associationId,
        memberId,
        dados.original_amount,
        dados.negotiated_amount,
        dados.agreement_date,
        dados.approved_by ?? null,
        dados.notes ?? null,
      ]
    );

    // Rateio em centavos: divisão inteira, sobra de arredondamento absorvida
    // pela última parcela — soma bate exatamente com o valor negociado.
    const quantidade = parcelas.length;
    const valorBase = Math.floor(dados.negotiated_amount / quantidade);
    const sobra = dados.negotiated_amount - valorBase * quantidade;

    for (let i = 0; i < parcelas.length; i++) {
      const valorParcela = valorBase + (i === parcelas.length - 1 ? sobra : 0);
      await db.execute(
        `INSERT INTO membership_payments
           (id, association_id, member_id, parcela_id, cash_transaction_id, paid_amount, paid_at, payment_method,
            receipt_number, protocol_entry_id, membership_agreement_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          newId(),
          associationId,
          memberId,
          parcelas[i].id,
          transacao.id,
          valorParcela,
          dados.agreement_date,
          dados.payment_method_label ?? null,
          receiptNumber,
          protocolEntryId,
          agreementId,
        ]
      );
    }

    const criado = await MembershipAgreementModel.get(agreementId);
    if (!criado) throw new Error("Falha ao registrar o acordo.");
    return criado;
  }

  /** Acordo com dados de sócio/competências, pra exibir/imprimir o recibo (ver `ImprimirReciboAcordo.vue`). */
  static async get(id: string): Promise<MembershipAgreementComDetalhes | null> {
    const db = await getDatabase();
    const rows = await db.select<Omit<MembershipAgreementComDetalhes, "competence_months">[]>(
      `SELECT ag.*, pe.full_name AS full_name, m.registration_number AS registration_number,
              (SELECT mp.receipt_number FROM membership_payments mp
                 WHERE mp.membership_agreement_id = ag.id LIMIT 1) AS receipt_number
       FROM membership_agreements ag
       JOIN members m ON m.id = ag.member_id
       JOIN people pe ON pe.id = m.person_id
       WHERE ag.id = $1`,
      [id]
    );
    const acordo = rows[0];
    if (!acordo) return null;

    const parcelas = await db.select<{ competence_month: string }[]>(
      `SELECT pa.competence_month AS competence_month
       FROM membership_payments mp
       JOIN parcelas pa ON pa.id = mp.parcela_id
       WHERE mp.membership_agreement_id = $1
       ORDER BY pa.competence_month`,
      [id]
    );

    return { ...acordo, competence_months: parcelas.map((p) => p.competence_month) };
  }

  /**
   * Acordo cujo recibo É este protocolo (se houver) — mesmo papel de
   * `MembershipPaymentModel.buscarPorProtocolo`, checado ANTES dele pelo
   * botão "Imprimir" da lista de Protocolos (`Documentos.vue`): um recibo
   * de acordo também deixa `protocol_entry_id` preenchido em cada linha de
   * `membership_payments` que ele quitou, então precisa ser identificado
   * primeiro pra reabrir o recibo de ACORDO (valor negociado, intervalo de
   * meses) em vez do recibo de uma parcela isolada (só a fatia rateada).
   */
  static async buscarPorProtocolo(protocolEntryId: string): Promise<{ id: string } | null> {
    const db = await getDatabase();
    const rows = await db.select<{ id: string }[]>(
      `SELECT DISTINCT membership_agreement_id AS id
       FROM membership_payments
       WHERE protocol_entry_id = $1 AND membership_agreement_id IS NOT NULL
       LIMIT 1`,
      [protocolEntryId]
    );
    return rows[0] ?? null;
  }
}
