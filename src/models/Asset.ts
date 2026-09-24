import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { CashTransactionModel } from "./CashTransaction.js";
import { comAtividade } from "./ActivityLog.js";
import { formatarData, formatarMoeda, hojeIso } from "../utils/format.js";

export type OrigemAquisicao = "COMPRA" | "DOACAO" | "CESSAO" | "PRODUCAO_PROPRIA" | "OUTRO";
export type EstadoConservacao = "NOVO" | "BOM" | "REGULAR" | "RUIM" | "INSERVIVEL";
export type StatusBem = "EM_USO" | "EM_MANUTENCAO" | "EMPRESTADO" | "BAIXADO";
export type TipoBaixa = "VENDA" | "DOACAO" | "DESCARTE" | "PERDA" | "FURTO_ROUBO" | "OUTRO";
export type TipoEventoBem =
  | "AQUISICAO"
  | "TRANSFERENCIA"
  | "MANUTENCAO_ENVIO"
  | "MANUTENCAO_RETORNO"
  | "EMPRESTIMO"
  | "DEVOLUCAO"
  | "CONSERVACAO"
  | "OCORRENCIA"
  | "BAIXA"
  | "REATIVACAO";

export const ROTULO_ORIGEM: Record<OrigemAquisicao, string> = {
  COMPRA: "Compra",
  DOACAO: "Doação recebida",
  CESSAO: "Cessão / comodato",
  PRODUCAO_PROPRIA: "Produção própria",
  OUTRO: "Outra",
};

export const ROTULO_CONSERVACAO: Record<EstadoConservacao, string> = {
  NOVO: "Novo",
  BOM: "Bom",
  REGULAR: "Regular",
  RUIM: "Ruim",
  INSERVIVEL: "Inservível",
};

export const ROTULO_STATUS_BEM: Record<StatusBem, string> = {
  EM_USO: "Em uso",
  EM_MANUTENCAO: "Em manutenção",
  EMPRESTADO: "Emprestado",
  BAIXADO: "Baixado",
};

export const ROTULO_TIPO_BAIXA: Record<TipoBaixa, string> = {
  VENDA: "Venda",
  DOACAO: "Doação a terceiros",
  DESCARTE: "Descarte",
  PERDA: "Perda / extravio",
  FURTO_ROUBO: "Furto / roubo",
  OUTRO: "Outro",
};

export const ROTULO_EVENTO_BEM: Record<TipoEventoBem, string> = {
  AQUISICAO: "Aquisição",
  TRANSFERENCIA: "Movimentação",
  MANUTENCAO_ENVIO: "Enviado para manutenção",
  MANUTENCAO_RETORNO: "Retorno da manutenção",
  EMPRESTIMO: "Empréstimo",
  DEVOLUCAO: "Devolução",
  CONSERVACAO: "Estado de conservação",
  OCORRENCIA: "Ocorrência",
  BAIXA: "Baixa",
  REATIVACAO: "Baixa desfeita",
};

/** Espelha a tabela `assets` (migration `version: 24`). */
export interface Asset {
  id: string;
  association_id: string;
  /** Número de patrimônio (plaqueta/tombamento), único na associação. */
  asset_number: string;
  name: string;
  description: string | null;
  category: string | null;
  serial_number: string | null;
  acquisition_date: string;
  acquisition_origin: OrigemAquisicao;
  /** Fornecedor, doador ou cedente. */
  acquisition_source: string | null;
  /** Centavos. */
  acquisition_value: number | null;
  /** Nota fiscal, termo de doação, contrato de comodato... */
  acquisition_document: string | null;
  location: string | null;
  responsible: string | null;
  condition: EstadoConservacao;
  status: StatusBem;
  disposal_type: TipoBaixa | null;
  disposal_date: string | null;
  disposal_reason: string | null;
  /** Centavos — valor de venda, quando a baixa é uma venda. */
  disposal_value: number | null;
  /** Comprador ou donatário. */
  disposal_recipient: string | null;
  observations: string | null;
  created_at: string;
  updated_at: string;
}

