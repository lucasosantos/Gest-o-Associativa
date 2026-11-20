import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { calcularVencimento, competenciaAtual, hojeIso, formatarMoeda } from "../utils/format.js";
import { codigoAcordo, codigoLancamento, codigoMensalidade, codigoServico } from "../utils/codigos.js";
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
  /** Prestação de serviço que quitou este mês (sem dinheiro, sem lançamento) — migration `version: 26`. */
  membership_service_id: string | null;
  notes: string | null;
  created_at: string;
}

/** Pagamento com os dados de exibição do recibo já unidos (sócio, matrícula, competência). */
export interface MembershipPaymentComDetalhes extends MembershipPayment {
  full_name: string;
  registration_number: string;
  competence_month: string;
  /** Código da mensalidade (`01-0012-03-2026`). */
  codigo: string;
  /** Código do lançamento de caixa que a pagou (`01-L-2026-000123`), se houver. */
  lancamento_codigo: string | null;
}

/**
 * Recibo de um pagamento de mensalidade(s) — `MembershipPaymentModel.recibo`.
 * Pagamento de vários meses de uma vez (`pagarVarias`) tem UM recibo só:
 * `itens` traz todos os meses que ele cobre e `total` a soma.
 */
export interface ReciboMensalidades {
  /** O pagamento pedido (dados do sócio, data, forma, nº do recibo, lançamento). */
  pagamento: MembershipPaymentComDetalhes;
  itens: { id: string; competence_month: string; codigo: string; paid_amount: number }[];
  total: number;
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
  /** Forma de pagamento registrada no pagamento (texto livre, ex.: "PIX"). */
  payment_method: string | null;
  /** Preenchido quando esta parcela foi quitada por um acordo de renegociação, não por pagamento integral normal (ver `MembershipAgreementModel`). */
  membership_agreement_id: string | null;
  /** Código legível da mensalidade (`01-0012-03-2026`, ver `src/utils/codigos.ts`). */
  codigo: string;
  /** Código do lançamento de caixa que pagou este mês (`01-L-2026-000123`), se houver. */
  lancamento_codigo: string | null;
  /** Código do acordo que quitou este mês (`01-0012-AC-0001`), se houver. */
  acordo_codigo: string | null;
  /** Prestação de serviço que quitou este mês, se foi o caso (ver `MembershipServiceModel`). */
  membership_service_id: string | null;
  /** Código da prestação de serviço (`01-0012-PS-0001`), se houver. */
  servico_codigo: string | null;
}

/** Resultado de `MembershipPaymentModel.relatorioDoSocio`. Valores em centavos. */
export interface RelatorioFinanceiroSocio {
  linhas: MensalidadeLinha[];
  totais: {
    /** Meses (competências) do período dentro da vigência do sócio. */
    meses: number;
    pagas: number;
    valorPago: number;
    /** Das pagas, quantas foram quitadas por acordo de renegociação. */
    viaAcordo: number;
    /** Das pagas, quantas foram quitadas com prestação de serviço (fora de `valorPago`). */
    viaServico: number;
    /** Valor dos meses quitados com serviço (meses × mensalidade) — não entrou dinheiro. */
    valorServico: number;
    vencidas: number;
    /** Ainda não vencidas e não pagas. */
    abertas: number;
    /** Valor mensal atual do sócio (0 se não houver valor definido). */
    valorMensal: number;
    /** `vencidas × valorMensal` — estimativa, ver `relatorioDoSocio`. */
    estimativaEmAtraso: number;
  };
}

