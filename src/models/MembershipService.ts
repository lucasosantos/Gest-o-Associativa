/**
 * Mensalidades pagas com PRESTAÇÃO DE SERVIÇO (migration `version: 26`): o
 * sócio presta um serviço à associação e isso vale N meses de mensalidade.
 * Não entra dinheiro, então NÃO há lançamento de caixa — cada mês quitado é
 * uma linha em `membership_payments` sem `cash_transaction_id`, apontando
 * pra prestação (`membership_service_id`). O texto explicando o serviço é
 * obrigatório; o relatório em PDF é opcional e vira um documento comum
 * (módulo Documentos), vinculado ao sócio.
 *
 * Meses quitados: os em aberto mais antigos do sócio (vencidos primeiro), a
 * partir do mês escolhido, pulando os já pagos; se faltar, segue pros meses
 * futuros (como no pagamento adiantado).
 */
import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { competenciaAtual, formatarMoeda, proximaCompetencia } from "../utils/format.js";
import { codigoMensalidade, codigoServico } from "../utils/codigos.js";
import { comAtividade } from "./ActivityLog.js";
import { DocumentModel } from "./Document.js";
import { DocumentLinkModel } from "./DocumentLink.js";
import { ParcelaModel } from "./Parcela.js";

/** Espelha a tabela `membership_services`. */
export interface MembershipService {
  id: string;
  association_id: string;
  member_id: string;
  /** Nº sequencial na associação — código `01-0012-PS-0001`. */
  numero: number;
  service_date: string;
  months_count: number;
  /** Como foi a prestação de serviço (texto livre, obrigatório). */
  description: string;
  /** Soma do valor mensal dos meses quitados (centavos) — só referência, não entra no caixa. */
  reference_amount: number;
  approved_by: string | null;
  /** Relatório em PDF (documento do módulo Documentos), se anexado. */
  document_id: string | null;
  created_at: string;
}

export interface MembershipServiceComDetalhes extends MembershipService {
  full_name: string;
  registration_number: string;
  codigo: string;
  /** Competências (`AAAA-MM-01`) quitadas, em ordem. */
  competence_months: string[];
  document_title: string | null;
  /** Chave do arquivo do PDF, pra abrir com `abrirArquivoDocumento`. */
  document_storage_key: string | null;
}

/** Linha da prestação de contas: serviço prestado no período (fora do caixa). Centavos. */
export interface PrestacaoServicoRelatorio {
  id: string;
  codigo: string;
  service_date: string;
  full_name: string;
  registration_number: string;
  months_count: number;
  /** Valor da mensalidade usado no cálculo (`reference_amount / months_count`). */
  valor_mensal: number;
  /** Quanto o serviço valeu: meses × valor mensal. */
  reference_amount: number;
  description: string;
  approved_by: string | null;
}

export interface NovaPrestacaoServico {
  service_date: string;
  /** Primeiro mês a quitar (`AAAA-MM-01`) — um dos devolvidos por `mesesDisponiveis`. */
  start_month: string;
  months_count: number;
  /** Valor de UMA mensalidade (centavos) — o serviço vale `months_count` × isso. */
  monthly_amount: number;
  description: string;
  approved_by?: string | null;
  /** Caminho do PDF do relatório escolhido no diálogo (opcional). */
  pdf_path?: string | null;
}

/** Até quantos meses à frente do mês atual a prestação pode quitar. */
const MESES_FUTUROS = 36;

function mesCurto(competencia: string): string {
  const [ano, mes] = competencia.split("-");
  return `${mes}/${ano}`;
}