/** Espelha a tabela `asset_events` — linha do tempo do bem. */
export interface AssetEvent {
  id: string;
  asset_id: string;
  event_type: TipoEventoBem;
  event_date: string;
  description: string;
  /** Centavos — custo da manutenção, valor da compra/venda. */
  amount: number | null;
  cash_transaction_id: string | null;
  created_at: string;
}

/** Lançamento opcional no caixa junto com um evento do bem. */
export interface LancamentoCaixaBem {
  financial_account_id: string;
  payment_method_id?: string | null;
}

export interface NovoBem {
  asset_number: string;
  name: string;
  description?: string | null;
  category?: string | null;
  serial_number?: string | null;
  acquisition_date: string;
  acquisition_origin: OrigemAquisicao;
  acquisition_source?: string | null;
  acquisition_value?: number | null;
  acquisition_document?: string | null;
  location?: string | null;
  responsible?: string | null;
  condition: EstadoConservacao;
  observations?: string | null;
  /** Só faz sentido em `COMPRA` com valor — lança a despesa da compra no caixa. */
  lancamento?: LancamentoCaixaBem | null;
}

/**
 * Campos corrigíveis pela edição. Local, responsável, conservação e
 * situação ficam de fora de propósito: mudam só por evento
 * (`registrarEvento`), pra ficarem na linha do tempo.
 */
export type AtualizacaoBem = Partial<
  Pick<
    NovoBem,
    | "asset_number"
    | "name"
    | "description"
    | "category"
    | "serial_number"
    | "acquisition_date"
    | "acquisition_origin"
    | "acquisition_source"
    | "acquisition_value"
    | "acquisition_document"
    | "observations"
  >
>;

/**
 * Evento comum da linha do tempo. Cada tipo usa só parte dos campos:
 * - `TRANSFERENCIA`: `location` e/ou `responsible` novos;
 * - `MANUTENCAO_ENVIO`/`EMPRESTIMO`: `location` = com quem/onde está;
 * - `MANUTENCAO_RETORNO`: `amount` (custo), `condition`, `lancamento`;
 * - `DEVOLUCAO`/`CONSERVACAO`: `condition`;
 * - `OCORRENCIA`: só a descrição.
 */
export interface NovoEventoBem {
  event_type: Exclude<TipoEventoBem, "AQUISICAO" | "BAIXA" | "REATIVACAO">;
  event_date: string;
  description: string;
  location?: string | null;
  responsible?: string | null;
  condition?: EstadoConservacao | null;
  amount?: number | null;
  lancamento?: LancamentoCaixaBem | null;
}

export interface BaixaBem {
  disposal_type: TipoBaixa;
  disposal_date: string;
  disposal_reason: string;
  disposal_value?: number | null;
  disposal_recipient?: string | null;
  /** Só em `VENDA` com valor — lança a receita da venda no caixa. */
  lancamento?: LancamentoCaixaBem | null;
}

export interface FiltroBens {
  texto?: string | null;
  /** `"ATIVOS"` = tudo que não foi baixado. */
  status?: StatusBem | "ATIVOS" | null;
}

/** Situações a partir das quais cada evento pode ser registrado. */
export const EVENTOS_PERMITIDOS: Record<StatusBem, NovoEventoBem["event_type"][]> = {
  EM_USO: ["TRANSFERENCIA", "MANUTENCAO_ENVIO", "EMPRESTIMO", "CONSERVACAO", "OCORRENCIA"],
  EM_MANUTENCAO: ["MANUTENCAO_RETORNO", "OCORRENCIA"],
  EMPRESTADO: ["DEVOLUCAO", "OCORRENCIA"],
  BAIXADO: ["OCORRENCIA"],
};