/** O que `MembershipPaymentModel.resetarDoSocio` vai desfazer — mostrado antes de confirmar. Valores em centavos. */
export interface ResumoResetMensalidades {
  /** Mensalidades pagas (uma por competência). */
  pagamentos: number;
  /** Competências pagas, `"MM/AAAA"`, da mais antiga pra mais nova. */
  meses: string[];
  /** Soma do que foi registrado como pago. */
  valorPago: number;
  /** Lançamentos confirmados que serão estornados. */
  lancamentosAEstornar: number;
  /** Valor que sai do caixa (soma desses lançamentos). */
  valorAEstornar: number;
  /** Acordos de renegociação que serão desfeitos. */
  acordos: number;
  /** Recibos (protocolos) que serão cancelados. */
  recibos: number;
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

/**
 * Desfaz o que uma baixa de mensalidade gravou ANTES de falhar no meio (o
 * plugin SQL não dá transação): apaga os pagamentos já inseridos, o
 * lançamento recém-criado e cancela os recibos emitidos (o número continua
 * no livro, como `CANCELADO`). Sem isso sobrava dinheiro no caixa sem
 * mensalidade paga — e o usuário, vendo o mês em aberto, pagava de novo
 * (lançamento em dobro). Erros aqui são engolidos: o erro que importa é o original.
 */
export async function desfazerBaixaParcial(criados: {
  pagamentos: string[];
  lancamentoId: string | null;
  protocolos: (string | null)[];
}): Promise<void> {
  const db = await getDatabase();
  for (const id of criados.pagamentos) {
    await db.execute("DELETE FROM membership_payments WHERE id = $1", [id]).catch(() => undefined);
  }
  if (criados.lancamentoId) {
    await CashTransactionModel.descartarCriadoComErro(criados.lancamentoId).catch(() => undefined);
  }
  for (const protocolo of new Set(criados.protocolos)) {
    if (!protocolo) continue;
    await db
      .execute("UPDATE protocol_entries SET status = 'CANCELADO' WHERE id = $1", [protocolo])
      .catch(() => undefined);
  }
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
    // Mês futuro (criado por pagamento adiantado de alguém) só aparece pra
    // quem já pagou — pros outros ainda não é cobrança nenhuma.
    valores.push(competenciaAtual());
    condicoes.push(`(pa.competence_month <= $${valores.length} OR mp.id IS NOT NULL)`);

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
        payment_method: string | null;
        membership_agreement_id: string | null;
        lancamento_ano: number | null;
        lancamento_numero: number | null;
        acordo_numero: number | null;
        membership_service_id: string | null;
        servico_numero: number | null;
      }[]
    >(
      `SELECT m.id AS member_id, pe.full_name AS full_name, m.registration_number AS registration_number,
              pa.id AS parcela_id, pa.competence_month AS competence_month,
              mp.id AS payment_id, mp.paid_amount AS paid_amount, mp.paid_at AS paid_at, mp.receipt_number AS receipt_number,
              mp.payment_method AS payment_method, mp.membership_agreement_id AS membership_agreement_id,
              ct.ano AS lancamento_ano, ct.numero AS lancamento_numero, ma.numero AS acordo_numero,
              mp.membership_service_id AS membership_service_id, ms.numero AS servico_numero
       FROM members m
       JOIN people pe ON pe.id = m.person_id
       JOIN parcelas pa
         ON pa.association_id = m.association_id
         AND substr(pa.competence_month, 1, 7) >= substr(COALESCE(m.dues_start_date, m.association_date), 1, 7)
         AND (m.exit_date IS NULL OR substr(pa.competence_month, 1, 7) <= substr(m.exit_date, 1, 7))
       LEFT JOIN membership_payments mp ON mp.member_id = m.id AND mp.parcela_id = pa.id
       LEFT JOIN cash_transactions ct ON ct.id = mp.cash_transaction_id
       LEFT JOIN membership_agreements ma ON ma.id = mp.membership_agreement_id
       LEFT JOIN membership_services ms ON ms.id = mp.membership_service_id
       WHERE ${condicoes.join(" AND ")}
       ORDER BY pa.competence_month DESC, pe.full_name`,
      valores
    );

    const hoje = hojeIso();
    const dueDay = associacao?.monthly_contribution_due_day ?? null;

