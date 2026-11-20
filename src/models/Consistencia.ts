/**
 * Verificação de consistência do financeiro — pra consertar bancos que já
 * ficaram inconsistentes por versões antigas (estorno que não reabria as
 * mensalidades, baixa que falhava no meio deixando o lançamento solto,
 * estorno de uma perna só da transferência...). Nada é corrigido sozinho:
 * `verificar` só lista; o usuário escolhe o que corrigir e informa o
 * motivo, e cada correção vira UMA linha em Atividades (`corrigir`).
 *
 * O saldo das contas nunca é gravado (sempre calculado dos lançamentos) —
 * "saldo que não bate" vem dos lançamentos listados aqui; corrigidos eles,
 * o saldo se acerta sozinho.
 */
import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { competenciaAtual, formatarData, formatarMoeda, proximaCompetencia } from "../utils/format.js";
import { codigoLancamento, codigoMensalidade } from "../utils/codigos.js";
import { comAtividade } from "./ActivityLog.js";
import {
  CashTransactionModel,
  desfazerQuitacoesDoLancamento,
  recalcularParcelaDeConta,
} from "./CashTransaction.js";
import { ParcelaModel } from "./Parcela.js";

export type TipoProblema =
  | "BAIXA_EM_ESTORNADO"
  | "ESTORNADO_SEM_ESTORNO"
  | "ESTORNO_SEM_ORIGINAL"
  | "ESTORNO_INCOMPLETO"
  | "TRANSFERENCIA_INCOMPLETA"
  | "LANCAMENTO_SEM_VINCULO"
  | "POSSIVEL_DUPLICADO"
  | "PAGAMENTO_SEM_LANCAMENTO"
  | "PARCELA_DIVERGENTE"
  | "CANCELADO_SOBRANDO"
  | "MES_FALTANDO";

export interface ProblemaConsistencia {
  /** Chave única do item na lista. */
  chave: string;
  tipo: TipoProblema;
  /** O que está errado, com códigos/valores — vai pra Atividades ao corrigir. */
  detalhe: string;
  /** Registro alvo da correção (lançamento, pagamento, parcela...). */
  alvo: string;
  /** Segundo registro, quando a correção precisa (ex.: conta da parcela). */
  alvo2?: string;
}

