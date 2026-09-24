import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { calcularVencimento, hojeIso, formatarMoeda } from "../utils/format.js";
import { AssociationModel } from "./Association.js";
import { MembershipPlanModel } from "./MembershipPlan.js";
import { CashTransactionModel } from "./CashTransaction.js";
import { ProtocolBookModel, type ProtocolBook } from "./ProtocolBook.js";
import { ProtocolEntryModel, formatarNumeroProtocolo } from "./ProtocolEntry.js";
import { comAtividade } from "./ActivityLog.js";

/**
 * Espelha a tabela `membership_payments` (migration `version: 13`) —
 * substitui `membership_charges`/`charge_payments`: em vez de pré-gerar
 * uma cobrança por sócio/mês, só o PAGAMENTO é registrado. Quem não tem
 * pagamento pra um mês já vencido, deve — sem nada pra gerar. Binário: um
 * pagamento por `(member_id, parcela_id)` já quita aquele mês inteiro
 * (`UNIQUE` no banco), sem baixa parcial.
 */
export interface MembershipPayment {
  id: string;
  association_id: string;
  member_id: string;
  parcela_id: string;
  cash_transaction_id: string | null;
  paid_amount: number;
  paid_at: string;
  payment_method: string | null;
  receipt_number: string | null;
  /** Protocolo (livro tipo `RECIBO`) que gerou este recibo, se algum foi escolhido — migration `version: 14`. */
  protocol_entry_id: string | null;
  /** Acordo de renegociação que quitou esta parcela, se foi o caso (em vez de pagamento integral normal) — migration `version: 16`. */
  membership_agreement_id: string | null;
  notes: string | null;
  created_at: string;
}

/** Pagamento com os dados de exibição do recibo já unidos (sócio, matrícula, competência). */
export interface MembershipPaymentComDetalhes extends MembershipPayment {
  full_name: string;
  registration_number: string;
  competence_month: string;
}

export type StatusMensalidade = "PAGO" | "VENCIDO" | "ABERTO";

/** Uma linha "sócio × mês" com a situação já calculada — nunca persistida, sempre computada na leitura. */
export interface MensalidadeLinha {
  member_id: string;
  full_name: string;
  registration_number: string;
  parcela_id: string;
  competence_month: string;
  due_date: string;
  status: StatusMensalidade;
  payment_id: string | null;
  paid_amount: number | null;
  paid_at: string | null;
  receipt_number: string | null;
  /** Preenchido quando esta parcela foi quitada por um acordo de renegociação, não por pagamento integral normal (ver `MembershipAgreementModel`). */
  membership_agreement_id: string | null;
}

export interface FiltroMensalidade {
  memberId?: string;
  competenceMonth?: string;
  status?: StatusMensalidade;
}

export interface BaixaMensalidade {
  financial_account_id: string;
  payment_date: string;
  /** Valor pago em centavos. */
  amount: number;
  payment_method_id?: string | null;
  payment_method_label?: string | null;
  /**
   * Livro de protocolo (tipo `RECIBO`) usado pra numerar o recibo — o
   * número vem da numeração atômica do livro (`ProtocolEntryModel.create`,
   * mesma sequência usada pelos protocolos comuns). `null`/omitido = sem
   * numeração automática, `receipt_number` fica vazio.
   */
  protocol_book_id?: string | null;
}

function formatarCompetenciaCurta(competenceMonth: string): string {
  const [ano, mes] = competenceMonth.split("-");
  return `${mes}/${ano}`;
}

/**
 * Cria a entrada de protocolo (livro tipo RECIBO) que numera um recibo e
 * devolve o número já formatado — usado tanto por `pagar()` (uma parcela)
 * quanto por `MembershipAgreementModel.criar()` (várias parcelas quitadas
 * de uma vez, um recibo só cobrindo o intervalo). Extraído aqui pra não
 * duplicar a numeração atômica (`ProtocolEntryModel.create`) nos dois
 * lugares.
 */
export async function criarReciboDeProtocolo(
  protocolBookId: string,
  dados: { protocolDate: string; recipientName: string | null; subject: string; memberId?: string | null }
): Promise<{ receiptNumber: string; protocolEntryId: string }> {
  const livro = await ProtocolBookModel.get(protocolBookId);
  const entry = await ProtocolEntryModel.create({
    protocol_book_id: protocolBookId,
    direction: "EXPEDIDO",
    protocol_date: dados.protocolDate,
    recipient_name: dados.recipientName,
    subject: dados.subject,
    member_id: dados.memberId ?? null,
  });
  return { receiptNumber: formatarNumeroProtocolo(entry, livro?.prefix ?? null), protocolEntryId: entry.id };
}