export class MembershipServiceModel {
  /**
   * Meses que uma prestação de serviço pode quitar, em ordem: os em aberto
   * (vencidos e o atual) dentro da vigência do sócio e os futuros até
   * `MESES_FUTUROS` à frente — sempre sem os já pagos.
   */
  static async mesesDisponiveis(memberId: string): Promise<string[]> {
    const db = await getDatabase();
    const mesAtual = competenciaAtual();
    const [socio] = await db.select<{ inicio: string; exit_date: string | null }[]>(
      "SELECT COALESCE(dues_start_date, association_date) AS inicio, exit_date FROM members WHERE id = $1",
      [memberId]
    );
    if (!socio) throw new Error("Sócio não encontrado.");

    const emAberto = await db.select<{ competence_month: string }[]>(
      `SELECT pa.competence_month FROM parcelas pa
       WHERE pa.association_id = $1 AND pa.competence_month <= $2
         AND substr(pa.competence_month, 1, 7) >= substr($3, 1, 7)
         AND ($4 IS NULL OR substr(pa.competence_month, 1, 7) <= substr($4, 1, 7))
         AND NOT EXISTS (SELECT 1 FROM membership_payments mp WHERE mp.member_id = $5 AND mp.parcela_id = pa.id)
       ORDER BY pa.competence_month`,
      [getCurrentAssociationId(), mesAtual, socio.inicio, socio.exit_date, memberId]
    );

    const futurosPagos = new Set(
      (
        await db.select<{ competence_month: string }[]>(
          `SELECT pa.competence_month FROM membership_payments mp JOIN parcelas pa ON pa.id = mp.parcela_id
           WHERE mp.member_id = $1 AND pa.competence_month > $2`,
          [memberId, mesAtual]
        )
      ).map((p) => p.competence_month)
    );
    const futuros: string[] = [];
    let competencia = proximaCompetencia(mesAtual);
    for (let i = 0; i < MESES_FUTUROS; i++, competencia = proximaCompetencia(competencia)) {
      if (socio.exit_date && competencia.slice(0, 7) > socio.exit_date.slice(0, 7)) break;
      if (competencia.slice(0, 7) < socio.inicio.slice(0, 7)) continue;
      if (!futurosPagos.has(competencia)) futuros.push(competencia);
    }

    return [...emAberto.map((m) => m.competence_month), ...futuros];
  }

  /** Os `quantidade` meses que serão quitados a partir de `inicio` (subconjunto de `mesesDisponiveis`). */
  static mesesAQuitar(disponiveis: string[], inicio: string, quantidade: number): string[] {
    const posicao = disponiveis.indexOf(inicio);
    if (posicao < 0) return [];
    return disponiveis.slice(posicao, posicao + quantidade);
  }