    return linhas.map(({ lancamento_ano, lancamento_numero, acordo_numero, servico_numero, ...linha }) => {
      const dueDate = calcularVencimento(linha.competence_month, dueDay);
      const status: StatusMensalidade = linha.payment_id ? "PAGO" : dueDate < hoje ? "VENCIDO" : "ABERTO";
      return {
        ...linha,
        due_date: dueDate,
        status,
        codigo: codigoMensalidade(linha.registration_number, linha.competence_month),
        lancamento_codigo: codigoLancamento(lancamento_ano, lancamento_numero),
        acordo_codigo: codigoAcordo(linha.registration_number, acordo_numero),
        servico_codigo: codigoServico(linha.registration_number, servico_numero),
      };
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
   * Relatório financeiro de um sócio (`RelatorioFinanceiroSocio.vue`):
   * todas as mensalidades cuja competência cai entre `inicio` e `fim`
   * (datas ISO; conta o mês, não o dia), em ordem cronológica, com os
   * totais do período. O valor em atraso é ESTIMADO pelo valor mensal atual
   * do sócio (`valorMensalSugerido`) — o sistema não guarda o valor devido
   * de meses não pagos, só o que foi efetivamente pago.
   */
  static async relatorioDoSocio(memberId: string, inicio: string, fim: string): Promise<RelatorioFinanceiroSocio> {
    const [todas, valorMensal] = await Promise.all([
      MembershipPaymentModel.buscarLinhas({ memberId }, false),
      MembershipPaymentModel.valorMensalSugerido(memberId),
    ]);
    const mesInicio = inicio.slice(0, 7);
    const mesFim = fim.slice(0, 7);
    const linhas = todas
      .filter((linha) => {
        const mes = linha.competence_month.slice(0, 7);
        return mes >= mesInicio && mes <= mesFim;
      })
      .sort((a, b) => a.competence_month.localeCompare(b.competence_month));

    const pagas = linhas.filter((linha) => linha.status === "PAGO");
    // Mês pago com serviço não teve dinheiro: fica fora do "total pago" e vai num total próprio.
    const pagasComDinheiro = pagas.filter((linha) => !linha.membership_service_id);
    const pagasComServico = pagas.filter((linha) => linha.membership_service_id);
    const vencidas = linhas.filter((linha) => linha.status === "VENCIDO").length;
    return {
      linhas,
      totais: {
        meses: linhas.length,
        pagas: pagas.length,
        valorPago: pagasComDinheiro.reduce((soma, linha) => soma + (linha.paid_amount ?? 0), 0),
        viaAcordo: pagas.filter((linha) => linha.membership_agreement_id).length,
        viaServico: pagasComServico.length,
        valorServico: pagasComServico.reduce((soma, linha) => soma + (linha.paid_amount ?? 0), 0),
        vencidas,
        abertas: linhas.filter((linha) => linha.status === "ABERTO").length,
        valorMensal,
        estimativaEmAtraso: vencidas * valorMensal,
      },
    };
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
    const rows = await db.select<
      (Omit<MembershipPaymentComDetalhes, "codigo" | "lancamento_codigo"> & {
        lancamento_ano: number | null;
        lancamento_numero: number | null;
      })[]
    >(
      `SELECT mp.*, pe.full_name AS full_name, m.registration_number AS registration_number,
              pa.competence_month AS competence_month, ct.ano AS lancamento_ano, ct.numero AS lancamento_numero
       FROM membership_payments mp
       JOIN members m ON m.id = mp.member_id
       JOIN people pe ON pe.id = m.person_id
       JOIN parcelas pa ON pa.id = mp.parcela_id
       LEFT JOIN cash_transactions ct ON ct.id = mp.cash_transaction_id
       WHERE mp.id = $1`,
      [id]
    );
    if (!rows[0]) return null;
    const { lancamento_ano, lancamento_numero, ...pagamento } = rows[0];
    return {
      ...pagamento,
      codigo: codigoMensalidade(pagamento.registration_number, pagamento.competence_month),
      lancamento_codigo: codigoLancamento(lancamento_ano, lancamento_numero),
    };
  }

  /**
   * Recibo do pagamento `id` com TODOS os meses pagos junto com ele: mesmo
   * recibo numerado (`protocol_entry_id`) ou, sem livro de recibo, o mesmo
   * lançamento no caixa — `pagarVarias` grava os meses assim. Pagamento de
   * um mês só (ou de antes desta regra, um recibo por mês) vem com 1 item.
   */
  static async recibo(id: string): Promise<ReciboMensalidades | null> {
    const pagamento = await MembershipPaymentModel.get(id);
    if (!pagamento) return null;
    const db = await getDatabase();
    const linhas = await db.select<{ id: string; competence_month: string; paid_amount: number }[]>(
      `SELECT mp.id, pa.competence_month, mp.paid_amount
       FROM membership_payments mp JOIN parcelas pa ON pa.id = mp.parcela_id
       WHERE mp.member_id = $1 AND mp.membership_agreement_id IS NULL
         AND (mp.id = $2
              OR ($3 IS NOT NULL AND mp.protocol_entry_id = $3)
              OR ($3 IS NULL AND $4 IS NOT NULL AND mp.protocol_entry_id IS NULL AND mp.cash_transaction_id = $4))
       ORDER BY pa.competence_month`,
      [pagamento.member_id, id, pagamento.protocol_entry_id, pagamento.cash_transaction_id]
    );
    const itens = linhas.map((linha) => ({
      ...linha,
      codigo: codigoMensalidade(pagamento.registration_number, linha.competence_month),
    }));
    return { pagamento, itens, total: itens.reduce((soma, item) => soma + item.paid_amount, 0) };
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
   * de receita no caixa (mesmo fluxo de antes, ver `.claude/docs/dominio-associacoes.md`,
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
        const id = newId();
        let lancamentoId: string | null = null;
        try {
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
        lancamentoId = transacao.id;

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
        } catch (erro) {
          await desfazerBaixaParcial({ pagamentos: [id], lancamentoId, protocolos: [protocolEntryId] });
          throw erro;
        }

        const criado = await MembershipPaymentModel.get(id);
        if (!criado) throw new Error("Falha ao registrar o pagamento.");
        return criado;
      },
      (pagamento) => ({
        module: "MENSALIDADES",
        description: `Pagamento de mensalidade ${codigoMensalidade(pagamento.registration_number, pagamento.competence_month)} — ${
          pagamento.full_name
        } — ${formatarMoeda(pagamento.paid_amount)}${pagamento.receipt_number ? ` (recibo ${pagamento.receipt_number})` : ""}${
          pagamento.lancamento_codigo ? ` — lançamento ${pagamento.lancamento_codigo}` : ""
        }`,
        entity_type: "MEMBER",
        entity_id: memberId,
      })
    );
  }

  /**
   * Paga VÁRIAS mensalidades do mesmo sócio de uma vez, sem acordo (cada mês
   * pelo seu valor — "pagar selecionadas/todas as vencidas" e "pagar
   * adiantado"): gera UM ÚNICO lançamento de receita no caixa com o total,
   * como o acordo já fazia, em vez de um lançamento por mês. Cada mês
   * continua com sua linha em `membership_payments` (todas com o mesmo
   * `cash_transaction_id`) e, se um livro foi escolhido, seu próprio recibo
   * numerado — assim reimprimir um recibo pelo protocolo continua mostrando
   * o mês certo (`ImprimirRecibo.vue` é de um mês só).
   *
   * Tudo ou nada na checagem: se algum mês já está pago, nada é gravado
   * (nem número de recibo consumido). `itens[i].amount` é o valor daquele
   * mês, em centavos (o adiantado rateia um desconto entre os meses).
   * Estornar o lançamento depois reabre todos os meses juntos.
   */
  static async pagarVarias(
    memberId: string,
    itens: { parcela_id: string; amount: number }[],
    dados: Omit<BaixaMensalidade, "amount">
  ): Promise<{ primeiroPagamentoId: string }> {
    if (itens.length === 0) throw new Error("Escolha ao menos uma mensalidade.");
    if (itens.some((item) => item.amount <= 0)) throw new Error("Valor pago deve ser maior que zero.");
    if (new Set(itens.map((item) => item.parcela_id)).size !== itens.length) {
      throw new Error("A mesma competência apareceu duas vezes.");
    }

    const db = await getDatabase();
    const parcelaIds = itens.map((item) => item.parcela_id);
    /** `$inicio, $inicio+1, ...` — um marcador por parcela. */
    const marcadoresDesde = (inicio: number) => parcelaIds.map((_, i) => `$${i + inicio}`).join(", ");

    const parcelas = await db.select<{ id: string; competence_month: string }[]>(
      `SELECT id, competence_month FROM parcelas WHERE id IN (${marcadoresDesde(1)})`,
      parcelaIds
    );
    if (parcelas.length !== itens.length) throw new Error("Competência não encontrada.");
    const competencia = new Map(parcelas.map((p) => [p.id, p.competence_month]));
    // Em ordem cronológica: descrição do lançamento, recibos e Atividades seguem os meses.
    const ordenados = [...itens].sort((a, b) =>
      (competencia.get(a.parcela_id) ?? "").localeCompare(competencia.get(b.parcela_id) ?? "")
    );

    const jaPagas = await db.select<{ competence_month: string }[]>(
      `SELECT pa.competence_month FROM membership_payments mp JOIN parcelas pa ON pa.id = mp.parcela_id
       WHERE mp.member_id = $1 AND mp.parcela_id IN (${marcadoresDesde(2)})`,
      [memberId, ...parcelaIds]
    );
    if (jaPagas.length > 0) {
      throw new Error(
        `Já tem pagamento registrado em: ${jaPagas.map((p) => formatarCompetenciaCurta(p.competence_month)).join(", ")}. Nada foi gravado.`
      );
    }

    const [membro] = await db.select<{ full_name: string }[]>(
      "SELECT pe.full_name AS full_name FROM members m JOIN people pe ON pe.id = m.person_id WHERE m.id = $1",
      [memberId]
    );
    const nomeSocio = membro?.full_name ?? null;
    const meses = ordenados.map((item) => formatarCompetenciaCurta(competencia.get(item.parcela_id) ?? ""));
    const mesesTexto = meses.length > 1 ? `${meses.slice(0, -1).join(", ")} e ${meses[meses.length - 1]}` : meses[0];
    const total = ordenados.reduce((soma, item) => soma + item.amount, 0);

    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();

        // UM recibo pro pagamento inteiro (todos os meses, valor total), antes do
        // lançamento como em `pagar` — numeração atômica do livro.
        let recibo: { receiptNumber: string | null; protocolEntryId: string | null } = {
          receiptNumber: null,
          protocolEntryId: null,
        };
        const pagamentosCriados: string[] = [];
        let lancamentoId: string | null = null;
        let lancamentoCodigo = "";
        try {
        if (dados.protocol_book_id) {
          recibo = await criarReciboDeProtocolo(dados.protocol_book_id, {
            protocolDate: dados.payment_date,
            recipientName: nomeSocio,
            subject: `Recibo de ${ordenados.length > 1 ? `${ordenados.length} mensalidades` : "mensalidade"}${
              nomeSocio ? ` — ${nomeSocio}` : ""
            } — ${mesesTexto} — ${formatarMoeda(total)}`,
            memberId,
          });
        }

        const transacao = await CashTransactionModel.create({
          financial_account_id: dados.financial_account_id,
          transaction_type: "RECEITA",
          amount: total,
          transaction_date: dados.payment_date,
          competence_date: competencia.get(ordenados[0].parcela_id) ?? dados.payment_date,
          description: `Mensalidades ${mesesTexto}${nomeSocio ? ` — ${nomeSocio}` : ""}`,
          payment_method_id: dados.payment_method_id ?? null,
          source_type: "MEMBERSHIP_PAYMENT",
          source_id: null,
        });
        lancamentoId = transacao.id;
        lancamentoCodigo = codigoLancamento(transacao.ano, transacao.numero) ?? "";

        for (let i = 0; i < ordenados.length; i++) {
          const pagamentoId = newId();
          pagamentosCriados.push(pagamentoId);
          await db.execute(
            `INSERT INTO membership_payments
               (id, association_id, member_id, parcela_id, cash_transaction_id, paid_amount, paid_at, payment_method,
                receipt_number, protocol_entry_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              pagamentoId,
              associationId,
              memberId,
              ordenados[i].parcela_id,
              transacao.id,
              ordenados[i].amount,
              dados.payment_date,
              dados.payment_method_label ?? null,
              recibo.receiptNumber,
              recibo.protocolEntryId,
            ]
          );
        }
        } catch (erro) {
          await desfazerBaixaParcial({
            pagamentos: pagamentosCriados,
            lancamentoId,
            protocolos: [recibo.protocolEntryId],
          });
          throw erro;
        }
        return { numero: recibo.receiptNumber, lancamentoCodigo, primeiroPagamentoId: pagamentosCriados[0] };
      },
      ({ numero, lancamentoCodigo }) => ({
        module: "MENSALIDADES",
        description: `Pagamento de ${ordenados.length} mensalidade(s) — ${nomeSocio ?? "sócio"} — ${mesesTexto} — ${formatarMoeda(
          total
        )} num único lançamento${lancamentoCodigo ? ` ${lancamentoCodigo}` : ""}${
          numero ? ` (recibo único ${numero})` : ""
        }`,
        entity_type: "MEMBER",
        entity_id: memberId,
      })
    );
  }

  /** Pagamentos do sócio com a situação do lançamento — base do resumo e do reset. */
  private static async pagamentosParaReset(memberId: string) {
    const db = await getDatabase();
    return db.select<
      {
        id: string;
        cash_transaction_id: string | null;
        cash_status: string | null;
        cash_amount: number | null;
        competence_month: string;
        paid_amount: number;
        membership_agreement_id: string | null;
        protocol_entry_id: string | null;
      }[]
    >(
      `SELECT mp.id, mp.cash_transaction_id, ct.status AS cash_status, ct.amount AS cash_amount,
              pa.competence_month, mp.paid_amount, mp.membership_agreement_id, mp.protocol_entry_id
       FROM membership_payments mp
       JOIN parcelas pa ON pa.id = mp.parcela_id
       LEFT JOIN cash_transactions ct ON ct.id = mp.cash_transaction_id
       WHERE mp.member_id = $1 AND mp.association_id = $2
       ORDER BY pa.competence_month`,
      [memberId, getCurrentAssociationId()]
    );
  }

  /** Prévia do reset (`resetarDoSocio`): quantas mensalidades, quanto sai do caixa, acordos e recibos. */
  static async resumoReset(memberId: string): Promise<ResumoResetMensalidades> {
    const pagamentos = await MembershipPaymentModel.pagamentosParaReset(memberId);
    const lancamentos = new Map<string, number>();
    for (const p of pagamentos) {
      if (p.cash_transaction_id && p.cash_status === "CONFIRMADA") {
        lancamentos.set(p.cash_transaction_id, p.cash_amount ?? 0);
      }
    }
    return {
      pagamentos: pagamentos.length,
      meses: pagamentos.map((p) => formatarCompetenciaCurta(p.competence_month)),
      valorPago: pagamentos.reduce((soma, p) => soma + p.paid_amount, 0),
      lancamentosAEstornar: lancamentos.size,
      valorAEstornar: [...lancamentos.values()].reduce((soma, v) => soma + v, 0),
      acordos: new Set(pagamentos.map((p) => p.membership_agreement_id).filter(Boolean)).size,
      recibos: new Set(pagamentos.map((p) => p.protocol_entry_id).filter(Boolean)).size,
    };
  }

  /**
   * Reseta TODAS as mensalidades pagas de um sócio — pra quando os
   * pagamentos foram registrados errado. Justificativa obrigatória, que vai
   * pra linha de Atividades (uma linha só pro reset inteiro: as chamadas
   * internas de estorno ficam dentro do mesmo `comAtividade`).
   *
   * O caixa fica coerente com as mensalidades: em vez de só apagar os
   * pagamentos (o dinheiro continuaria no caixa sem mensalidade paga), cada
   * lançamento ligado é ESTORNADO (`CashTransactionModel.reverse`, que já
   * reabre as mensalidades, desfaz o acordo e cancela o recibo). Lançamento
   * que já estava estornado (antes de o estorno desfazer as baixas) só tem
   * as baixas desfeitas; pagamento antigo sem lançamento é apagado direto.
   *
   * Todo lançamento de mensalidade é de um sócio só (avulso: um por mês;
   * acordo e pagamento de vários meses: um por operação, do mesmo sócio) —
   * ainda assim, se algum estiver ligado a outro sócio, o reset para antes
   * de mexer em qualquer coisa.
   */
  static async resetarDoSocio(memberId: string, justificativa: string): Promise<void> {
    const motivo = justificativa.trim();
    if (!motivo) throw new Error("Informe a justificativa do reset.");

    const db = await getDatabase();
    const pagamentos = await MembershipPaymentModel.pagamentosParaReset(memberId);
    if (pagamentos.length === 0) throw new Error("Este sócio não tem nenhuma mensalidade paga.");

    const [socio] = await db.select<{ full_name: string; registration_number: string }[]>(
      `SELECT pe.full_name, m.registration_number FROM members m JOIN people pe ON pe.id = m.person_id WHERE m.id = $1`,
      [memberId]
    );

    const lancamentos = [...new Set(pagamentos.map((p) => p.cash_transaction_id).filter((id): id is string => !!id))];
    for (const lancamentoId of lancamentos) {
      const [{ total }] = await db.select<{ total: number }[]>(
        "SELECT COUNT(*) AS total FROM membership_payments WHERE cash_transaction_id = $1 AND member_id <> $2",
        [lancamentoId, memberId]
      );
      if (total > 0) {
        throw new Error(
          "Um dos lançamentos destas mensalidades também paga mensalidade de outro sócio — o reset foi cancelado sem mudar nada."
        );
      }
    }

    const resumo = await MembershipPaymentModel.resumoReset(memberId);

    await comAtividade(
      async () => {
        for (const lancamentoId of lancamentos) {
          const status = pagamentos.find((p) => p.cash_transaction_id === lancamentoId)?.cash_status;
          if (status === "CONFIRMADA") {
            await CashTransactionModel.reverse(lancamentoId, `Reset das mensalidades do sócio — ${motivo}`);
          } else if (status === "ESTORNADA") {
            await CashTransactionModel.desfazerBaixas(lancamentoId);
          }
        }

        // Sobra o que não tinha lançamento confirmado/estornado (pagamento antigo sem lançamento, ou lançamento
        // em outra situação): apaga direto, com a mesma limpeza de acordo e recibo do estorno.
        const restantes = await db.select<{ membership_agreement_id: string | null; protocol_entry_id: string | null }[]>(
          "SELECT membership_agreement_id, protocol_entry_id FROM membership_payments WHERE member_id = $1",
          [memberId]
        );
        if (restantes.length > 0) {
          await db.execute("DELETE FROM membership_payments WHERE member_id = $1", [memberId]);
          for (const acordoId of new Set(restantes.map((r) => r.membership_agreement_id).filter(Boolean))) {
            await db.execute(
              `DELETE FROM membership_agreements
               WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM membership_payments WHERE membership_agreement_id = $1)`,
              [acordoId]
            );
          }
          for (const protocoloId of new Set(restantes.map((r) => r.protocol_entry_id).filter(Boolean))) {
            await db.execute("UPDATE protocol_entries SET status = 'CANCELADO' WHERE id = $1", [protocoloId]);
          }
        }
        // Prestações de serviço que ficaram sem nenhum mês (o PDF continua em Documentos).
        await db.execute(
          `DELETE FROM membership_services
           WHERE member_id = $1 AND NOT EXISTS (SELECT 1 FROM membership_payments WHERE membership_service_id = membership_services.id)`,
          [memberId]
        );
      },
      () => ({
        module: "MENSALIDADES",
        description: [
          `Mensalidades resetadas — ${socio?.full_name ?? "sócio"} (matrícula ${socio?.registration_number ?? "?"})`,
          `— ${resumo.pagamentos} mensalidade(s) reaberta(s): ${resumo.meses.join(", ")}`,
          resumo.lancamentosAEstornar > 0
            ? `— ${resumo.lancamentosAEstornar} lançamento(s) estornado(s) no caixa (${formatarMoeda(resumo.valorAEstornar)})`
            : "",
          resumo.acordos > 0 ? `— ${resumo.acordos} acordo(s) desfeito(s)` : "",
          resumo.recibos > 0 ? `— ${resumo.recibos} recibo(s) cancelado(s)` : "",
          `— justificativa: ${motivo}`,
        ]
          .filter(Boolean)
          .join(" "),
        entity_type: "MEMBER",
        entity_id: memberId,
      })
    );
  }
}