/** Situação resultante de cada evento (ausente = não muda a situação). */
const STATUS_APOS_EVENTO: Partial<Record<TipoEventoBem, StatusBem>> = {
  MANUTENCAO_ENVIO: "EM_MANUTENCAO",
  MANUTENCAO_RETORNO: "EM_USO",
  EMPRESTIMO: "EMPRESTADO",
  DEVOLUCAO: "EM_USO",
};

function rotuloBem(bem: Pick<Asset, "asset_number" | "name">): string {
  return `${bem.name} (nº ${bem.asset_number})`;
}

/** Acesso às tabelas `assets` e `asset_events`. */
export class AssetModel {
  static async list(filtro: FiltroBens = {}): Promise<Asset[]> {
    const condicoes = ["association_id = $1"];
    const parametros: string[] = [getCurrentAssociationId()];

    if (filtro.status === "ATIVOS") {
      condicoes.push("status <> 'BAIXADO'");
    } else if (filtro.status) {
      parametros.push(filtro.status);
      condicoes.push(`status = $${parametros.length}`);
    }
    if (filtro.texto?.trim()) {
      parametros.push(`%${filtro.texto.trim()}%`);
      const p = `$${parametros.length}`;
      condicoes.push(
        `(name LIKE ${p} OR asset_number LIKE ${p} OR category LIKE ${p} OR location LIKE ${p} OR responsible LIKE ${p} OR serial_number LIKE ${p})`
      );
    }

    const db = await getDatabase();
    return db.select<Asset[]>(
      `SELECT * FROM assets WHERE ${condicoes.join(" AND ")}
       ORDER BY CAST(asset_number AS INTEGER), asset_number`,
      parametros
    );
  }

