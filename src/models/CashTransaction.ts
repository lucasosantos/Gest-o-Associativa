import type Database from "@tauri-apps/plugin-sql";
import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { comAtividade } from "./ActivityLog.js";
import { formatarData, formatarMoeda, hojeIso } from "../utils/format.js";
import { codigoAcordo, codigoLancamento, codigoMensalidade } from "../utils/codigos.js";

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
  /** Ano do número legível (= ano de `transaction_date`) — migration `version: 25`. */
  ano: number | null;
  /** Nº sequencial no ano — código `01-L-2026-000123` (ver `codigoLancamento`). */
  numero: number | null;
}

/** Código legível do lançamento (`01-L-2026-000123`), ou "—" se não tiver número. */
export function codigoDoLancamento(t: Pick<CashTransaction, "ano" | "numero">): string {
  return codigoLancamento(t.ano, t.numero) ?? "—";
}

/** Lançamento com nomes já resolvidos, para exibição em lista. */
export interface CashTransactionComNomes extends CashTransaction {
  /** Nome da conta financeira — coluna "Conta" quando a aba Lançamentos mostra todas as contas. */
  account_name: string;
  category_name: string | null;
  cost_center_name: string | null;
  payment_method_name: string | null;
  /**
   * Quantos registros este lançamento quita (mensalidades, parcela de conta
   * a pagar/receber, doação, evento de patrimônio) — >0 = estornar desfaz
   * esses registros junto. Só vem nas listas da aba Lançamentos
   * (`list`/`listByAccount`).
   */
  quitacoes_count?: number;
  /**
   * Saldo logo DEPOIS deste lançamento (centavos) — da conta, ou de todas as
   * contas somadas na lista "Todas as contas". `null` em lançamento que não
   * mexe no saldo (cancelado/pendente). Só vem em `list`/`listByAccount`.
   */
  saldo_apos?: number | null;
}

/** Um registro quitado por um lançamento (modal "Vínculos" do Financeiro). */
export interface VinculoLancamento {
  tipo: string;
  /** Código legível quando existe (mensalidade/acordo). */
  codigo: string | null;
  descricao: string;
  valor: number | null;
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
  /** Tipo do lançamento original, quando este é um ESTORNO (pra saber se abate entradas ou saídas). */
  original_type: TipoLancamento | null;
}

/** Totais da prestação de contas — ver `totaisDoPeriodo`. Centavos. */
export interface TotaisPeriodo {
  /** Receitas, menos estornos de receita. */
  entradas: number;
  /** Despesas, menos estornos de despesa. */
  saidas: number;
  /** Entradas − saídas (transferências entre contas não mudam o total). */
  saldo: number;
  /** Quanto foi movido entre contas da própria associação (só informativo). */
  transferido: number;
}

/**
 * Entradas e saídas de verdade do período. Transferência entre contas da
 * associação NÃO é entrada nem saída (o dinheiro só mudou de conta); estorno
 * de receita abate as entradas e estorno de despesa abate as saídas — antes
 * a prestação somava tudo pelo sinal, e uma transferência de R$ 1.000
 * aparecia como R$ 1.000 de entrada E de saída.
 */
export function totaisDoPeriodo(lancamentos: CashTransactionRelatorio[]): TotaisPeriodo {
  let entradas = 0;
  let saidas = 0;
  let transferido = 0;
  for (const l of lancamentos) {
    const tipo = l.transaction_type === "ESTORNO" ? l.original_type : l.transaction_type;
    if (tipo === "RECEITA") entradas += l.signed_amount;
    else if (tipo === "DESPESA") saidas -= l.signed_amount;
    else if (l.transaction_type === "TRANSFERENCIA_SAIDA") transferido += l.amount;
    else if (l.transaction_type === "ESTORNO" && tipo === "TRANSFERENCIA_SAIDA") transferido -= l.amount;
  }
  return { entradas, saidas, saldo: entradas - saidas, transferido };
}

/**
 * Saldo depois de cada lançamento, a partir do saldo de antes do período
 * (`saldoInicial`). `lancamentos` em ordem cronológica (como vem de
 * `listarPorPeriodo` e do extrato). Usado nos relatórios impressos.
 */
export function saldosApos(lancamentos: { signed_amount: number }[], saldoInicial: number): number[] {
  let saldo = saldoInicial;
  return lancamentos.map((l) => (saldo += l.signed_amount));
}

/**
 * Registros que apontam pra um lançamento de caixa (FK `cash_transaction_id`).
 * Um lançamento estornado que ainda tem um desses ligado NÃO pode ser
 * apagado: o registro ficaria sem o lançamento correspondente (e a FK
 * bloquearia o `DELETE` de qualquer jeito). Ver `apagarEstornado`.
 */
const VINCULOS_LANCAMENTO: { tabela: string; descricao: string }[] = [
  { tabela: "membership_payments", descricao: "é o pagamento de mensalidade de um sócio (Cobranças)" },
  { tabela: "payable_payments", descricao: "é o pagamento de uma conta a pagar" },
  { tabela: "receivable_payments", descricao: "é o recebimento de uma conta a receber" },
  { tabela: "donations", descricao: "está ligado a uma doação" },
  { tabela: "asset_events", descricao: "está ligado a um evento de patrimônio" },
];

/**
 * Desfaz as mensalidades quitadas por um lançamento (pagamento avulso ou
 * acordo de renegociação): apaga as linhas de `membership_payments` — a
 * mensalidade volta a ficar em aberto/vencida e pode ser paga de novo
 * (`UNIQUE(member_id, parcela_id)` impediria) —, apaga o acordo que ficou
 * sem nenhuma parcela e marca o recibo (protocolo) como `CANCELADO`, que
 * continua no livro com o número. Chamado DENTRO de um `comAtividade`
 * (`reverse` e `reabrirMensalidades`), que registra a linha de histórico com
 * o texto devolvido aqui. `null` = o lançamento não era de mensalidade.
 *
 * SQL direto (sem `MembershipPaymentModel`) porque aquele model importa
 * este — evita import circular.
 */