/** Acesso à tabela `membership_payments` + leitura computada de "quem deve o quê". */
export class MembershipPaymentModel {
  /**
   * Monta as linhas "sócio × mês" da associação — cruza `members` (sócios
   * já dentro da vigência: `association_date` até `exit_date`, se houver)
   * com `parcelas` (calendário de meses, `ParcelaModel`), e junta o
   * pagamento se existir. Nunca cria nada — só lê. `somenteAtivos` restringe
   * a sócios `ATIVO` (uso em telas de listagem geral); a ficha de um sócio
   * específico quer o histórico completo independente da situação atual
   * dele, então passa `false`.
   *
   * O início da vigência é `member.dues_start_date` quando preenchida
   * (migration `version: 22`, "mensalidade legado"), senão `association_date`
   * — mês anterior a ela nem vira linha aqui, então não conta como dívida
   * nem, por consequência, bloqueia o sócio em `listarInadimplentesAtivos`
   * (usada pela lista de aptos a votar).
   */
  private static async buscarLinhas(
    filtro: FiltroMensalidade,
    somenteAtivos: boolean
  ): Promise<MensalidadeLinha[]> {
    const associationId = getCurrentAssociationId();
    const db = await getDatabase();
    const associacao = await AssociationModel.get(associationId);

    const condicoes = ["m.association_id = $1"];
    const valores: string[] = [associationId];
    if (somenteAtivos) condicoes.push("m.status = 'ATIVO'");
    if (filtro.memberId) {
      valores.push(filtro.memberId);
      condicoes.push(`m.id = $${valores.length}`);
    }
    if (filtro.competenceMonth) {
      valores.push(filtro.competenceMonth);
      condicoes.push(`pa.competence_month = $${valores.length}`);
    }

    const linhas = await db.select<
      {
        member_id: string;
        full_name: string;
        registration_number: string;
        parcela_id: string;
        competence_month: string;
        payment_id: string | null;
        paid_amount: number | null;
        paid_at: string | null;
        receipt_number: string | null;
        membership_agreement_id: string | null;
      }[]
    >(
      `SELECT m.id AS member_id, pe.full_name AS full_name, m.registration_number AS registration_number,
              pa.id AS parcela_id, pa.competence_month AS competence_month,
              mp.id AS payment_id, mp.paid_amount AS paid_amount, mp.paid_at AS paid_at, mp.receipt_number AS receipt_number,
              mp.membership_agreement_id AS membership_agreement_id
       FROM members m
       JOIN people pe ON pe.id = m.person_id
       JOIN parcelas pa
         ON pa.association_id = m.association_id
         AND substr(pa.competence_month, 1, 7) >= substr(COALESCE(m.dues_start_date, m.association_date), 1, 7)
         AND (m.exit_date IS NULL OR substr(pa.competence_month, 1, 7) <= substr(m.exit_date, 1, 7))
       LEFT JOIN membership_payments mp ON mp.member_id = m.id AND mp.parcela_id = pa.id
       WHERE ${condicoes.join(" AND ")}
       ORDER BY pa.competence_month DESC, pe.full_name`,
      valores
    );

    const hoje = hojeIso();
    const dueDay = associacao?.monthly_contribution_due_day ?? null;

    return linhas.map((linha) => {
      const dueDate = calcularVencimento(linha.competence_month, dueDay);
      const status: StatusMensalidade = linha.payment_id ? "PAGO" : dueDate < hoje ? "VENCIDO" : "ABERTO";
      return { ...linha, due_date: dueDate, status };
    });
  }

  /** Listagem geral (tela Cobranças) — só sócios ATIVO, paginada. */
  static async listar(
    filtro: FiltroMensalidade,
    paginacao: { page: number; pageSize: number }
  ): Promise<{ items: MensalidadeLinha[]; total: number }> {
    const todas = await MembershipPaymentModel.buscarLinhas(filtro, true);
    const filtradas = filtro.status ? todas.filter((linha) => linha.status === filtro.status) : todas;
    const inicio = (paginacao.page - 1) * paginacao.pageSize;
    return { items: filtradas.slice(inicio, inicio + paginacao.pageSize), total: filtradas.length };
  }

  /** Histórico de mensalidade de um sócio específico (aba Mensalidades da ficha) — qualquer situação do sócio. */
  static async listarPorSocio(
    memberId: string,
    paginacao: { page: number; pageSize: number }
  ): Promise<{ items: MensalidadeLinha[]; total: number }> {
    const todas = await MembershipPaymentModel.buscarLinhas({ memberId }, false);
    const inicio = (paginacao.page - 1) * paginacao.pageSize;
    return { items: todas.slice(inicio, inicio + paginacao.pageSize), total: todas.length };
  }