  /** Registra a prestação de serviço e quita os meses (uma linha em Atividades). */
  static async criar(memberId: string, dados: NovaPrestacaoServico): Promise<MembershipServiceComDetalhes> {
    const descricao = dados.description.trim();
    if (!descricao) throw new Error("Explique como foi a prestação de serviço.");
    if (!Number.isInteger(dados.months_count) || dados.months_count < 1) {
      throw new Error("Informe quantos meses o serviço vale (1 ou mais).");
    }
    if (!dados.service_date) throw new Error("Informe a data do serviço.");
    if (!Number.isInteger(dados.monthly_amount) || dados.monthly_amount <= 0) {
      throw new Error("Informe o valor da mensalidade (maior que zero).");
    }

    const disponiveis = await MembershipServiceModel.mesesDisponiveis(memberId);
    const meses = MembershipServiceModel.mesesAQuitar(disponiveis, dados.start_month, dados.months_count);
    if (meses.length < dados.months_count) {
      throw new Error(
        `Só há ${meses.length} mês(es) em aberto a partir de ${mesCurto(dados.start_month)} — diminua a quantidade ou escolha um mês anterior.`
      );
    }

    const db = await getDatabase();
    const associationId = getCurrentAssociationId();
    const [socio] = await db.select<{ full_name: string }[]>(
      "SELECT pe.full_name FROM members m JOIN people pe ON pe.id = m.person_id WHERE m.id = $1",
      [memberId]
    );
    const valorMensal = dados.monthly_amount;

    return comAtividade(
      async () => {
        const servicoId = newId();
        let documentoId: string | null = null;
        let servicoGravado = false;
        const pagamentos: string[] = [];
        try {
          // O PDF primeiro: é o passo que mais pode falhar (arquivo ilegível/sumiu).
          if (dados.pdf_path) {
            const documento = await DocumentModel.create({
              title: `Relatório de prestação de serviço — ${socio?.full_name ?? "sócio"}`,
              description: descricao,
              document_date: dados.service_date,
              source_path: dados.pdf_path,
            });
            documentoId = documento.id;
            await DocumentLinkModel.create({
              document_id: documento.id,
              entity_type: "MEMBER",
              entity_id: memberId,
              link_role: "ANEXO",
            });
          }

          const parcelas = [];
          for (const competencia of meses) parcelas.push(await ParcelaModel.getOrCreate(competencia));

          await db.execute(
            `INSERT INTO membership_services
               (id, association_id, member_id, numero, service_date, months_count, description, reference_amount,
                approved_by, document_id)
             VALUES ($1, $2, $3,
               (SELECT COALESCE(MAX(numero), 0) + 1 FROM membership_services WHERE association_id = $2),
               $4, $5, $6, $7, $8, $9)`,
            [
              servicoId,
              associationId,
              memberId,
              dados.service_date,
              meses.length,
              descricao,
              valorMensal * meses.length,
              dados.approved_by?.trim() || null,
              documentoId,
            ]
          );
          servicoGravado = true;

          for (const parcela of parcelas) {
            const pagamentoId = newId();
            pagamentos.push(pagamentoId);
            await db.execute(
              `INSERT INTO membership_payments
                 (id, association_id, member_id, parcela_id, cash_transaction_id, paid_amount, paid_at, payment_method,
                  membership_service_id)
               VALUES ($1, $2, $3, $4, NULL, $5, $6, 'Prestação de serviço', $7)`,
              [pagamentoId, associationId, memberId, parcela.id, valorMensal, dados.service_date, servicoId]
            );
          }
        } catch (erro) {
          // Sem transação: desfaz o que já foi gravado (o documento fica, cancelado).
          for (const id of pagamentos) {
            await db.execute("DELETE FROM membership_payments WHERE id = $1", [id]).catch(() => undefined);
          }
          if (servicoGravado) {
            await db.execute("DELETE FROM membership_services WHERE id = $1", [servicoId]).catch(() => undefined);
          }
          if (documentoId) {
            await db
              .execute("UPDATE documents SET status = 'CANCELADO' WHERE id = $1", [documentoId])
              .catch(() => undefined);
          }
          throw erro;
        }

        const criado = await MembershipServiceModel.get(servicoId);
        if (!criado) throw new Error("Falha ao registrar a prestação de serviço.");
        return criado;
      },
      (servico) => ({
        module: "MENSALIDADES",
        description: [
          `Mensalidades pagas com prestação de serviço ${servico.codigo} — ${servico.full_name}`,
          `— ${servico.months_count} mês(es): ${servico.competence_months
            .map((c) => codigoMensalidade(servico.registration_number, c))
            .join(", ")}`,
          servico.reference_amount > 0 ? `— valor de referência ${formatarMoeda(servico.reference_amount)} (sem caixa)` : "",
          `— serviço: ${servico.description.length > 200 ? `${servico.description.slice(0, 200)}…` : servico.description}`,
          servico.approved_by ? `— aprovado por ${servico.approved_by}` : "",
          servico.document_id ? "— relatório em PDF anexado" : "",
        ]
          .filter(Boolean)
          .join(" "),
        entity_type: "MEMBER",
        entity_id: memberId,
      })
    );
  }

  /**
   * Prestações de serviço com data do serviço no período — entram na
   * prestação de contas numa seção própria (valor = meses × mensalidade), sem
   * somar em entradas/saídas, porque não houve dinheiro.
   */
  static async listarPorPeriodo(inicio: string, fim: string): Promise<PrestacaoServicoRelatorio[]> {
    const db = await getDatabase();
    const linhas = await db.select<(Omit<PrestacaoServicoRelatorio, "codigo" | "valor_mensal"> & { numero: number })[]>(
      `SELECT ms.id, ms.numero, ms.service_date, ms.months_count, ms.reference_amount, ms.description, ms.approved_by,
              pe.full_name, m.registration_number
       FROM membership_services ms
       JOIN members m ON m.id = ms.member_id
       JOIN people pe ON pe.id = m.person_id
       WHERE ms.association_id = $1 AND ms.service_date BETWEEN $2 AND $3
       ORDER BY ms.service_date, ms.numero`,
      [getCurrentAssociationId(), inicio, fim]
    );
    return linhas.map(({ numero, ...resto }) => {
      const linha = resto;
      return {
        ...linha,
        codigo: codigoServico(linha.registration_number, numero) ?? "",
        valor_mensal: linha.months_count > 0 ? Math.round(linha.reference_amount / linha.months_count) : 0,
      };
    });
  }