async function desfazerMensalidadesDoLancamento(db: Database, cashTransactionId: string): Promise<string | null> {
  const pagamentos = await db.select<
    {
      membership_agreement_id: string | null;
      protocol_entry_id: string | null;
      receipt_number: string | null;
      competence_month: string;
      full_name: string;
      registration_number: string;
    }[]
  >(
    `SELECT mp.membership_agreement_id, mp.protocol_entry_id, mp.receipt_number, pa.competence_month,
            pe.full_name, m.registration_number
     FROM membership_payments mp
     JOIN parcelas pa ON pa.id = mp.parcela_id
     JOIN members m ON m.id = mp.member_id
     JOIN people pe ON pe.id = m.person_id
     WHERE mp.cash_transaction_id = $1
     ORDER BY pe.full_name, pa.competence_month`,
    [cashTransactionId]
  );
  if (pagamentos.length === 0) return null;

  await db.execute("DELETE FROM membership_payments WHERE cash_transaction_id = $1", [cashTransactionId]);

  const acordos = [...new Set(pagamentos.map((p) => p.membership_agreement_id).filter((id): id is string => !!id))];
  for (const acordoId of acordos) {
    await db.execute(
      `DELETE FROM membership_agreements
       WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM membership_payments WHERE membership_agreement_id = $1)`,
      [acordoId]
    );
  }

  const protocolos = [...new Set(pagamentos.map((p) => p.protocol_entry_id).filter((id): id is string => !!id))];
  for (const protocoloId of protocolos) {
    await db.execute("UPDATE protocol_entries SET status = 'CANCELADO' WHERE id = $1", [protocoloId]);
  }

  // "Fulano (matrícula 12): 03/2026, 04/2026" — agrupado por sócio.
  const porSocio = new Map<string, string[]>();
  for (const p of pagamentos) {
    const chave = `${p.full_name} (matrícula ${p.registration_number})`;
    porSocio.set(chave, [...(porSocio.get(chave) ?? []), codigoMensalidade(p.registration_number, p.competence_month)]);
  }
  const socios = [...porSocio].map(([socio, meses]) => `${socio}: ${meses.join(", ")}`).join("; ");
  const recibos = [...new Set(pagamentos.map((p) => p.receipt_number).filter(Boolean))];

  return [
    `${pagamentos.length} mensalidade(s) reaberta(s) — ${socios}`,
    acordos.length > 0 ? "acordo de renegociação desfeito" : "",
    recibos.length > 0 ? `recibo ${recibos.join(", ")} cancelado` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Tabelas de conta a pagar / a receber — o mesmo desfazer serve pras duas. */
interface ConfigParcelas {
  pagamentos: string;
  fkParcela: string;
  dataPagamento: string;
  parcelas: string;
  valorQuitado: string;
  dataQuitacao: string;
  quitada: string;
  contas: string;
  fkConta: string;
  rotulo: string;
  verbo: string;
}

const PARCELAS_A_PAGAR: ConfigParcelas = {
  pagamentos: "payable_payments",
  fkParcela: "payable_installment_id",
  dataPagamento: "paid_at",
  parcelas: "payable_installments",
  valorQuitado: "paid_amount",
  dataQuitacao: "paid_at",
  quitada: "PAGA",
  contas: "payables",
  fkConta: "payable_id",
  rotulo: "conta a pagar",
  verbo: "pagamento",
};

const PARCELAS_A_RECEBER: ConfigParcelas = {
  pagamentos: "receivable_payments",
  fkParcela: "receivable_installment_id",
  dataPagamento: "received_at",
  parcelas: "receivable_installments",
  valorQuitado: "received_amount",
  dataQuitacao: "received_at",
  quitada: "RECEBIDA",
  contas: "receivables",
  fkConta: "receivable_id",
  rotulo: "conta a receber",
  verbo: "recebimento",
};

/**
 * Desfaz a baixa de parcela (conta a pagar ou a receber) feita por um
 * lançamento: apaga o pagamento e RECALCULA a parcela a partir dos
 * pagamentos que sobraram (uma parcela pode ter várias baixas parciais) —
 * valor quitado, situação (aberta/parcial/quitada) e data de quitação — e
 * depois a situação da conta, com a mesma regra de
 * `PayableModel.refreshStatus`/`ReceivableModel.refreshStatus` (aqueles
 * models importam este, então a regra vai em SQL). Parcela `CANCELADA` não
 * muda de situação.
 */
async function desfazerBaixaDeParcela(db: Database, c: ConfigParcelas, cashTransactionId: string): Promise<string | null> {
  const baixas = await db.select<
    { parcela_id: string; conta_id: string; installment_number: number; description: string; amount: number }[]
  >(
    `SELECT pg.${c.fkParcela} AS parcela_id, pa.${c.fkConta} AS conta_id, pa.installment_number,
            co.description, pg.amount
     FROM ${c.pagamentos} pg
     JOIN ${c.parcelas} pa ON pa.id = pg.${c.fkParcela}
     JOIN ${c.contas} co ON co.id = pa.${c.fkConta}
     WHERE pg.cash_transaction_id = $1`,
    [cashTransactionId]
  );
  if (baixas.length === 0) return null;

  await db.execute(`DELETE FROM ${c.pagamentos} WHERE cash_transaction_id = $1`, [cashTransactionId]);

  for (const parcelaId of new Set(baixas.map((b) => b.parcela_id))) {
    await recalcularParcelaPelaSoma(db, c, parcelaId);
  }
  for (const contaId of new Set(baixas.map((b) => b.conta_id))) {
    await recalcularContaPelasParcelas(db, c, contaId);
  }

  return baixas
    .map((b) => `${c.verbo} da parcela ${b.installment_number} da ${c.rotulo} "${b.description}" (${formatarMoeda(b.amount)}) desfeito`)
    .join("; ");
}

/**
 * Valor quitado, situação e data de quitação da parcela recalculados a
 * partir da SOMA dos pagamentos dela (nunca "valor lido antes + este
 * pagamento": se algo falhou no meio, a soma continua a verdade).
 * Parcela `CANCELADA` não muda de situação.
 */
async function recalcularParcelaPelaSoma(db: Database, c: ConfigParcelas, parcelaId: string): Promise<void> {
  const soma = `COALESCE((SELECT SUM(amount) FROM ${c.pagamentos} WHERE ${c.fkParcela} = $1), 0)`;
  await db.execute(
    `UPDATE ${c.parcelas} SET
       ${c.valorQuitado} = ${soma},
       status = CASE
         WHEN status = 'CANCELADA' THEN status
         WHEN ${soma} >= original_amount + interest_amount - discount_amount THEN '${c.quitada}'
         WHEN ${soma} > 0 THEN 'PARCIAL'
         ELSE 'ABERTA'
       END,
       ${c.dataQuitacao} = CASE
         WHEN ${soma} >= original_amount + interest_amount - discount_amount
           THEN (SELECT MAX(${c.dataPagamento}) FROM ${c.pagamentos} WHERE ${c.fkParcela} = $1)
         ELSE NULL
       END
     WHERE id = $1`,
    [parcelaId]
  );
}

/** Situação da conta a pagar/receber pelas parcelas (mesma regra de `PayableModel.refreshStatus`). */
async function recalcularContaPelasParcelas(db: Database, c: ConfigParcelas, contaId: string): Promise<void> {
  await db.execute(
    `UPDATE ${c.contas} SET status = CASE
       WHEN NOT EXISTS (SELECT 1 FROM ${c.parcelas} WHERE ${c.fkConta} = $1 AND status <> 'CANCELADA') THEN 'CANCELADA'
       WHEN NOT EXISTS (SELECT 1 FROM ${c.parcelas} WHERE ${c.fkConta} = $1 AND status NOT IN ('CANCELADA', '${c.quitada}'))
         THEN '${c.quitada}'
       WHEN EXISTS (SELECT 1 FROM ${c.parcelas} WHERE ${c.fkConta} = $1 AND status IN ('${c.quitada}', 'PARCIAL'))
         THEN 'PARCIAL'
       ELSE 'ABERTA'
     END
     WHERE id = $1`,
    [contaId]
  );
}

/** Recalcula parcela e conta (a pagar ou a receber) pela soma dos pagamentos — usado pela verificação de consistência. */
export async function recalcularParcelaDeConta(tipo: "PAGAR" | "RECEBER", parcelaId: string, contaId: string): Promise<void> {
  const c = tipo === "PAGAR" ? PARCELAS_A_PAGAR : PARCELAS_A_RECEBER;
  const db = await getDatabase();
  await recalcularParcelaPelaSoma(db, c, parcelaId);
  await recalcularContaPelasParcelas(db, c, contaId);
}

/**
 * Baixa de parcela de conta a pagar (`PAGAR`) ou a receber (`RECEBER`) já
 * com o lançamento criado: grava o pagamento e recalcula parcela e conta
 * pela soma. Se falhar, desfaz o pagamento e o lançamento recém-criado (sem
 * isso sobrava dinheiro no caixa sem baixa, e a parcela era paga de novo).
 * Usado por `PayableModel.payInstallment` e `ReceivableModel.receiveInstallment`.
 */
export async function registrarBaixaDeParcela(
  tipo: "PAGAR" | "RECEBER",
  dados: { parcelaId: string; contaId: string; cashTransactionId: string; amount: number; data: string }
): Promise<void> {
  const c = tipo === "PAGAR" ? PARCELAS_A_PAGAR : PARCELAS_A_RECEBER;
  const db = await getDatabase();
  const pagamentoId = newId();
  try {
    await db.execute(
      `INSERT INTO ${c.pagamentos} (id, ${c.fkParcela}, cash_transaction_id, amount, ${c.dataPagamento})
       VALUES ($1, $2, $3, $4, $5)`,
      [pagamentoId, dados.parcelaId, dados.cashTransactionId, dados.amount, dados.data]
    );
    await recalcularParcelaPelaSoma(db, c, dados.parcelaId);
    await recalcularContaPelasParcelas(db, c, dados.contaId);
  } catch (erro) {
    await db.execute(`DELETE FROM ${c.pagamentos} WHERE id = $1`, [pagamentoId]).catch(() => undefined);
    await CashTransactionModel.descartarCriadoComErro(dados.cashTransactionId).catch(() => undefined);
    await recalcularParcelaPelaSoma(db, c, dados.parcelaId).catch(() => undefined);
    throw erro;
  }
}

/**
 * Doação estornada = doação desfeita: no app toda doação entra no caixa
 * (`DonationModel.create` sempre gera o lançamento), então sem o dinheiro
 * ela não aconteceu. O doador continua cadastrado.
 */
async function desfazerDoacaoDoLancamento(db: Database, cashTransactionId: string): Promise<string | null> {
  const doacoes = await db.select<{ amount: number; donor_name: string | null }[]>(
    `SELECT d.amount, dn.name AS donor_name
     FROM donations d LEFT JOIN donors dn ON dn.id = d.donor_id
     WHERE d.cash_transaction_id = $1`,
    [cashTransactionId]
  );
  if (doacoes.length === 0) return null;
  await db.execute("DELETE FROM donations WHERE cash_transaction_id = $1", [cashTransactionId]);
  return doacoes
    .map((d) => `doação de ${d.donor_name ?? "doador não informado"} (${formatarMoeda(d.amount)}) desfeita`)
    .join("; ");
}

/** Rótulos dos eventos de patrimônio que geram lançamento (cópia mínima de `ROTULO_EVENTO_BEM` — `Asset.ts` importa este). */
const ROTULO_EVENTO_COM_LANCAMENTO: Record<string, string> = {
  AQUISICAO: "aquisição",
  MANUTENCAO_RETORNO: "retorno de manutenção",
  BAIXA: "baixa",
};

/**
 * Evento de patrimônio continua na linha do tempo do bem — a compra, a
 * manutenção ou a venda aconteceram; o que foi estornado foi só o
 * lançamento no caixa. Por isso o evento só perde o vínculo
 * (`cash_transaction_id = NULL`), e o bem passa a poder ser excluído
 * normalmente se tiver sido cadastrado por engano.
 */
async function desvincularEventosDePatrimonio(db: Database, cashTransactionId: string): Promise<string | null> {
  const eventos = await db.select<{ event_type: string; name: string; asset_number: string }[]>(
    `SELECT ae.event_type, a.name, a.asset_number
     FROM asset_events ae JOIN assets a ON a.id = ae.asset_id
     WHERE ae.cash_transaction_id = $1`,
    [cashTransactionId]
  );
  if (eventos.length === 0) return null;
  await db.execute("UPDATE asset_events SET cash_transaction_id = NULL WHERE cash_transaction_id = $1", [
    cashTransactionId,
  ]);
  return eventos
    .map(
      (e) =>
        `evento de ${ROTULO_EVENTO_COM_LANCAMENTO[e.event_type] ?? e.event_type.toLowerCase()} do bem ${e.name} (nº ${
          e.asset_number
        }) ficou sem lançamento no caixa`
    )
    .join("; ");
}

/**
 * Desfaz TUDO o que um lançamento quitava (mensalidades/acordo, parcela de
 * conta a pagar ou a receber, doação, evento de patrimônio) — antes, estornar
 * só mexia no caixa e esses registros continuavam "pagos". Chamado dentro do
 * `comAtividade` de `reverse` e `desfazerBaixas`; devolve o texto pra linha
 * de Atividades, ou `null` se o lançamento não quitava nada.
 */
export async function desfazerQuitacoesDoLancamento(db: Database, cashTransactionId: string): Promise<string | null> {
  const partes = [
    await desfazerMensalidadesDoLancamento(db, cashTransactionId),
    await desfazerBaixaDeParcela(db, PARCELAS_A_PAGAR, cashTransactionId),
    await desfazerBaixaDeParcela(db, PARCELAS_A_RECEBER, cashTransactionId),
    await desfazerDoacaoDoLancamento(db, cashTransactionId),
    await desvincularEventosDePatrimonio(db, cashTransactionId),
  ].filter((parte): parte is string => !!parte);
  return partes.length > 0 ? partes.join("; ") : null;
}

/** Quantos registros um lançamento quita, somando as tabelas de `VINCULOS_LANCAMENTO`. */
const CONTAGEM_VINCULOS_SQL = VINCULOS_LANCAMENTO.map(
  (v) => `(SELECT COUNT(*) FROM ${v.tabela} v WHERE v.cash_transaction_id = t.id)`
).join(" + ");

/** Valor assinado só dos lançamentos que contam no saldo (mesma regra de `FinancialAccountModel`). */
const SINAL_NO_SALDO_SQL = `CASE WHEN t.status IN ('CONFIRMADA', 'ESTORNADA') THEN (${SINAL_LANCAMENTO_SQL}) ELSE 0 END`;

/**
 * Lista da aba Lançamentos com o saldo depois de cada linha: saldo inicial
 * (`$saldoInicial`) + soma acumulada em ordem de data/criação. `particao`
 * = `PARTITION BY ...` (por conta) ou vazio (todas as contas somadas).
 */
function selectComNomes(saldoInicialSql: string, particao: string): string {
  return `
  SELECT
    t.*,
    fa.name AS account_name,
    fc.name AS category_name,
    cc.name AS cost_center_name,
    pm.name AS payment_method_name,
    (${CONTAGEM_VINCULOS_SQL}) AS quitacoes_count,
    CASE WHEN t.status IN ('CONFIRMADA', 'ESTORNADA') THEN
      ${saldoInicialSql} + SUM(${SINAL_NO_SALDO_SQL}) OVER (
        ${particao} ORDER BY t.transaction_date, t.created_at, t.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    END AS saldo_apos
  FROM cash_transactions t
  JOIN financial_accounts fa ON fa.id = t.financial_account_id
  LEFT JOIN financial_categories fc ON fc.id = t.financial_category_id
  LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
  LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
  ${JUNCAO_SINAL_LANCAMENTO}
`;
}

/**
 * Grava um lançamento já com o número legível do ano (`MAX + 1` no próprio
 * INSERT — atômico no SQLite, sem tabela de contador). Todo INSERT em
 * `cash_transactions` passa por aqui.
 */
async function inserirLancamento(
  db: Database,
  l: {
    id: string;
    association_id: string;
    financial_account_id: string;
    transaction_type: TipoLancamento;
    amount: number;
    transaction_date: string;
    competence_date: string;
    description: string;
    financial_category_id?: string | null;
    cost_center_id?: string | null;
    payment_method_id?: string | null;
    source_type?: string | null;
    source_id?: string | null;
    transfer_group_id?: string | null;
  }
): Promise<void> {
  await db.execute(
    `INSERT INTO cash_transactions
       (id, association_id, financial_account_id, transaction_type, amount, transaction_date, competence_date,
        description, financial_category_id, cost_center_id, payment_method_id, source_type, source_id,
        transfer_group_id, ano, numero)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       CAST(substr($6, 1, 4) AS INTEGER),
       (SELECT COALESCE(MAX(numero), 0) + 1 FROM cash_transactions
        WHERE association_id = $2 AND ano = CAST(substr($6, 1, 4) AS INTEGER)))`,
    [
      l.id,
      l.association_id,
      l.financial_account_id,
      l.transaction_type,
      l.amount,
      l.transaction_date,
      l.competence_date,
      l.description,
      l.financial_category_id ?? null,
      l.cost_center_id ?? null,
      l.payment_method_id ?? null,
      l.source_type ?? null,
      l.source_id ?? null,
      l.transfer_group_id ?? null,
    ]
  );
}

/** Acesso à tabela `cash_transactions` e operações de negócio do caixa. */
export class CashTransactionModel {
  static async listByAccount(accountId: string): Promise<CashTransactionComNomes[]> {
    const db = await getDatabase();
    return db.select<CashTransactionComNomes[]>(
      `${selectComNomes("fa.opening_balance", "")}
       WHERE t.financial_account_id = $1 ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC`,
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
              fa.name AS account_name, (${SINAL_LANCAMENTO_SQL}) AS signed_amount, o.transaction_type AS original_type
       FROM cash_transactions t
       LEFT JOIN financial_categories fc ON fc.id = t.financial_category_id
       LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
       LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
       JOIN financial_accounts fa ON fa.id = t.financial_account_id
       ${JUNCAO_SINAL_LANCAMENTO}
       WHERE t.association_id = $1 AND t.status IN ('CONFIRMADA', 'ESTORNADA')
         AND t.transaction_date BETWEEN $2 AND $3
       ORDER BY t.transaction_date, t.created_at, t.id`,
      [getCurrentAssociationId(), dataInicio, dataFim]
    );
  }

  /** Todos os lançamentos, de todas as contas; `saldo_apos` = soma de todas as contas depois de cada linha. */
  static async list(): Promise<CashTransactionComNomes[]> {
    const db = await getDatabase();
    const saldosIniciais = "(SELECT COALESCE(SUM(opening_balance), 0) FROM financial_accounts WHERE association_id = $1)";
    return db.select<CashTransactionComNomes[]>(
      `${selectComNomes(saldosIniciais, "")}
       WHERE t.association_id = $1 ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC`,
      [getCurrentAssociationId()]
    );
  }

  /**
   * Saldo somado de todas as contas ANTES de uma data — ponto de partida do
   * "saldo após" da prestação de contas (`ImprimirPrestacaoContas.vue`).
   */
  static async saldoTotalAntes(data: string): Promise<number> {
    const db = await getDatabase();
    const associationId = getCurrentAssociationId();
    const [{ total }] = await db.select<{ total: number | null }[]>(
      `SELECT
         (SELECT COALESCE(SUM(opening_balance), 0) FROM financial_accounts WHERE association_id = $1)
         + COALESCE((SELECT SUM(${SINAL_LANCAMENTO_SQL}) FROM cash_transactions t ${JUNCAO_SINAL_LANCAMENTO}
                     WHERE t.association_id = $1 AND t.status IN ('CONFIRMADA', 'ESTORNADA')
                       AND t.transaction_date < $2), 0) AS total`,
      [associationId, data]
    );
    return total ?? 0;
  }

  /** O que um lançamento quita — modal "Vínculos" da aba Lançamentos. */
  static async vinculos(id: string): Promise<VinculoLancamento[]> {
    const db = await getDatabase();
    const itens: VinculoLancamento[] = [];

    const mensalidades = await db.select<
      {
        competence_month: string;
        registration_number: string;
        full_name: string;
        paid_amount: number;
        receipt_number: string | null;
        acordo_numero: number | null;
      }[]
    >(
      `SELECT pa.competence_month, m.registration_number, pe.full_name, mp.paid_amount, mp.receipt_number,
              ma.numero AS acordo_numero
       FROM membership_payments mp
       JOIN parcelas pa ON pa.id = mp.parcela_id
       JOIN members m ON m.id = mp.member_id
       JOIN people pe ON pe.id = m.person_id
       LEFT JOIN membership_agreements ma ON ma.id = mp.membership_agreement_id
       WHERE mp.cash_transaction_id = $1
       ORDER BY pe.full_name, pa.competence_month`,
      [id]
    );
    for (const m of mensalidades) {
      const [ano, mes] = m.competence_month.split("-");
      const acordo = codigoAcordo(m.registration_number, m.acordo_numero);
      itens.push({
        tipo: "Mensalidade",
        codigo: codigoMensalidade(m.registration_number, m.competence_month),
        descricao: `${m.full_name} (matrícula ${m.registration_number}) — ${mes}/${ano}${
          acordo ? ` — acordo ${acordo}` : ""
        }${m.receipt_number ? ` — recibo ${m.receipt_number}` : ""}`,
        valor: m.paid_amount,
      });
    }

    for (const c of [PARCELAS_A_PAGAR, PARCELAS_A_RECEBER]) {
      const baixas = await db.select<{ installment_number: number; description: string; amount: number }[]>(
        `SELECT pa.installment_number, co.description, pg.amount
         FROM ${c.pagamentos} pg
         JOIN ${c.parcelas} pa ON pa.id = pg.${c.fkParcela}
         JOIN ${c.contas} co ON co.id = pa.${c.fkConta}
         WHERE pg.cash_transaction_id = $1`,
        [id]
      );
      for (const b of baixas) {
        itens.push({
          tipo: c === PARCELAS_A_PAGAR ? "Conta a pagar" : "Conta a receber",
          codigo: null,
          descricao: `Parcela ${b.installment_number} — ${b.description}`,
          valor: b.amount,
        });
      }
    }

    const doacoes = await db.select<{ amount: number; donor_name: string | null }[]>(
      `SELECT d.amount, dn.name AS donor_name FROM donations d LEFT JOIN donors dn ON dn.id = d.donor_id
       WHERE d.cash_transaction_id = $1`,
      [id]
    );
    for (const d of doacoes) {
      itens.push({ tipo: "Doação", codigo: null, descricao: d.donor_name ?? "Doador não informado", valor: d.amount });
    }

    const eventos = await db.select<{ event_type: string; name: string; asset_number: string; amount: number | null }[]>(
      `SELECT ae.event_type, a.name, a.asset_number, ae.amount
       FROM asset_events ae JOIN assets a ON a.id = ae.asset_id WHERE ae.cash_transaction_id = $1`,
      [id]
    );
    for (const e of eventos) {
      itens.push({
        tipo: "Patrimônio",
        codigo: null,
        descricao: `${ROTULO_EVENTO_COM_LANCAMENTO[e.event_type] ?? e.event_type.toLowerCase()} — ${e.name} (nº ${e.asset_number})`,
        valor: e.amount,
      });
    }

    const estornos = await db.select<{ papel: string; ano: number | null; numero: number | null; description: string }[]>(
      `SELECT 'estornado por' AS papel, e.ano, e.numero, e.description
       FROM cash_transaction_reversals r JOIN cash_transactions e ON e.id = r.reversal_transaction_id
       WHERE r.original_transaction_id = $1
       UNION ALL
       SELECT 'estorno de' AS papel, o.ano, o.numero, o.description
       FROM cash_transaction_reversals r JOIN cash_transactions o ON o.id = r.original_transaction_id
       WHERE r.reversal_transaction_id = $1
       UNION ALL
       SELECT 'outra perna da transferência' AS papel, x.ano, x.numero, fa.name
       FROM cash_transactions t JOIN cash_transactions x ON x.transfer_group_id = t.transfer_group_id AND x.id <> t.id
       JOIN financial_accounts fa ON fa.id = x.financial_account_id
       WHERE t.id = $1 AND t.transfer_group_id IS NOT NULL`,
      [id]
    );
    for (const e of estornos) {
      itens.push({ tipo: "Lançamento", codigo: codigoLancamento(e.ano, e.numero), descricao: `${e.papel}: ${e.description}`, valor: null });
    }

    return itens;
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
        await inserirLancamento(db, { ...dados, id, association_id: associationId });

        const [criado] = await db.select<CashTransaction[]>("SELECT * FROM cash_transactions WHERE id = $1", [id]);
        return criado;
      },
      (lancamento) => ({
        module: "FINANCEIRO",
        description: `${dados.transaction_type === "RECEITA" ? "Receita" : "Despesa"} lançada — ${codigoDoLancamento(
          lancamento
        )} — ${dados.description} — ${formatarMoeda(dados.amount)}`,
        entity_type: "CASH_TRANSACTION",
        entity_id: lancamento.id,
      })
    );
  }

  /**
   * Transferência entre contas da própria associação: gera dois lançamentos
   * vinculados por um mesmo `transfer_group_id` — uma saída na origem, uma
   * entrada no destino. Não entram como receita/despesa operacional nos
   * relatórios (ver `.claude/docs/dominio-associacoes.md`, seção 2.4).
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
        const saidaId = newId();
        const comum = {
          association_id: associationId,
          amount: dados.amount,
          transaction_date: dados.transaction_date,
          competence_date: dados.transaction_date,
          description: dados.description,
          transfer_group_id: grupo,
        };

        await inserirLancamento(db, {
          ...comum,
          id: saidaId,
          financial_account_id: dados.from_account_id,
          transaction_type: "TRANSFERENCIA_SAIDA",
        });
        try {
          await inserirLancamento(db, {
            ...comum,
            id: newId(),
            financial_account_id: dados.to_account_id,
            transaction_type: "TRANSFERENCIA_ENTRADA",
          });
        } catch (erro) {
          // Sem a entrada, a saída sozinha "sumiria" com o dinheiro — desfaz.
          await db.execute("DELETE FROM cash_transactions WHERE id = $1", [saidaId]);
          throw erro;
        }
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
   * altera o valor do registro original (ver `.claude/docs/dominio-associacoes.md`,
   * seção 6, regra de estorno). Um lançamento só pode ser estornado uma vez
   * (garantido por `UNIQUE(original_transaction_id)` em
   * `cash_transaction_reversals`).
   *
   * O que o lançamento quitava é desfeito no mesmo passo — mensalidades
   * reabertas (avulso ou acordo), parcela de conta a pagar/receber
   * recalculada, doação desfeita, evento de patrimônio desvinculado. Antes o
   * estorno só mexia no caixa e esses registros continuavam "pagos" (ver
   * `desfazerQuitacoesDoLancamento`).
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

    // Transferência = as duas pernas juntas: estornar só uma "criaria" ou
    // "sumiria" com o dinheiro no total das contas. Perna já estornada
    // (versão antiga estornava só uma) fica de fora.
    const db = await getDatabase();
    const lancamentos = original.transfer_group_id
      ? await db.select<CashTransaction[]>(
          `SELECT * FROM cash_transactions
           WHERE transfer_group_id = $1 AND status = 'CONFIRMADA'
           ORDER BY transaction_type DESC`,
          [original.transfer_group_id]
        )
      : [original];

    await comAtividade(
      async () => {
        const desfeitos: string[] = [];
        for (const lancamento of lancamentos) {
          const desfeito = await estornarUm(db, lancamento, reason ?? null);
          if (desfeito) desfeitos.push(desfeito);
        }
        return desfeitos.length > 0 ? desfeitos.join("; ") : null;
      },
      (desfeito) => ({
        module: "FINANCEIRO",
        description: `${lancamentos.length > 1 ? "Transferência estornada (as duas contas)" : "Lançamento estornado"} — ${lancamentos
          .map(codigoDoLancamento)
          .join(" e ")} — ${original.description} — ${formatarMoeda(original.amount)}${
          reason ? ` (motivo: ${reason})` : ""
        }${desfeito ? ` — ${desfeito}` : ""}`,
        entity_type: "CASH_TRANSACTION",
        entity_id: id,
      })
    );
  }

  /**
   * Correção de lançamentos estornados ANTES de o estorno passar a desfazer
   * o que ele quitava: o caixa já foi devolvido, mas mensalidades/acordo,
   * parcela de conta, doação ou evento de patrimônio continuaram "pagos".
   * Desfaz agora — mesma operação do estorno (`desfazerQuitacoesDoLancamento`).
   * Não é automático (nem migration): quem estornou pode ter relançado o
   * valor à mão e querer o registro quitado; o botão só aparece na linha
   * estornada que ainda quita algo.
   */
  static async desfazerBaixas(id: string): Promise<void> {
    const lancamento = await CashTransactionModel.get(id);
    if (!lancamento) throw new Error("Lançamento não encontrado.");
    if (lancamento.status !== "ESTORNADA") {
      throw new Error("Só dá para desfazer as baixas de um lançamento já estornado — estorne o lançamento.");
    }

    await comAtividade(
      async () => {
        const db = await getDatabase();
        const desfeito = await desfazerQuitacoesDoLancamento(db, id);
        if (!desfeito) throw new Error("Este lançamento não quita nenhum registro.");
        return desfeito;
      },
      (desfeito) => ({
        module: "FINANCEIRO",
        description: `Baixas desfeitas de lançamento já estornado — ${codigoDoLancamento(lancamento)} — ${lancamento.description} — ${formatarMoeda(
          lancamento.amount
        )} — ${desfeito}`,
        entity_type: "CASH_TRANSACTION",
        entity_id: id,
      })
    );
  }

  /**
   * Apaga de vez um lançamento que já foi estornado — pra lançamento feito
   * por engano. É a única exceção à regra "lançamento não se apaga, se
   * estorna", e só vale DEPOIS do estorno: apaga o PAR (o lançamento
   * original e o lançamento de `ESTORNO`) mais a ligação em
   * `cash_transaction_reversals` e os vínculos de documento (o documento em
   * si continua). Como os dois se anulavam, o saldo da conta não muda.
   * `id` pode ser do original ou do próprio estorno.
   *
   * O registro do que foi apagado fica em Atividades (com conta, datas,
   * valor e o motivo), que é imutável.
   *
   * Sem transação SQL (o projeto não usa — o `tauri-plugin-sql` trabalha com
   * pool de conexões), a ordem garante que nenhum passo intermediário mexa
   * no saldo: primeiro os dois viram `CANCELADA` num UPDATE só (saldo e
   * relatórios só somam `CONFIRMADA`/`ESTORNADA`, e o par se anulava), e só
   * então as linhas são apagadas. Se algo falhar no meio, sobra um par
   * `CANCELADA` fora das contas, que pode ser apagado de novo.
   */
  static async apagarEstornado(id: string, motivo: string): Promise<void> {
    const motivoLimpo = motivo.trim();
    if (!motivoLimpo) throw new Error("Informe o motivo da exclusão.");

    const db = await getDatabase();
    const clicado = await CashTransactionModel.get(id);
    if (!clicado) throw new Error("Lançamento não encontrado.");
    if (clicado.association_id !== getCurrentAssociationId()) {
      throw new Error("Este lançamento não pertence à associação ativa.");
    }

    // Sobra de uma exclusão interrompida: já está CANCELADA (fora do saldo)
    // e sem a ligação de estorno — só termina de apagar.
    if (clicado.status === "CANCELADA") {
      const [{ ligacoes }] = await db.select<{ ligacoes: number }[]>(
        `SELECT COUNT(*) AS ligacoes FROM cash_transaction_reversals
         WHERE original_transaction_id = $1 OR reversal_transaction_id = $1`,
        [id]
      );
      if (ligacoes === 0) {
        await bloquearSeTemVinculos(db, [id]);
        return comAtividade(
          async () => {
            await db.execute("DELETE FROM document_links WHERE entity_type = 'CASH_TRANSACTION' AND entity_id = $1", [id]);
            await db.execute("DELETE FROM cash_transactions WHERE id = $1", [id]);
          },
          () => ({
            module: "FINANCEIRO",
            description: `Lançamento cancelado apagado — ${codigoDoLancamento(clicado)} — ${clicado.description} — ${formatarMoeda(
              clicado.amount
            )} — motivo da exclusão: ${motivoLimpo}`,
          })
        );
      }
    }

    const [ligacao] = await buscarLigacoes(db, [id]);
    if (!ligacao) throw new Error("Só é possível apagar um lançamento que já foi estornado.");

    // Transferência: apaga as duas pernas (cada uma com seu estorno) juntas.
    const [originalClicado] = await db.select<CashTransaction[]>("SELECT * FROM cash_transactions WHERE id = $1", [
      ligacao.original_transaction_id,
    ]);
    if (!originalClicado) throw new Error("Lançamento não encontrado.");
    let ligacoes = [ligacao];
    if (originalClicado.transfer_group_id) {
      const pernas = await db.select<{ id: string; status: string }[]>(
        "SELECT id, status FROM cash_transactions WHERE transfer_group_id = $1",
        [originalClicado.transfer_group_id]
      );
      if (pernas.some((p) => p.status === "CONFIRMADA")) {
        throw new Error("A outra conta desta transferência ainda não foi estornada — estorne a transferência antes de apagar.");
      }
      ligacoes = await buscarLigacoes(
        db,
        pernas.map((p) => p.id)
      );
    }

    const pares: { original: CashTransaction; estorno: CashTransaction; reason: string | null; ligacaoId: string }[] = [];
    for (const l of ligacoes) {
      const [original, estorno] = await Promise.all([
        CashTransactionModel.get(l.original_transaction_id),
        CashTransactionModel.get(l.reversal_transaction_id),
      ]);
      if (!original || !estorno) throw new Error("Lançamento não encontrado.");
      pares.push({ original, estorno, reason: l.reason, ligacaoId: l.id });
    }

    const ids = pares.flatMap((p) => [p.original.id, p.estorno.id]);
    await bloquearSeTemVinculos(db, ids);

    const contas = await db.select<{ id: string; name: string }[]>("SELECT id, name FROM financial_accounts");
    const nomeConta = (contaId: string) => contas.find((c) => c.id === contaId)?.name ?? "?";
    const marcadores = ids.map((_, i) => `$${i + 1}`).join(", ");
    const [{ total: documentos }] = await db.select<{ total: number }[]>(
      `SELECT COUNT(*) AS total FROM document_links
       WHERE entity_type = 'CASH_TRANSACTION' AND entity_id IN (${marcadores})`,
      ids
    );

    return comAtividade(
      async () => {
        // 1º tudo CANCELADA num UPDATE só (sai do saldo — os pares se anulavam).
        await db.execute(`UPDATE cash_transactions SET status = 'CANCELADA' WHERE id IN (${marcadores})`, ids);
        await db.execute(
          `DELETE FROM document_links WHERE entity_type = 'CASH_TRANSACTION' AND entity_id IN (${marcadores})`,
          ids
        );
        for (const par of pares) {
          await db.execute("DELETE FROM cash_transaction_reversals WHERE id = $1", [par.ligacaoId]);
          await db.execute("DELETE FROM cash_transactions WHERE id = $1", [par.estorno.id]);
          await db.execute("DELETE FROM cash_transactions WHERE id = $1", [par.original.id]);
        }
      },
      () => ({
        module: "FINANCEIRO",
        // Sem entity_id: o lançamento deixou de existir, não há ficha pra abrir.
        description: [
          `Lançamento estornado apagado — ${pares
            .map((p) => `${codigoDoLancamento(p.original)} (estorno ${codigoDoLancamento(p.estorno)})`)
            .join(" e ")} — ${originalClicado.description} — ${formatarMoeda(originalClicado.amount)}`,
          `(${pares
            .map(
              (p) =>
                `${ROTULO_TIPO_LANCAMENTO[p.original.transaction_type]}, conta ${nomeConta(
                  p.original.financial_account_id
                )}, lançado em ${formatarData(p.original.transaction_date)}, estornado em ${formatarData(
                  p.estorno.transaction_date
                )}`
            )
            .join("; ")}${pares[0].reason ? `, motivo do estorno: ${pares[0].reason}` : ""})`,
          `— motivo da exclusão: ${motivoLimpo}`,
          documentos > 0 ? `— ${documentos} documento(s) desvinculado(s)` : "",
        ]
          .filter(Boolean)
          .join(" "),
      })
    );
  }

  /**
   * Desfaz um lançamento que ACABOU de ser criado por uma ação que falhou no
   * meio (ex.: o pagamento da mensalidade não gravou) — sem isso sobrava
   * dinheiro no caixa sem o registro correspondente, e o usuário tentava de
   * novo (lançamento em dobro). Só apaga se continua CONFIRMADA e sem nada
   * ligado a ele; os vínculos parciais o chamador já removeu.
   */
  static async descartarCriadoComErro(id: string): Promise<void> {
    const db = await getDatabase();
    await db.execute(
      `DELETE FROM cash_transactions
       WHERE id = $1 AND status = 'CONFIRMADA'
         AND NOT EXISTS (SELECT 1 FROM cash_transaction_reversals
                         WHERE original_transaction_id = $1 OR reversal_transaction_id = $1)
         AND NOT EXISTS (SELECT 1 FROM membership_payments WHERE cash_transaction_id = $1)
         AND NOT EXISTS (SELECT 1 FROM payable_payments WHERE cash_transaction_id = $1)
         AND NOT EXISTS (SELECT 1 FROM receivable_payments WHERE cash_transaction_id = $1)
         AND NOT EXISTS (SELECT 1 FROM donations WHERE cash_transaction_id = $1)
         AND NOT EXISTS (SELECT 1 FROM asset_events WHERE cash_transaction_id = $1)`,
      [id]
    );
  }
}

/** Ligações de estorno em que algum dos `ids` é o original ou o estorno. */
async function buscarLigacoes(
  db: Database,
  ids: string[]
): Promise<{ id: string; original_transaction_id: string; reversal_transaction_id: string; reason: string | null }[]> {
  const marcadores = ids.map((_, i) => `$${i + 1}`).join(", ");
  return db.select(
    `SELECT id, original_transaction_id, reversal_transaction_id, reason
     FROM cash_transaction_reversals
     WHERE original_transaction_id IN (${marcadores}) OR reversal_transaction_id IN (${marcadores})`,
    ids
  );
}

/** Impede apagar lançamento que ainda quita algo (ver `VINCULOS_LANCAMENTO`). */
async function bloquearSeTemVinculos(db: Database, ids: string[]): Promise<void> {
  const marcadores = ids.map((_, i) => `$${i + 1}`).join(", ");
  for (const vinculo of VINCULOS_LANCAMENTO) {
    const [{ total }] = await db.select<{ total: number }[]>(
      `SELECT COUNT(*) AS total FROM ${vinculo.tabela} WHERE cash_transaction_id IN (${marcadores})`,
      ids
    );
    if (total > 0) {
      throw new Error(
        `Este lançamento ainda ${vinculo.descricao}. Use "Desfazer baixas" na linha dele primeiro; depois ele pode ser apagado.`
      );
    }
  }
}

/**
 * Estorna UM lançamento (dentro do `comAtividade` de `reverse`). Ordem pensada
 * pra uma falha no meio não estragar o saldo: 1) o ESTORNO (sozinho vale 0 —
 * o sinal depende da ligação), 2) a ligação (aí o par se anula), 3) o
 * original vira ESTORNADA, 4) desfaz o que ele quitava. Data do estorno =
 * hoje no fuso do computador (antes era UTC: depois das 21h caía no dia seguinte).
 */
async function estornarUm(db: Database, original: CashTransaction, reason: string | null): Promise<string | null> {
  const reversalId = newId();
  const hoje = hojeIso();
  await inserirLancamento(db, {
    id: reversalId,
    association_id: original.association_id,
    financial_account_id: original.financial_account_id,
    transaction_type: "ESTORNO",
    amount: original.amount,
    transaction_date: hoje,
    competence_date: hoje,
    description: `Estorno de: ${original.description}`,
    source_type: "CASH_TRANSACTION_REVERSAL",
    source_id: original.id,
  });
  await db.execute(
    `INSERT INTO cash_transaction_reversals (id, original_transaction_id, reversal_transaction_id, reason)
     VALUES ($1, $2, $3, $4)`,
    [newId(), original.id, reversalId, reason]
  );
  await db.execute("UPDATE cash_transactions SET status = 'ESTORNADA' WHERE id = $1", [original.id]);
  return desfazerQuitacoesDoLancamento(db, original.id);
}

/** Rótulo do tipo de lançamento, pra texto (Atividades). */
const ROTULO_TIPO_LANCAMENTO: Record<TipoLancamento, string> = {
  RECEITA: "receita",
  DESPESA: "despesa",
  TRANSFERENCIA_ENTRADA: "transferência (entrada)",
  TRANSFERENCIA_SAIDA: "transferência (saída)",
  ESTORNO: "estorno",
};
