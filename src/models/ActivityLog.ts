import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";

/** Módulo de origem da atividade (filtro da tela Atividades). */
export type ModuloAtividade =
  | "SOCIOS"
  | "MENSALIDADES"
  | "FINANCEIRO"
  | "DOCUMENTOS"
  | "PROTOCOLOS"
  | "PATRIMONIO"
  | "INSTITUICAO"
  | "SISTEMA";

export const ROTULO_MODULO_ATIVIDADE: Record<ModuloAtividade, string> = {
  SOCIOS: "Sócios",
  MENSALIDADES: "Mensalidades",
  FINANCEIRO: "Financeiro",
  DOCUMENTOS: "Documentos",
  PROTOCOLOS: "Protocolos",
  PATRIMONIO: "Patrimônio",
  INSTITUICAO: "Instituição",
  SISTEMA: "Sistema",
};

/**
 * Tipo do registro ligado à atividade — usado só pra tela Atividades abrir
 * a ficha correspondente. Sem FK (chave polimórfica, mesmo espírito de
 * `document_links`): o registro pode até ter sido excluído depois.
 */
export type EntidadeAtividade = "MEMBER" | "DOCUMENT" | "PROTOCOL_ENTRY" | "ASSET" | "CASH_TRANSACTION";

/** Espelha a tabela `activity_logs` (migration `version: 24`). */
export interface ActivityLog {
  id: string;
  association_id: string;
  module: ModuloAtividade;
  description: string;
  entity_type: EntidadeAtividade | null;
  entity_id: string | null;
  /** UTC, `"AAAA-MM-DD HH:MM:SS.sss"` — exibir com `formatarDataHora`. */
  created_at: string;
}

export interface NovaAtividade {
  /** Só quando a associação ainda não é a atual (ex.: logo depois de cadastrá-la). */
  association_id?: string;
  module: ModuloAtividade;
  description: string;
  entity_type?: EntidadeAtividade | null;
  entity_id?: string | null;
}

/** Filtros da tela Atividades — aplicados dentro do dia e na navegação entre dias. */
export interface FiltroAtividades {
  module?: ModuloAtividade | null;
  texto?: string | null;
}

/**
 * Quantas `comAtividade` estão em andamento agora. Uma ação de usuário
 * costuma chamar outras que também registram atividade (ex.: pagar
 * mensalidade cria um lançamento de caixa e um protocolo de recibo) — só a
 * mais externa grava, pra cada ação virar UMA linha legível no histórico.
 * Contador global de módulo: o app é desktop de um usuário só, sem ações
 * de escrita concorrentes na prática.
 */
let profundidade = 0;

/**
 * Executa `acao` e, se ela terminar sem erro, registra a atividade descrita
 * por `descrever` (que recebe o resultado da ação; `null` = não registrar). Falha ao gravar o
 * histórico não desfaz nem quebra a ação — só vai pro console.
 */
export async function comAtividade<T>(
  acao: () => Promise<T>,
  descrever: (resultado: T) => NovaAtividade | null | Promise<NovaAtividade | null>
): Promise<T> {
  profundidade++;
  let resultado: T;
  try {
    resultado = await acao();
  } finally {
    profundidade--;
  }

  if (profundidade === 0) {
    try {
      const atividade = await descrever(resultado);
      if (atividade) await ActivityLogModel.registrar(atividade);
    } catch (error) {
      // Erro ao montar a descrição (ex.: consulta de nome) — mesma regra de `registrar`.
      console.error("Falha ao registrar atividade:", error);
    }
  }
  return resultado;
}

/**
 * Verbo de uma atualização de cadastro simples: "desativado"/"reativado"
 * quando ela só mexe em `is_active`, senão "alterado". `genero` concorda
 * com o substantivo ("Conta financeira desativada").
 */
export function verboAtualizacao(dados: object, genero: "o" | "a" = "o"): string {
  const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
  const ativo = (dados as { is_active?: unknown }).is_active;
  if (campos.length === 1 && ativo !== undefined) {
    return ativo ? `reativad${genero}` : `desativad${genero}`;
  }
  return `alterad${genero}`;
}

/** Nome do sócio pra compor a descrição de uma atividade (`"sócio"` se não achar). */
export async function nomeDoSocio(memberId: string): Promise<string> {
  const db = await getDatabase();
  const rows = await db.select<{ full_name: string }[]>(
    "SELECT pe.full_name AS full_name FROM members m JOIN people pe ON pe.id = m.person_id WHERE m.id = $1",
    [memberId]
  );
  return rows[0]?.full_name ?? "sócio";
}

