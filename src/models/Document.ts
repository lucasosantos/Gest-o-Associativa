import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { importDocumentFile } from "../services/documentFiles.js";
import { comAtividade } from "./ActivityLog.js";

/** Situação do documento (ver `docs/dominio-associacoes.md`, seção 2.7). */
export type StatusDocumento = "ATIVO" | "ARQUIVADO" | "CANCELADO";

/** Particípio usado no histórico de atividades ("Documento arquivado — ..."). */
const ROTULO_STATUS_DOCUMENTO: Record<StatusDocumento, string> = {
  ATIVO: "reativado",
  ARQUIVADO: "arquivado",
  CANCELADO: "cancelado",
};

/** Nível de confidencialidade — controla quem pode ver/baixar (Etapa 8 aplica a permissão de fato). */
export type ConfidencialidadeDocumento = "PUBLICO" | "INTERNO" | "RESTRITO" | "CONFIDENCIAL";

export type AcaoAcessoDocumento = "VISUALIZOU" | "BAIXOU" | "EDITOU_METADADOS" | "CRIOU_VERSAO";

/** Espelha a tabela `documents` (migration `version: 7`). */
export interface Document {
  id: string;
  association_id: string;
  document_type_id: string | null;
  title: string;
  description: string | null;
  status: StatusDocumento;
  confidentiality: ConfidencialidadeDocumento;
  document_date: string | null;
  expiration_date: string | null;
  owner_user_id: string | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Documento com o nome do tipo e o nome/chave de armazenamento do arquivo da versão atual, já unidos (uso em listas). */
export interface DocumentComDetalhes extends Document {
  document_type_name: string | null;
  current_version_filename: string | null;
  /** `storage_key` da versão atual — `null` se o documento ainda não tem nenhuma versão. Uso no botão "Abrir" da lista (`Documentos.vue`). */
  current_version_storage_key: string | null;
}

/** Espelha a tabela `document_versions`. */
export interface DocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  storage_key: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  checksum_sha256: string;
  uploaded_by: string | null;
  uploaded_at: string;
  change_note: string | null;
}

export interface NovoDocumento {
  title: string;
  description?: string | null;
  document_type_id?: string | null;
  confidentiality?: ConfidencialidadeDocumento;
  document_date?: string | null;
  expiration_date?: string | null;
  /** Caminho absoluto do arquivo escolhido via `@tauri-apps/plugin-dialog`. */
  source_path: string;
}

export interface AtualizacaoDocumento {
  title?: string;
  description?: string | null;
  document_type_id?: string | null;
  confidentiality?: ConfidencialidadeDocumento;
  document_date?: string | null;
  expiration_date?: string | null;
}

export interface FiltroDocumentos {
  documentTypeId?: string;
  status?: StatusDocumento;
  texto?: string;
}

const SELECT_COM_DETALHES = `
  SELECT d.*, dt.name AS document_type_name, dv.original_filename AS current_version_filename,
         dv.storage_key AS current_version_storage_key
  FROM documents d
  LEFT JOIN document_types dt ON dt.id = d.document_type_id
  LEFT JOIN document_versions dv ON dv.id = d.current_version_id
`;