/** Título, explicação e o que a correção faz, por tipo — mostrados na tela. */
export const INFO_PROBLEMA: Record<TipoProblema, { titulo: string; explicacao: string; correcao: string }> = {
  BAIXA_EM_ESTORNADO: {
    titulo: "Mensalidades/contas pagas por lançamento já estornado",
    explicacao:
      "O dinheiro já saiu do caixa (estorno feito numa versão antiga), mas as mensalidades, parcelas ou doações continuam como pagas.",
    correcao: "Reabre as mensalidades (acordo desfeito, recibo cancelado), volta a parcela a aberta e desfaz a doação.",
  },
  ESTORNADO_SEM_ESTORNO: {
    titulo: "Lançamento marcado como estornado sem o estorno no caixa",
    explicacao: "Aparece como estornado, mas o valor continua contando no saldo — o estorno foi interrompido no meio.",
    correcao: "Termina o estorno: cria o lançamento de estorno (o saldo passa a descontar o valor) e desfaz o que ele quitava.",
  },
  ESTORNO_SEM_ORIGINAL: {
    titulo: "Estorno solto (sem ligação com o lançamento original)",
    explicacao: "Um lançamento de estorno que não está ligado ao original — não conta no saldo e confunde a lista.",
    correcao: "Liga ao original quando ele existe (e termina o estorno); se não existe, apaga o estorno solto.",
  },
  ESTORNO_INCOMPLETO: {
    titulo: "Estorno ligado, mas o original continua confirmado",
    explicacao: "O estorno foi gravado e ligado, mas o original não foi marcado como estornado (as baixas continuam).",
    correcao: "Marca o original como estornado e desfaz o que ele quitava (mensalidades, parcela, doação).",
  },
  TRANSFERENCIA_INCOMPLETA: {
    titulo: "Transferência pela metade",
    explicacao:
      "Só uma das contas tem o movimento, ou só uma das pernas foi estornada — o total das contas fica com dinheiro a mais ou a menos.",
    correcao: "Estorna a perna que ficou sozinha (o dinheiro volta pra conta de origem).",
  },
  LANCAMENTO_SEM_VINCULO: {
    titulo: "Lançamento de mensalidade/conta/doação sem o registro correspondente",
    explicacao:
      "Sobra de uma baixa que falhou no meio: o dinheiro entrou (ou saiu) do caixa, mas nenhuma mensalidade, parcela ou doação ficou paga. Costuma ser a origem de lançamento em dobro (o usuário pagou de novo).",
    correcao: "Estorna o lançamento solto.",
  },
  POSSIVEL_DUPLICADO: {
    titulo: "Possíveis lançamentos duplicados",
    explicacao:
      "Mesma conta, tipo, valor, data e descrição. Confira antes: dois sócios pagando o mesmo valor no mesmo dia NÃO aparecem aqui (cada um tem sua mensalidade).",
    correcao: "Estorna a cópia (a que não quita nada; se as duas não quitam, a mais nova).",
  },
  PAGAMENTO_SEM_LANCAMENTO: {
    titulo: "Mensalidade paga sem dinheiro no caixa",
    explicacao:
      "Mensalidade registrada como paga sem lançamento de caixa (ou com lançamento cancelado). Pode ser pagamento antigo, de antes do sistema — confira.",
    correcao: "Reabre a mensalidade (apaga o pagamento, cancela o recibo e desfaz o acordo que ficar sem meses).",
  },
  PARCELA_DIVERGENTE: {
    titulo: "Parcela de conta com valor pago diferente da soma dos pagamentos",
    explicacao: "O valor pago gravado na parcela não bate com os pagamentos registrados nela.",
    correcao: "Recalcula valor pago, situação da parcela e da conta pela soma dos pagamentos.",
  },
  CANCELADO_SOBRANDO: {
    titulo: "Lançamento cancelado sobrando",
    explicacao: "Sobra de uma exclusão de lançamento estornado que foi interrompida. Não conta no saldo.",
    correcao: "Termina de apagar.",
  },
  MES_FALTANDO: {
    titulo: "Mês faltando no calendário de mensalidades",
    explicacao: "Meses que não existem no calendário não são cobrados de ninguém nem aparecem em Cobranças.",
    correcao: "Cria os meses que faltam (ninguém é cobrado antes da própria data de associação).",
  },
};

/** Fontes de lançamento que SEMPRE têm um registro ligado (mensalidade, parcela, doação). */
const ORIGENS_COM_VINCULO = [
  "MEMBERSHIP_PAYMENT",
  "MEMBERSHIP_AGREEMENT",
  "PAYABLE_INSTALLMENT",
  "RECEIVABLE_INSTALLMENT",
  "DONATION",
];

const TEM_VINCULO_SQL = (alias: string) => `(
  EXISTS (SELECT 1 FROM membership_payments WHERE cash_transaction_id = ${alias}.id)
  OR EXISTS (SELECT 1 FROM payable_payments WHERE cash_transaction_id = ${alias}.id)
  OR EXISTS (SELECT 1 FROM receivable_payments WHERE cash_transaction_id = ${alias}.id)
  OR EXISTS (SELECT 1 FROM donations WHERE cash_transaction_id = ${alias}.id)
  OR EXISTS (SELECT 1 FROM asset_events WHERE cash_transaction_id = ${alias}.id)
)`;

interface LinhaLancamento {
  id: string;
  ano: number | null;
  numero: number | null;
  description: string;
  amount: number;
  transaction_date: string;
  account_name: string;
}