  static async get(id: string): Promise<MembershipServiceComDetalhes | null> {
    const db = await getDatabase();
    const [servico] = await db.select<
      (Omit<MembershipServiceComDetalhes, "codigo" | "competence_months">)[]
    >(
      `SELECT ms.*, pe.full_name, m.registration_number, d.title AS document_title,
              dv.storage_key AS document_storage_key
       FROM membership_services ms
       JOIN members m ON m.id = ms.member_id
       JOIN people pe ON pe.id = m.person_id
       LEFT JOIN documents d ON d.id = ms.document_id
       LEFT JOIN document_versions dv ON dv.id = d.current_version_id
       WHERE ms.id = $1`,
      [id]
    );
    if (!servico) return null;
    const meses = await db.select<{ competence_month: string }[]>(
      `SELECT pa.competence_month FROM membership_payments mp JOIN parcelas pa ON pa.id = mp.parcela_id
       WHERE mp.membership_service_id = $1 ORDER BY pa.competence_month`,
      [id]
    );
    return {
      ...servico,
      codigo: codigoServico(servico.registration_number, servico.numero) ?? "",
      competence_months: meses.map((m) => m.competence_month),
    };
  }

  /**
   * Corrige o valor da mensalidade de uma prestação já registrada (ex.: foi
   * gravada com R$ 0,00 porque a associação não tinha valor mensal definido):
   * cada mês quitado passa a valer `valorMensal` e o serviço, meses × valor.
   * Não mexe no caixa (prestação não tem lançamento).
   */
  static async alterarValorMensal(id: string, valorMensal: number): Promise<void> {
    if (!Number.isInteger(valorMensal) || valorMensal <= 0) {
      throw new Error("Informe o valor da mensalidade (maior que zero).");
    }
    const servico = await MembershipServiceModel.get(id);
    if (!servico) throw new Error("Prestação de serviço não encontrada.");
    const meses = servico.competence_months.length || servico.months_count;
    const anterior = servico.months_count > 0 ? Math.round(servico.reference_amount / servico.months_count) : 0;

    await comAtividade(
      async () => {
        const db = await getDatabase();
        await db.execute("UPDATE membership_payments SET paid_amount = $1 WHERE membership_service_id = $2", [
          valorMensal,
          id,
        ]);
        await db.execute("UPDATE membership_services SET reference_amount = $1 WHERE id = $2", [
          valorMensal * meses,
          id,
        ]);
      },
      () => ({
        module: "MENSALIDADES",
        description: `Valor da prestação de serviço ${servico.codigo} corrigido — ${servico.full_name} — mensalidade ${formatarMoeda(
          anterior
        )} → ${formatarMoeda(valorMensal)} — ${meses} mês(es) = ${formatarMoeda(valorMensal * meses)} (sem caixa)`,
        entity_type: "MEMBER",
        entity_id: servico.member_id,
      })
    );
  }

  /**
   * Desfaz a prestação: os meses voltam a ficar em aberto e o registro da
   * prestação é apagado (o PDF continua em Documentos, vinculado ao sócio).
   * Motivo obrigatório; tudo fica em Atividades.
   */
  static async desfazer(id: string, motivo: string): Promise<void> {
    const justificativa = motivo.trim();
    if (!justificativa) throw new Error("Informe o motivo.");
    const servico = await MembershipServiceModel.get(id);
    if (!servico) throw new Error("Prestação de serviço não encontrada.");

    await comAtividade(
      async () => {
        const db = await getDatabase();
        await db.execute("DELETE FROM membership_payments WHERE membership_service_id = $1", [id]);
        await db.execute("DELETE FROM membership_services WHERE id = $1", [id]);
      },
      () => ({
        module: "MENSALIDADES",
        description: `Prestação de serviço desfeita ${servico.codigo} — ${servico.full_name} — ${
          servico.competence_months.length
        } mês(es) reaberto(s): ${servico.competence_months.map(mesCurto).join(", ")} — motivo: ${justificativa}`,
        entity_type: "MEMBER",
        entity_id: servico.member_id,
      })
    );
  }
}