  static async get(id: string): Promise<Asset | null> {
    const db = await getDatabase();
    const rows = await db.select<Asset[]>("SELECT * FROM assets WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  static async eventos(assetId: string): Promise<AssetEvent[]> {
    const db = await getDatabase();
    return db.select<AssetEvent[]>(
      "SELECT * FROM asset_events WHERE asset_id = $1 ORDER BY event_date DESC, created_at DESC",
      [assetId]
    );
  }

  /** Categorias já usadas (sugestões do campo livre no formulário). */
  static async categorias(): Promise<string[]> {
    const db = await getDatabase();
    const rows = await db.select<{ category: string }[]>(
      `SELECT DISTINCT category FROM assets
       WHERE association_id = $1 AND category IS NOT NULL AND category <> ''
       ORDER BY category`,
      [getCurrentAssociationId()]
    );
    return rows.map((r) => r.category);
  }

  /** Sugestão de próximo número de patrimônio: maior número numérico + 1. */
  static async proximoNumero(): Promise<string> {
    const db = await getDatabase();
    const [{ maior }] = await db.select<{ maior: number | null }[]>(
      `SELECT MAX(CAST(asset_number AS INTEGER)) AS maior FROM assets
       WHERE association_id = $1 AND asset_number GLOB '[0-9]*'`,
      [getCurrentAssociationId()]
    );
    return String((maior ?? 0) + 1);
  }

  /**
   * Cadastra o bem e abre a linha do tempo com o evento `AQUISICAO`. Se
   * `lancamento` vier (compra com valor), lança a despesa no caixa e liga
   * ao evento.
   */
  static async create(dados: NovoBem): Promise<Asset> {
    return comAtividade(
      async () => {
        if (!dados.name.trim()) throw new Error("Informe o nome do bem.");
        if (!dados.asset_number.trim()) throw new Error("Informe o número de patrimônio.");

        const associationId = getCurrentAssociationId();
        const db = await getDatabase();
        const id = newId();

        await db.execute(
          `INSERT INTO assets
             (id, association_id, asset_number, name, description, category, serial_number, acquisition_date,
              acquisition_origin, acquisition_source, acquisition_value, acquisition_document, location,
              responsible, condition, observations)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            id,
            associationId,
            dados.asset_number.trim(),
            dados.name.trim(),
            dados.description ?? null,
            dados.category ?? null,
            dados.serial_number ?? null,
            dados.acquisition_date,
            dados.acquisition_origin,
            dados.acquisition_source ?? null,
            dados.acquisition_value ?? null,
            dados.acquisition_document ?? null,
            dados.location ?? null,
            dados.responsible ?? null,
            dados.condition,
            dados.observations ?? null,
          ]
        );

        let cashTransactionId: string | null = null;
        if (dados.lancamento && dados.acquisition_origin === "COMPRA" && dados.acquisition_value) {
          const transacao = await CashTransactionModel.create({
            financial_account_id: dados.lancamento.financial_account_id,
            payment_method_id: dados.lancamento.payment_method_id ?? null,
            transaction_type: "DESPESA",
            amount: dados.acquisition_value,
            transaction_date: dados.acquisition_date,
            competence_date: dados.acquisition_date,
            description: `Compra de patrimônio — ${rotuloBem({ name: dados.name, asset_number: dados.asset_number })}`,
            source_type: "ASSET",
            source_id: id,
          });
          cashTransactionId = transacao.id;
        }

        const partes = [ROTULO_ORIGEM[dados.acquisition_origin]];
        if (dados.acquisition_source) partes.push(`de ${dados.acquisition_source}`);
        if (dados.location) partes.push(`local: ${dados.location}`);
        await AssetModel.inserirEvento(db, {
          asset_id: id,
          event_type: "AQUISICAO",
          event_date: dados.acquisition_date,
          description: partes.join(" — "),
          amount: dados.acquisition_value ?? null,
          cash_transaction_id: cashTransactionId,
        });

        const criado = await AssetModel.get(id);
        if (!criado) throw new Error("Falha ao cadastrar o bem.");
        return criado;
      },
      (bem) => ({
        module: "PATRIMONIO",
        description: `Novo bem patrimonial — ${rotuloBem(bem)} — ${ROTULO_ORIGEM[bem.acquisition_origin]}${
          bem.acquisition_value ? ` — ${formatarMoeda(bem.acquisition_value)}` : ""
        }`,
        entity_type: "ASSET",
        entity_id: bem.id,
      })
    );
  }

  static async update(id: string, dados: AtualizacaoBem): Promise<void> {
    const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
    if (campos.length === 0) return;

    await comAtividade(
      async () => {
        const db = await getDatabase();
        const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
        const valores = campos.map(([, valor]) => valor as string | number | null);
        await db.execute(`UPDATE assets SET ${sets} WHERE id = $1`, [id, ...valores]);
        return AssetModel.get(id);
      },
      (bem) => ({
        module: "PATRIMONIO",
        description: `Cadastro do bem alterado — ${bem ? rotuloBem(bem) : id}`,
        entity_type: "ASSET",
        entity_id: id,
      })
    );
  }

  /**
   * Exclui o bem e toda a linha do tempo dele. Só pra cadastro feito por
   * engano — bem que saiu da associação deve ter BAIXA, não exclusão.
   * Bloqueado se algum evento gerou lançamento de caixa (o lançamento
   * ficaria apontando pra um bem que não existe mais; estorne antes).
   */
  static async remove(id: string): Promise<void> {
    const bem = await AssetModel.get(id);
    if (!bem) throw new Error("Bem não encontrado.");

    await comAtividade(
      async () => {
        const db = await getDatabase();
        const [{ total }] = await db.select<{ total: number }[]>(
          "SELECT COUNT(*) AS total FROM asset_events WHERE asset_id = $1 AND cash_transaction_id IS NOT NULL",
          [id]
        );
        if (total > 0) {
          throw new Error(
            "Este bem tem lançamento no caixa ligado a ele e não pode ser excluído. Se ele saiu da associação, registre uma baixa."
          );
        }
        await db.execute("DELETE FROM assets WHERE id = $1", [id]);
      },
      () => ({
        module: "PATRIMONIO",
        description: `Cadastro de bem excluído — ${rotuloBem(bem)}`,
        entity_type: "ASSET",
        entity_id: id,
      })
    );
  }

  /** Registra um evento comum da linha do tempo, atualizando situação/local/responsável/conservação. */
  static async registrarEvento(assetId: string, dados: NovoEventoBem): Promise<void> {
    const bem = await AssetModel.get(assetId);
    if (!bem) throw new Error("Bem não encontrado.");
    if (!EVENTOS_PERMITIDOS[bem.status].includes(dados.event_type)) {
      throw new Error(
        `Não é possível registrar "${ROTULO_EVENTO_BEM[dados.event_type]}" com o bem na situação "${ROTULO_STATUS_BEM[bem.status]}".`
      );
    }
    if (dados.event_date < bem.acquisition_date) {
      throw new Error("A data do evento não pode ser anterior à aquisição do bem.");
    }
    if (!dados.description.trim()) throw new Error("Descreva o evento.");

    await comAtividade(
      async () => {
        const db = await getDatabase();

        const sets: string[] = [];
        const valores: (string | null)[] = [];
        const definir = (campo: string, valor: string | null) => {
          valores.push(valor);
          sets.push(`${campo} = $${valores.length + 1}`);
        };

        const novoStatus = STATUS_APOS_EVENTO[dados.event_type];
        if (novoStatus) definir("status", novoStatus);
        if (dados.event_type === "TRANSFERENCIA") {
          if (dados.location !== undefined) definir("location", dados.location);
          if (dados.responsible !== undefined) definir("responsible", dados.responsible);
        }
        if (dados.condition) definir("condition", dados.condition);
        if (sets.length > 0) {
          await db.execute(`UPDATE assets SET ${sets.join(", ")} WHERE id = $1`, [assetId, ...valores]);
        }

        let cashTransactionId: string | null = null;
        if (dados.lancamento && dados.event_type === "MANUTENCAO_RETORNO" && dados.amount) {
          const transacao = await CashTransactionModel.create({
            financial_account_id: dados.lancamento.financial_account_id,
            payment_method_id: dados.lancamento.payment_method_id ?? null,
            transaction_type: "DESPESA",
            amount: dados.amount,
            transaction_date: dados.event_date,
            competence_date: dados.event_date,
            description: `Manutenção de patrimônio — ${rotuloBem(bem)}`,
            source_type: "ASSET",
            source_id: assetId,
          });
          cashTransactionId = transacao.id;
        }

        await AssetModel.inserirEvento(db, {
          asset_id: assetId,
          event_type: dados.event_type,
          event_date: dados.event_date,
          description: dados.description.trim(),
          amount: dados.amount ?? null,
          cash_transaction_id: cashTransactionId,
        });
      },
      () => ({
        module: "PATRIMONIO",
        description: `${ROTULO_EVENTO_BEM[dados.event_type]} — ${rotuloBem(bem)} — ${dados.description.trim()}`,
        entity_type: "ASSET",
        entity_id: assetId,
      })
    );
  }

  /** Baixa do bem (venda, doação, descarte, perda, furto...): motivo sempre obrigatório. */
  static async darBaixa(assetId: string, dados: BaixaBem): Promise<void> {
    const bem = await AssetModel.get(assetId);
    if (!bem) throw new Error("Bem não encontrado.");
    if (bem.status === "BAIXADO") throw new Error("Este bem já foi baixado.");
    if (!dados.disposal_reason.trim()) throw new Error("Informe o motivo da baixa.");
    if (dados.disposal_date < bem.acquisition_date) {
      throw new Error("A data da baixa não pode ser anterior à aquisição do bem.");
    }

    await comAtividade(
      async () => {
        const db = await getDatabase();
        const valor = dados.disposal_type === "VENDA" ? dados.disposal_value ?? null : null;

        await db.execute(
          `UPDATE assets
           SET status = 'BAIXADO', disposal_type = $2, disposal_date = $3, disposal_reason = $4,
               disposal_value = $5, disposal_recipient = $6
           WHERE id = $1`,
          [
            assetId,
            dados.disposal_type,
            dados.disposal_date,
            dados.disposal_reason.trim(),
            valor,
            dados.disposal_recipient ?? null,
          ]
        );

        let cashTransactionId: string | null = null;
        if (dados.lancamento && valor) {
          const transacao = await CashTransactionModel.create({
            financial_account_id: dados.lancamento.financial_account_id,
            payment_method_id: dados.lancamento.payment_method_id ?? null,
            transaction_type: "RECEITA",
            amount: valor,
            transaction_date: dados.disposal_date,
            competence_date: dados.disposal_date,
            description: `Venda de patrimônio — ${rotuloBem(bem)}`,
            source_type: "ASSET",
            source_id: assetId,
          });
          cashTransactionId = transacao.id;
        }

        const partes = [ROTULO_TIPO_BAIXA[dados.disposal_type]];
        if (dados.disposal_recipient) partes.push(`para ${dados.disposal_recipient}`);
        partes.push(`motivo: ${dados.disposal_reason.trim()}`);
        await AssetModel.inserirEvento(db, {
          asset_id: assetId,
          event_type: "BAIXA",
          event_date: dados.disposal_date,
          description: partes.join(" — "),
          amount: valor,
          cash_transaction_id: cashTransactionId,
        });
      },
      () => ({
        module: "PATRIMONIO",
        description: `Baixa de bem — ${rotuloBem(bem)} — ${ROTULO_TIPO_BAIXA[dados.disposal_type]} em ${formatarData(
          dados.disposal_date
        )} — motivo: ${dados.disposal_reason.trim()}`,
        entity_type: "ASSET",
        entity_id: assetId,
      })
    );
  }

  /**
   * Desfaz uma baixa registrada por engano: o bem volta a "Em uso" e a
   * baixa continua visível na linha do tempo, seguida do evento
   * `REATIVACAO` com a justificativa. Lançamento de venda, se houve, NÃO é
   * estornado sozinho — fica a cargo do usuário no Financeiro.
   */
  static async desfazerBaixa(assetId: string, justificativa: string): Promise<void> {
    const bem = await AssetModel.get(assetId);
    if (!bem) throw new Error("Bem não encontrado.");
    if (bem.status !== "BAIXADO") throw new Error("Este bem não está baixado.");
    if (!justificativa.trim()) throw new Error("Informe por que a baixa está sendo desfeita.");

    await comAtividade(
      async () => {
        const db = await getDatabase();
        await db.execute(
          `UPDATE assets
           SET status = 'EM_USO', disposal_type = NULL, disposal_date = NULL, disposal_reason = NULL,
               disposal_value = NULL, disposal_recipient = NULL
           WHERE id = $1`,
          [assetId]
        );
        await AssetModel.inserirEvento(db, {
          asset_id: assetId,
          event_type: "REATIVACAO",
          event_date: hojeIso(),
          description: justificativa.trim(),
          amount: null,
          cash_transaction_id: null,
        });
      },
      () => ({
        module: "PATRIMONIO",
        description: `Baixa desfeita — ${rotuloBem(bem)} — ${justificativa.trim()}`,
        entity_type: "ASSET",
        entity_id: assetId,
      })
    );
  }

  private static async inserirEvento(
    db: Awaited<ReturnType<typeof getDatabase>>,
    evento: Omit<AssetEvent, "id" | "created_at">
  ): Promise<void> {
    await db.execute(
      `INSERT INTO asset_events (id, asset_id, event_type, event_date, description, amount, cash_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        newId(),
        evento.asset_id,
        evento.event_type,
        evento.event_date,
        evento.description,
        evento.amount,
        evento.cash_transaction_id,
      ]
    );
  }
}