function rotulo(l: LinhaLancamento): string {
  return `${codigoLancamento(l.ano, l.numero) ?? "sem nº"} — ${l.description} — ${formatarMoeda(l.amount)} em ${formatarData(
    l.transaction_date
  )} (${l.account_name})`;
}

const COLUNAS_LANCAMENTO = `t.id, t.ano, t.numero, t.description, t.amount, t.transaction_date, fa.name AS account_name`;

export class ConsistenciaModel {
  /** Lista tudo que está inconsistente (não altera nada). */
  static async verificar(): Promise<ProblemaConsistencia[]> {
    const db = await getDatabase();
    const associationId = getCurrentAssociationId();
    const problemas: ProblemaConsistencia[] = [];
    const lancamentos = (where: string, params: unknown[] = []) =>
      db.select<LinhaLancamento[]>(
        `SELECT ${COLUNAS_LANCAMENTO} FROM cash_transactions t
         JOIN financial_accounts fa ON fa.id = t.financial_account_id
         WHERE t.association_id = $1 AND ${where}
         ORDER BY t.transaction_date, t.created_at`,
        [associationId, ...params]
      );

    for (const l of await lancamentos(`t.status = 'ESTORNADA' AND ${TEM_VINCULO_SQL("t")}`)) {
      problemas.push({ chave: `BE-${l.id}`, tipo: "BAIXA_EM_ESTORNADO", detalhe: rotulo(l), alvo: l.id });
    }

    for (const l of await lancamentos(
      `t.status = 'ESTORNADA'
       AND NOT EXISTS (SELECT 1 FROM cash_transaction_reversals r WHERE r.original_transaction_id = t.id)
       -- tem um estorno solto apontando pra ele? Esse caso é consertado pelo "estorno solto" (sem criar outro).
       AND NOT EXISTS (SELECT 1 FROM cash_transactions e
                       WHERE e.transaction_type = 'ESTORNO' AND e.source_id = t.id AND e.status <> 'CANCELADA')`
    )) {
      problemas.push({ chave: `ES-${l.id}`, tipo: "ESTORNADO_SEM_ESTORNO", detalhe: rotulo(l), alvo: l.id });
    }

    for (const l of await lancamentos(
      `t.transaction_type = 'ESTORNO' AND t.status <> 'CANCELADA'
       AND NOT EXISTS (SELECT 1 FROM cash_transaction_reversals r WHERE r.reversal_transaction_id = t.id)`
    )) {
      problemas.push({ chave: `EO-${l.id}`, tipo: "ESTORNO_SEM_ORIGINAL", detalhe: rotulo(l), alvo: l.id });
    }

    for (const l of await lancamentos(
      `t.status = 'CONFIRMADA'
       AND EXISTS (SELECT 1 FROM cash_transaction_reversals r WHERE r.original_transaction_id = t.id)`
    )) {
      problemas.push({ chave: `EI-${l.id}`, tipo: "ESTORNO_INCOMPLETO", detalhe: rotulo(l), alvo: l.id });
    }

    // Transferência: perna confirmada cuja outra perna não existe ou não está confirmada.
    for (const l of await lancamentos(
      `t.transfer_group_id IS NOT NULL AND t.status = 'CONFIRMADA'
       AND NOT EXISTS (SELECT 1 FROM cash_transactions x
                       WHERE x.transfer_group_id = t.transfer_group_id AND x.id <> t.id AND x.status = 'CONFIRMADA')`
    )) {
      problemas.push({ chave: `TI-${l.id}`, tipo: "TRANSFERENCIA_INCOMPLETA", detalhe: rotulo(l), alvo: l.id });
    }

    const origens = ORIGENS_COM_VINCULO.map((_, i) => `$${i + 2}`).join(", ");
    for (const l of await lancamentos(
      `t.status = 'CONFIRMADA' AND t.source_type IN (${origens}) AND NOT ${TEM_VINCULO_SQL("t")}`,
      ORIGENS_COM_VINCULO
    )) {
      problemas.push({ chave: `SV-${l.id}`, tipo: "LANCAMENTO_SEM_VINCULO", detalhe: rotulo(l), alvo: l.id });
    }

    // Duplicados: só entre receitas/despesas confirmadas, e nunca quando os
    // DOIS quitam registros diferentes (aí são duas coisas reais).
    const pares = await db.select<
      (LinhaLancamento & { copia_id: string; copia_ano: number | null; copia_numero: number | null; copia_tem_vinculo: number; tem_vinculo: number })[]
    >(
      `SELECT ${COLUNAS_LANCAMENTO}, c.id AS copia_id, c.ano AS copia_ano, c.numero AS copia_numero,
              ${TEM_VINCULO_SQL("t")} AS tem_vinculo, ${TEM_VINCULO_SQL("c")} AS copia_tem_vinculo
       FROM cash_transactions t
       JOIN cash_transactions c
         ON c.association_id = t.association_id AND c.financial_account_id = t.financial_account_id
        AND c.transaction_type = t.transaction_type AND c.amount = t.amount
        AND c.transaction_date = t.transaction_date AND c.description = t.description
        AND c.status = 'CONFIRMADA' AND (c.created_at, c.id) > (t.created_at, t.id)
       JOIN financial_accounts fa ON fa.id = t.financial_account_id
       WHERE t.association_id = $1 AND t.status = 'CONFIRMADA' AND t.transaction_type IN ('RECEITA', 'DESPESA')
         AND NOT (${TEM_VINCULO_SQL("t")} AND ${TEM_VINCULO_SQL("c")})
       ORDER BY t.transaction_date`,
      [associationId]
    );
    const jaListados = new Set(problemas.map((p) => p.alvo));
    for (const p of pares) {
      // A cópia a estornar: a que não quita nada; se nenhuma quita, a mais nova.
      const alvo = p.copia_tem_vinculo && !p.tem_vinculo ? p.id : p.copia_id;
      if (jaListados.has(alvo)) continue; // já aparece como "sem vínculo"
      jaListados.add(alvo);
      const codigoCopia = codigoLancamento(p.copia_ano, p.copia_numero) ?? "sem nº";
      problemas.push({
        chave: `DU-${p.id}-${p.copia_id}`,
        tipo: "POSSIVEL_DUPLICADO",
        detalhe: `${rotulo(p)} — repetido em ${codigoCopia}; estorna ${
          alvo === p.id ? codigoLancamento(p.ano, p.numero) ?? "sem nº" : codigoCopia
        }`,
        alvo,
      });
    }

    const pagamentosSoltos = await db.select<
      { id: string; registration_number: string; full_name: string; competence_month: string; paid_amount: number; status: string | null }[]
    >(
      `SELECT mp.id, m.registration_number, pe.full_name, pa.competence_month, mp.paid_amount, ct.status
       FROM membership_payments mp
       JOIN members m ON m.id = mp.member_id
       JOIN people pe ON pe.id = m.person_id
       JOIN parcelas pa ON pa.id = mp.parcela_id
       LEFT JOIN cash_transactions ct ON ct.id = mp.cash_transaction_id
       WHERE mp.association_id = $1 AND mp.membership_service_id IS NULL
         AND (mp.cash_transaction_id IS NULL OR ct.status = 'CANCELADA')
       ORDER BY pe.full_name, pa.competence_month`,
      [associationId]
    );
    for (const p of pagamentosSoltos) {
      problemas.push({
        chave: `PS-${p.id}`,
        tipo: "PAGAMENTO_SEM_LANCAMENTO",
        detalhe: `${codigoMensalidade(p.registration_number, p.competence_month)} — ${p.full_name} — ${formatarMoeda(
          p.paid_amount
        )} ${p.status ? "(lançamento cancelado)" : "(sem lançamento)"}`,
        alvo: p.id,
      });
    }

    for (const [tipo, parcelas, pagamentos, fk, valor, contas, fkConta] of [
      ["a pagar", "payable_installments", "payable_payments", "payable_installment_id", "paid_amount", "payables", "payable_id"],
      ["a receber", "receivable_installments", "receivable_payments", "receivable_installment_id", "received_amount", "receivables", "receivable_id"],
    ] as const) {
      const divergentes = await db.select<
        { id: string; conta_id: string; installment_number: number; description: string; gravado: number; soma: number }[]
      >(
        `SELECT pa.id, pa.${fkConta} AS conta_id, pa.installment_number, co.description, pa.${valor} AS gravado,
                COALESCE((SELECT SUM(amount) FROM ${pagamentos} WHERE ${fk} = pa.id), 0) AS soma
         FROM ${parcelas} pa JOIN ${contas} co ON co.id = pa.${fkConta}
         WHERE co.association_id = $1
           AND pa.${valor} <> COALESCE((SELECT SUM(amount) FROM ${pagamentos} WHERE ${fk} = pa.id), 0)`,
        [associationId]
      );
      for (const d of divergentes) {
        problemas.push({
          chave: `PD-${d.id}`,
          tipo: "PARCELA_DIVERGENTE",
          detalhe: `Conta ${tipo} "${d.description}", parcela ${d.installment_number}: gravado ${formatarMoeda(
            d.gravado
          )}, pagamentos somam ${formatarMoeda(d.soma)}`,
          alvo: `${tipo === "a pagar" ? "PAGAR" : "RECEBER"}:${d.id}`,
          alvo2: d.conta_id,
        });
      }
    }

    for (const l of await lancamentos(`t.status = 'CANCELADA'`)) {
      problemas.push({ chave: `CS-${l.id}`, tipo: "CANCELADO_SOBRANDO", detalhe: rotulo(l), alvo: l.id });
    }

    const meses = await db.select<{ competence_month: string }[]>(
      "SELECT competence_month FROM parcelas WHERE association_id = $1 ORDER BY competence_month",
      [associationId]
    );
    if (meses.length > 0) {
      const existentes = new Set(meses.map((m) => m.competence_month));
      const faltando: string[] = [];
      const atual = competenciaAtual();
      for (let c = meses[0].competence_month; c <= atual; c = proximaCompetencia(c)) {
        if (!existentes.has(c)) faltando.push(c.slice(5, 7) + "/" + c.slice(0, 4));
      }
      if (faltando.length > 0) {
        problemas.push({ chave: "MF", tipo: "MES_FALTANDO", detalhe: faltando.join(", "), alvo: "" });
      }
    }

    return problemas;
  }