/** Nome da pessoa pra compor a descrição de uma atividade. */
export async function nomeDaPessoa(personId: string): Promise<string> {
  const db = await getDatabase();
  const rows = await db.select<{ full_name: string }[]>("SELECT full_name FROM people WHERE id = $1", [personId]);
  return rows[0]?.full_name ?? "pessoa";
}

/** `WHERE` comum da tela Atividades (associação atual + filtros), com placeholders posicionais. */
function montarFiltro(filtro: FiltroAtividades): { where: string; parametros: string[] } {
  const condicoes = ["association_id = $1"];
  const parametros: string[] = [getCurrentAssociationId()];
  if (filtro.module) {
    parametros.push(filtro.module);
    condicoes.push(`module = $${parametros.length}`);
  }
  if (filtro.texto?.trim()) {
    parametros.push(`%${filtro.texto.trim()}%`);
    condicoes.push(`description LIKE $${parametros.length}`);
  }
  return { where: condicoes.join(" AND "), parametros };
}

/** Acesso à tabela `activity_logs` — só inclusão e leitura (triggers bloqueiam o resto). */
export class ActivityLogModel {
  /**
   * Grava uma atividade avulsa. Prefira `comAtividade` dentro dos models;
   * isto é pra ações que não passam por model (ex.: backup). Ignorado se
   * chamado dentro de uma `comAtividade` (a ação externa já registra).
   * Nunca lança erro.
   */
  static async registrar(dados: NovaAtividade): Promise<void> {
    if (profundidade > 0) return;
    try {
      const db = await getDatabase();
      await db.execute(
        `INSERT INTO activity_logs (id, association_id, module, description, entity_type, entity_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          newId(),
          dados.association_id ?? getCurrentAssociationId(),
          dados.module,
          dados.description,
          dados.entity_type ?? null,
          dados.entity_id ?? null,
        ]
      );
    } catch (error) {
      // A ação em si já aconteceu — falhar no histórico não pode desfazê-la
      // nem aparecer como erro dela pro usuário.
      console.error("Falha ao registrar atividade:", error);
    }
  }

  /**
   * Todas as atividades de um dia (`"AAAA-MM-DD"` na data LOCAL — o dia que
   * o usuário vê na tela, não o dia UTC de `created_at`), em ordem
   * cronológica.
   */
  static async listarDoDia(dia: string, filtro: FiltroAtividades = {}): Promise<ActivityLog[]> {
    const { where, parametros } = montarFiltro(filtro);
    parametros.push(dia);
    const db = await getDatabase();
    return db.select<ActivityLog[]>(
      `SELECT * FROM activity_logs
       WHERE ${where} AND date(created_at, 'localtime') = $${parametros.length}
       ORDER BY created_at`,
      parametros
    );
  }

  /**
   * Dia com atividade mais próximo de `dia`, na direção pedida — a
   * navegação pula dias sem nenhuma atividade (que casem com o filtro).
   * Sem `dia`, devolve o dia mais recente com atividade. `null` = não há.
   */
  static async diaVizinho(
    dia: string | null,
    direcao: "anterior" | "proximo",
    filtro: FiltroAtividades = {}
  ): Promise<string | null> {
    const { where, parametros } = montarFiltro(filtro);
    let condicaoDia = "";
    if (dia) {
      parametros.push(dia);
      condicaoDia = `AND date(created_at, 'localtime') ${direcao === "anterior" ? "<" : ">"} $${parametros.length}`;
    }
    const agregado = direcao === "anterior" ? "MAX" : "MIN";
    const db = await getDatabase();
    const [linha] = await db.select<{ dia: string | null }[]>(
      `SELECT ${agregado}(date(created_at, 'localtime')) AS dia FROM activity_logs WHERE ${where} ${condicaoDia}`,
      parametros
    );
    return linha?.dia ?? null;
  }

  /** Atividades de um registro específico (ex.: aba Histórico de uma ficha). */
  static async listarPorEntidade(entityType: EntidadeAtividade, entityId: string): Promise<ActivityLog[]> {
    const db = await getDatabase();
    return db.select<ActivityLog[]>(
      "SELECT * FROM activity_logs WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC",
      [entityType, entityId]
    );
  }
}