/** Acesso às tabelas `documents`/`document_versions` e à cópia física do arquivo (ver `services/documentFiles.ts`). */
export class DocumentModel {
  static async list(filtro: FiltroDocumentos = {}): Promise<DocumentComDetalhes[]> {
    const db = await getDatabase();
    const condicoes: string[] = ["d.association_id = $1"];
    const valores: unknown[] = [getCurrentAssociationId()];

    if (filtro.documentTypeId) {
      valores.push(filtro.documentTypeId);
      condicoes.push(`d.document_type_id = $${valores.length}`);
    }
    if (filtro.status) {
      valores.push(filtro.status);
      condicoes.push(`d.status = $${valores.length}`);
    }
    if (filtro.texto) {
      valores.push(`%${filtro.texto}%`);
      condicoes.push(`(d.title LIKE $${valores.length} OR d.description LIKE $${valores.length})`);
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";
    return db.select<DocumentComDetalhes[]>(`${SELECT_COM_DETALHES} ${where} ORDER BY d.updated_at DESC`, valores);
  }

  static async get(id: string): Promise<DocumentComDetalhes | null> {
    const db = await getDatabase();
    const rows = await db.select<DocumentComDetalhes[]>(`${SELECT_COM_DETALHES} WHERE d.id = $1`, [id]);
    return rows[0] ?? null;
  }

  /**
   * O arquivo do documento — sem fluxo de "nova versão" (removido a pedido
   * do usuário: um documento tem exatamente 1 arquivo, criado junto com ele
   * em `create`). A tabela `document_versions` por baixo ainda existe (só
   * uma linha por documento, sempre `version_number = 1`) porque é onde os
   * metadados do arquivo (tamanho, tipo MIME, hash) já viviam — não valia a
   * pena uma migration só pra mover essas colunas pra `documents`.
   */
  static async getCurrentVersion(documentId: string): Promise<DocumentVersion | null> {
    const db = await getDatabase();
    const rows = await db.select<DocumentVersion[]>(
      `SELECT dv.* FROM document_versions dv
       JOIN documents d ON d.current_version_id = dv.id
       WHERE d.id = $1`,
      [documentId]
    );
    return rows[0] ?? null;
  }

  /** Cria o documento e já importa o arquivo escolhido — a única versão que o documento chega a ter. */
  static async create(dados: NovoDocumento): Promise<Document> {
    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();
        const db = await getDatabase();
        const id = newId();

        await db.execute(
          `INSERT INTO documents (id, association_id, document_type_id, title, description, confidentiality, document_date, expiration_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            associationId,
            dados.document_type_id ?? null,
            dados.title,
            dados.description ?? null,
            dados.confidentiality ?? "INTERNO",
            dados.document_date ?? null,
            dados.expiration_date ?? null,
          ]
        );

        await DocumentModel.criarVersao(id, dados.source_path);

        const [criado] = await db.select<Document[]>("SELECT * FROM documents WHERE id = $1", [id]);
        return criado;
      },
      (documento) => ({
        module: "DOCUMENTOS",
        description: `Documento cadastrado — ${documento.title}`,
        entity_type: "DOCUMENT",
        entity_id: documento.id,
      })
    );
  }

  private static async criarVersao(documentId: string, sourcePath: string): Promise<DocumentVersion> {
    const importado = await importDocumentFile(sourcePath, documentId, 1);

    const db = await getDatabase();
    const versionId = newId();
    await db.execute(
      `INSERT INTO document_versions
         (id, document_id, version_number, storage_key, original_filename, mime_type, file_size, checksum_sha256)
       VALUES ($1, $2, 1, $3, $4, $5, $6, $7)`,
      [
        versionId,
        documentId,
        importado.storage_key,
        importado.original_filename,
        importado.mime_type,
        importado.file_size,
        importado.checksum_sha256,
      ]
    );

    await db.execute("UPDATE documents SET current_version_id = $2 WHERE id = $1", [documentId, versionId]);
    await DocumentModel.logAccess(documentId, "CRIOU_VERSAO");

    const [criado] = await db.select<DocumentVersion[]>("SELECT * FROM document_versions WHERE id = $1", [versionId]);
    return criado;
  }

  static async update(id: string, dados: AtualizacaoDocumento): Promise<void> {
    const [atual] = await (await getDatabase()).select<{ title: string }[]>("SELECT title FROM documents WHERE id = $1", [id]);

    return comAtividade(
      async () => {
        const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
        if (campos.length === 0) return;

        const db = await getDatabase();
        const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
        const valores = campos.map(([, valor]) => valor as string | null);
        await db.execute(`UPDATE documents SET ${sets} WHERE id = $1`, [id, ...valores]);
        await DocumentModel.logAccess(id, "EDITOU_METADADOS");
      },
      () => ({
        module: "DOCUMENTOS",
        description: `Dados do documento alterados — ${dados.title ?? atual?.title ?? id}`,
        entity_type: "DOCUMENT",
        entity_id: id,
      })
    );
  }

  static async updateStatus(id: string, status: StatusDocumento): Promise<void> {
    const [atual] = await (await getDatabase()).select<{ title: string }[]>("SELECT title FROM documents WHERE id = $1", [id]);

    return comAtividade(
      async () => {
        const db = await getDatabase();
        await db.execute("UPDATE documents SET status = $2 WHERE id = $1", [id, status]);
      },
      () => ({
        module: "DOCUMENTOS",
        description: `Documento ${ROTULO_STATUS_DOCUMENTO[status]} — ${atual?.title ?? id}`,
        entity_type: "DOCUMENT",
        entity_id: id,
      })
    );
  }

  static async logAccess(documentId: string, action: AcaoAcessoDocumento): Promise<void> {
    return comAtividade(
      async () => {
        const db = await getDatabase();
        await db.execute("INSERT INTO document_access_logs (id, document_id, action) VALUES ($1, $2, $3)", [
          newId(),
          documentId,
          action,
        ]);
      },
      async () => {
        // Visualizar não altera nada — fica só no log de acesso do documento.
        // Baixar gera uma cópia do arquivo fora do sistema, então entra no histórico.
        if (action !== "BAIXOU") return null;
        const [doc] = await (await getDatabase()).select<{ title: string }[]>("SELECT title FROM documents WHERE id = $1", [
          documentId,
        ]);
        return {
          module: "DOCUMENTOS",
          description: `Arquivo do documento baixado — ${doc?.title ?? documentId}`,
          entity_type: "DOCUMENT",
          entity_id: documentId,
        };
      }
    );
  }
}