  /**
   * IDs dos sócios ATIVOS com alguma mensalidade vencida — uso na lista de
   * aptos a votar (`ImprimirAptosAVotar.vue`): apto = ATIVO e SEM nenhuma
   * mensalidade vencida (mensalidade em dia).
   */
  static async listarInadimplentesAtivos(): Promise<Set<string>> {
    const linhas = await MembershipPaymentModel.buscarLinhas({}, true);
    return new Set(linhas.filter((linha) => linha.status === "VENCIDO").map((linha) => linha.member_id));
  }

  /**
   * IDs de todos os sócios com alguma mensalidade vencida, sem restringir a
   * `ATIVO` — uso no filtro "Somente inadimplentes" da lista de sócios
   * (`Socios.vue`), que mostra sócios em qualquer situação. Diferente de
   * `listarInadimplentesAtivos` (uso específico: aptos a votar).
   */
  static async listarInadimplentes(): Promise<Set<string>> {
    const linhas = await MembershipPaymentModel.buscarLinhas({}, false);
    return new Set(linhas.filter((linha) => linha.status === "VENCIDO").map((linha) => linha.member_id));
  }

  /** Contagem geral pra dashboard (`Inicio.vue`) — sócios ATIVO, sem paginação. */
  static async resumo(): Promise<{ abertas: number; vencidas: number }> {
    const linhas = await MembershipPaymentModel.buscarLinhas({}, true);
    return {
      abertas: linhas.filter((linha) => linha.status === "ABERTO" || linha.status === "VENCIDO").length,
      vencidas: linhas.filter((linha) => linha.status === "VENCIDO").length,
    };
  }

  /** Sócio deve algum mês já vencido? (badge "Inadimplente" na ficha). */
  static async isInadimplente(memberId: string): Promise<boolean> {
    const linhas = await MembershipPaymentModel.buscarLinhas({ memberId }, false);
    return linhas.some((linha) => linha.status === "VENCIDO");
  }

  /**
   * Todas as mensalidades vencidas de um sócio, sem paginação — uso nos
   * botões "Pagar todas as vencidas"/"Fazer acordo de todas as vencidas"
   * da aba Mensalidades (`SocioDetalhes.vue`), que agem sobre TODAS as
   * parcelas vencidas do sócio, não só as da página atual de
   * `listarPorSocio` (paginada em `PAGE_SIZE`).
   */
  static async listarVencidasPorSocio(memberId: string): Promise<MensalidadeLinha[]> {
    const linhas = await MembershipPaymentModel.buscarLinhas({ memberId }, false);
    return linhas.filter((linha) => linha.status === "VENCIDO");
  }

