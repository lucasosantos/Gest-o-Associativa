import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";

/**
 * Espelha a tabela `document_links` (migration `version: 7`) — vínculo
 * genérico entre um documento e outro registro do sistema. Sem FK real para
 * `entity_id` (chave polimórfica, mesmo espírito de `source_type`/
 * `source_id` em `cash_transactions`): a lista de tipos conhecidos abaixo é
 * a validação que existe, feita em código.
 *
 * Só `MEMBER` e `PROTOCOL_ENTRY` têm um seletor dedicado na UI hoje (Etapas
 * 2 e 6 já existem), mas os dois sentidos não são simétricos:
 * - A partir do documento (`DocumentoDetalhes.vue`, aba Vínculos, via
 *   `DocumentLinkForm.vue`), qualquer um dos dois tipos escolhe entre
 *   registros JÁ existentes (sócio ou protocolo).
 * - A partir do sócio (`SocioDetalhes.vue`), mesma lógica: escolhe um
 *   documento já existente pra anexar.
 * - A partir do protocolo (aba Protocolos de `Documentos.vue`), NÃO se
 *   escolhe um documento existente: `DocumentUploadForm.vue` importa um
 *   arquivo novo (com título/data sugeridos pelo próprio protocolo) e cria
 *   o vínculo direto — decisão do usuário (o recibo/ofício físico quase
 *   sempre é um arquivo novo, nunca um documento já cadastrado por outro
 *   motivo). `listForEntities` só lê pra exibir a lista já vinculada.
 *
 * Os demais tipos existem no schema para o dicionário de dados original
 * (contas, reuniões, projetos, patrimônio, associação), mas ficam pra
 * quando as telas correspondentes existirem (Fase 2 em diante) —
 * vinculáveis só a partir do documento, com o identificador colado
 * manualmente (ver `DocumentLinkForm.vue`).
 */
export const TIPOS_ENTIDADE_VINCULAVEL = [
  "ASSOCIATION",
  "MEMBER",
  "PROTOCOL_ENTRY",
  "CASH_TRANSACTION",
  "PAYABLE",
  "RECEIVABLE",
  "MEETING",
  "PROJECT",
  "ASSET",
] as const;

export type TipoEntidadeVinculavel = (typeof TIPOS_ENTIDADE_VINCULAVEL)[number];

export const ROTULO_TIPO_ENTIDADE: Record<TipoEntidadeVinculavel, string> = {
  ASSOCIATION: "Associação",
  MEMBER: "Sócio",
  PROTOCOL_ENTRY: "Protocolo",
  CASH_TRANSACTION: "Lançamento financeiro",
  PAYABLE: "Conta a pagar",
  RECEIVABLE: "Conta a receber",
  MEETING: "Reunião",
  PROJECT: "Projeto",
  ASSET: "Bem patrimonial",
};

export interface DocumentLink {
  id: string;
  document_id: string;
  entity_type: TipoEntidadeVinculavel;
  entity_id: string;
  link_role: string;
  created_at: string;
}

export interface NovoVinculoDocumento {
  document_id: string;
  entity_type: TipoEntidadeVinculavel;
  entity_id: string;
  link_role?: string;
}

/** Vínculo com o título do documento já unido (uso na ficha da entidade vinculada, ex.: sócio). */
export interface DocumentLinkComDocumento extends DocumentLink {
  document_title: string;
}

export class DocumentLinkModel {
  static async listForDocument(documentId: string): Promise<DocumentLink[]> {
    const db = await getDatabase();
    return db.select<DocumentLink[]>(
      "SELECT * FROM document_links WHERE document_id = $1 ORDER BY created_at DESC",
      [documentId]
    );
  }

  /** Documentos vinculados a um registro específico (ex.: ficha do sócio). */
  static async listForEntity(entityType: TipoEntidadeVinculavel, entityId: string): Promise<DocumentLinkComDocumento[]> {
    const db = await getDatabase();
    return db.select<DocumentLinkComDocumento[]>(
      `SELECT l.*, d.title AS document_title
       FROM document_links l
       JOIN documents d ON d.id = l.document_id
       WHERE l.entity_type = $1 AND l.entity_id = $2
       ORDER BY l.created_at DESC`,
      [entityType, entityId]
    );
  }

  /**
   * Mesma busca, mas pra várias entidades do mesmo tipo de uma vez — usada
   * em listas (ex.: aba Protocolos de `Documentos.vue`) pra evitar 1 query
   * por linha da tabela. Agrupe o resultado por `entity_id` no chamador.
   */
  static async listForEntities(
    entityType: TipoEntidadeVinculavel,
    entityIds: string[]
  ): Promise<DocumentLinkComDocumento[]> {
    if (entityIds.length === 0) return [];

    const db = await getDatabase();
    const placeholders = entityIds.map((_, indice) => `$${indice + 2}`).join(", ");
    return db.select<DocumentLinkComDocumento[]>(
      `SELECT l.*, d.title AS document_title
       FROM document_links l
       JOIN documents d ON d.id = l.document_id
       WHERE l.entity_type = $1 AND l.entity_id IN (${placeholders})
       ORDER BY l.created_at DESC`,
      [entityType, ...entityIds]
    );
  }

  static async create(dados: NovoVinculoDocumento): Promise<DocumentLink> {
    if (!TIPOS_ENTIDADE_VINCULAVEL.includes(dados.entity_type)) {
      throw new Error(`Tipo de entidade desconhecido: ${dados.entity_type}`);
    }

    const db = await getDatabase();
    const id = newId();
    await db.execute(
      `INSERT INTO document_links (id, document_id, entity_type, entity_id, link_role)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, dados.document_id, dados.entity_type, dados.entity_id, dados.link_role ?? "ANEXO"]
    );

    const [criado] = await db.select<DocumentLink[]>("SELECT * FROM document_links WHERE id = $1", [id]);
    return criado;
  }

  static async remove(id: string): Promise<void> {
    const db = await getDatabase();
    await db.execute("DELETE FROM document_links WHERE id = $1", [id]);
  }
}