  /** Corrige UM problema; motivo obrigatório (vai pra Atividades junto com o detalhe). */
  static async corrigir(problema: ProblemaConsistencia, motivo: string): Promise<void> {
    const justificativa = motivo.trim();
    if (!justificativa) throw new Error("Informe o motivo da correção.");
    const info = INFO_PROBLEMA[problema.tipo];

    await comAtividade(
      async () => {
        const db = await getDatabase();
        switch (problema.tipo) {
          case "BAIXA_EM_ESTORNADO":
            return desfazerQuitacoesDoLancamento(db, problema.alvo);

          case "ESTORNADO_SEM_ESTORNO": {
            // Volta a confirmado e estorna do jeito certo (estorno + ligação + baixas desfeitas).
            await db.execute("UPDATE cash_transactions SET status = 'CONFIRMADA' WHERE id = $1 AND status = 'ESTORNADA'", [
              problema.alvo,
            ]);
            await CashTransactionModel.reverse(problema.alvo, `Correção de consistência — ${justificativa}`);
            return null;
          }

          case "ESTORNO_SEM_ORIGINAL": {
            const [estorno] = await db.select<{ source_id: string | null }[]>(
              "SELECT source_id FROM cash_transactions WHERE id = $1",
              [problema.alvo]
            );
            const [original] = estorno?.source_id
              ? await db.select<{ id: string; status: string }[]>(
                  `SELECT id, status FROM cash_transactions o WHERE o.id = $1
                   AND NOT EXISTS (SELECT 1 FROM cash_transaction_reversals r WHERE r.original_transaction_id = o.id)`,
                  [estorno.source_id]
                )
              : [];
            if (!original) {
              await db.execute("DELETE FROM document_links WHERE entity_type = 'CASH_TRANSACTION' AND entity_id = $1", [
                problema.alvo,
              ]);
              await db.execute("DELETE FROM cash_transactions WHERE id = $1", [problema.alvo]);
              return "estorno solto apagado (o original não existe ou já tem outro estorno)";
            }
            await db.execute(
              `INSERT INTO cash_transaction_reversals (id, original_transaction_id, reversal_transaction_id, reason)
               VALUES ($1, $2, $3, $4)`,
              [newId(), original.id, problema.alvo, `Correção de consistência — ${justificativa}`]
            );
            await db.execute("UPDATE cash_transactions SET status = 'ESTORNADA' WHERE id = $1", [original.id]);
            const desfeito = await desfazerQuitacoesDoLancamento(db, original.id);
            return `estorno ligado ao original${desfeito ? ` — ${desfeito}` : ""}`;
          }

          case "ESTORNO_INCOMPLETO": {
            await db.execute("UPDATE cash_transactions SET status = 'ESTORNADA' WHERE id = $1", [problema.alvo]);
            return desfazerQuitacoesDoLancamento(db, problema.alvo);
          }

          case "TRANSFERENCIA_INCOMPLETA":
          case "LANCAMENTO_SEM_VINCULO":
          case "POSSIVEL_DUPLICADO":
            await CashTransactionModel.reverse(problema.alvo, `Correção de consistência — ${justificativa}`);
            return null;

          case "PAGAMENTO_SEM_LANCAMENTO": {
            const [pagamento] = await db.select<
              { membership_agreement_id: string | null; protocol_entry_id: string | null }[]
            >("SELECT membership_agreement_id, protocol_entry_id FROM membership_payments WHERE id = $1", [problema.alvo]);
            if (!pagamento) return null;
            await db.execute("DELETE FROM membership_payments WHERE id = $1", [problema.alvo]);
            if (pagamento.membership_agreement_id) {
              await db.execute(
                `DELETE FROM membership_agreements WHERE id = $1
                 AND NOT EXISTS (SELECT 1 FROM membership_payments WHERE membership_agreement_id = $1)`,
                [pagamento.membership_agreement_id]
              );
            }
            if (pagamento.protocol_entry_id) {
              await db.execute(
                `UPDATE protocol_entries SET status = 'CANCELADO' WHERE id = $1
                 AND NOT EXISTS (SELECT 1 FROM membership_payments WHERE protocol_entry_id = $1)`,
                [pagamento.protocol_entry_id]
              );
            }
            return null;
          }

          case "PARCELA_DIVERGENTE": {
            const [tipo, parcelaId] = problema.alvo.split(":") as ["PAGAR" | "RECEBER", string];
            await recalcularParcelaDeConta(tipo, parcelaId, problema.alvo2 ?? "");
            return null;
          }

          case "CANCELADO_SOBRANDO":
            await CashTransactionModel.apagarEstornado(problema.alvo, `Correção de consistência — ${justificativa}`);
            return null;

          case "MES_FALTANDO":
            await ParcelaModel.ensureAteMesAtual();
            return null;
        }
      },
      (resultado) => ({
        module: "FINANCEIRO",
        description: `Correção de consistência — ${info.titulo} — ${problema.detalhe}${
          resultado ? ` — ${resultado}` : ""
        } — motivo: ${justificativa}`,
      })
    );
  }
}