  /** Pagamento único, com dados pra exibir/imprimir o recibo (ver `ImprimirRecibo.vue`). */
  static async get(id: string): Promise<MembershipPaymentComDetalhes | null> {
    const db = await getDatabase();
    const rows = await db.select<MembershipPaymentComDetalhes[]>(
      `SELECT mp.*, pe.full_name AS full_name, m.registration_number AS registration_number,
              pa.competence_month AS competence_month
       FROM membership_payments mp
       JOIN members m ON m.id = mp.member_id
       JOIN people pe ON pe.id = m.person_id
       JOIN parcelas pa ON pa.id = mp.parcela_id
       WHERE mp.id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  /**
   * Pagamento cujo recibo É este protocolo (se houver) — usado pelo botão
   * "Imprimir" da lista de Protocolos (`Documentos.vue`) pra decidir se
   * reabre o recibo dedicado (`ImprimirRecibo.vue`, com valor/sócio) ou
   * cai no comprovante genérico do protocolo (`ImprimirProtocolo.vue`).
   */
  static async buscarPorProtocolo(protocolEntryId: string): Promise<{ id: string } | null> {
    const db = await getDatabase();
    const rows = await db.select<{ id: string }[]>(
      "SELECT id FROM membership_payments WHERE protocol_entry_id = $1 LIMIT 1",
      [protocolEntryId]
    );
    return rows[0] ?? null;
  }

  /**
   * Lista os livros de protocolo elegíveis pra numerar recibo de
   * mensalidade — tipo `RECIBO` (ver `ProtocolBookForm.vue`, campo livre
   * mas convencionado em maiúsculas) e ativos.
   */
  static async listarLivrosRecibo(): Promise<ProtocolBook[]> {
    const livros = await ProtocolBookModel.list();
    return livros.filter((livro) => livro.protocol_type === "RECIBO" && livro.is_active);
  }

  /**
   * Valor mensal esperado de um sócio, em centavos — usado só como valor
   * SUGERIDO nos formulários de pagamento (não bloqueia nada, o valor pago
   * continua editável): no modo "Único" é o valor único da associação
   * (`monthly_contribution_amount`); no modo "Múltiplos planos" é o valor
   * do plano vinculado ao sócio (`MembershipPlanModel.valorDoSocio`), 0 se
   * ele não tiver plano vinculado.
   */
  static async valorMensalSugerido(memberId: string): Promise<number> {
    const associacao = await AssociationModel.get(getCurrentAssociationId());
    if (!associacao) return 0;
    if (associacao.membership_mode === "MULTIPLO") {
      return MembershipPlanModel.valorDoSocio(memberId);
    }
    return associacao.monthly_contribution_amount ?? 0;
  }

  /**
   * Registra o pagamento da mensalidade de um sócio/mês: gera o lançamento
   * de receita no caixa (mesmo fluxo de antes, ver `docs/dominio-associacoes.md`,
   * seção 2.3), numera o recibo pela sequência do livro escolhido (se
   * houver — mesma numeração atômica de `ProtocolEntryModel.create`, o
   * recibo vira um protocolo `EXPEDIDO` de verdade, rastreável no livro) e
   * grava em `membership_payments`. Binário — se já existe pagamento pra
   * esse `(member_id, parcela_id)`, é erro (sem baixa parcial nem
   * re-pagamento; pra corrigir, reverta o lançamento no caixa) — checado
   * ANTES de consumir número de protocolo nenhum, pra não desperdiçar
   * numeração num pagamento que não vai acontecer. Devolve o pagamento já
   * criado (com dados de sócio/competência) pra abrir a tela de impressão
   * do recibo logo em seguida (ver `MembershipPaymentForm.vue`).
   */
  static async pagar(memberId: string, parcelaId: string, dados: BaixaMensalidade): Promise<MembershipPaymentComDetalhes> {
    if (dados.amount <= 0) throw new Error("Valor pago deve ser maior que zero.");

    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();
        const db = await getDatabase();

        const existentes = await db.select<{ id: string }[]>(
          "SELECT id FROM membership_payments WHERE member_id = $1 AND parcela_id = $2",
          [memberId, parcelaId]
        );
        if (existentes.length > 0) {
          throw new Error("Este mês já tem pagamento registrado para este sócio.");
        }

        const [parcela] = await db.select<{ competence_month: string }[]>(
          "SELECT competence_month FROM parcelas WHERE id = $1",
          [parcelaId]
        );
        if (!parcela) throw new Error("Competência não encontrada.");

        let receiptNumber: string | null = null;
        let protocolEntryId: string | null = null;
        if (dados.protocol_book_id) {
          const [membro] = await db.select<{ full_name: string }[]>(
            `SELECT pe.full_name AS full_name FROM members m JOIN people pe ON pe.id = m.person_id WHERE m.id = $1`,
            [memberId]
          );
          const nomeSocio = membro?.full_name ?? null;
          const recibo = await criarReciboDeProtocolo(dados.protocol_book_id, {
            protocolDate: dados.payment_date,
            recipientName: nomeSocio,
            subject: `Recibo de mensalidade${nomeSocio ? ` — ${nomeSocio}` : ""} — ${formatarCompetenciaCurta(parcela.competence_month)}`,
            memberId,
          });
          receiptNumber = recibo.receiptNumber;
          protocolEntryId = recibo.protocolEntryId;
        }

        const id = newId();
        const transacao = await CashTransactionModel.create({
          financial_account_id: dados.financial_account_id,
          transaction_type: "RECEITA",
          amount: dados.amount,
          transaction_date: dados.payment_date,
          competence_date: parcela.competence_month,
          description: `Mensalidade ${formatarCompetenciaCurta(parcela.competence_month)}`,
          payment_method_id: dados.payment_method_id ?? null,
          source_type: "MEMBERSHIP_PAYMENT",
          source_id: id,
        });

        await db.execute(
          `INSERT INTO membership_payments
             (id, association_id, member_id, parcela_id, cash_transaction_id, paid_amount, paid_at, payment_method, receipt_number, protocol_entry_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            id,
            associationId,
            memberId,
            parcelaId,
            transacao.id,
            dados.amount,
            dados.payment_date,
            dados.payment_method_label ?? null,
            receiptNumber,
            protocolEntryId,
          ]
        );

        const criado = await MembershipPaymentModel.get(id);
        if (!criado) throw new Error("Falha ao registrar o pagamento.");
        return criado;
      },
      (pagamento) => ({
        module: "MENSALIDADES",
        description: `Pagamento de mensalidade — ${pagamento.full_name} — ${formatarCompetenciaCurta(pagamento.competence_month)} — ${formatarMoeda(
          pagamento.paid_amount
        )}${pagamento.receipt_number ? ` (recibo ${pagamento.receipt_number})` : ""}`,
        entity_type: "MEMBER",
        entity_id: memberId,
      })
    );
  }
}
