import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { comAtividade } from "./ActivityLog.js";

/**
 * Espelha a tabela `document_types` (migration `version: 7`). Classifica os
 * documentos (estatuto, ata, ofício, portaria, contrato, procuração,
 * documento cadastral, correspondência recebida etc. — ver
 * `docs/dominio-associacoes.md`, seção 4.5).
 */
export interface DocumentType {
  id: string;
  association_id: string;
  name: string;
  retention_period_months: number | null;
  requires_expiration: 0 | 1;
  is_confidential: 0 | 1;
  is_active: 0 | 1;
}

export interface NovoTipoDocumento {
  name: string;
  retention_period_months?: number | null;
  requires_expiration?: boolean;
  is_confidential?: boolean;
}

/**
 * Tipos pré-cadastrados na criação de uma associação nova (ver
 * `DocumentTypeModel.seedPadrao`) — os mais comuns no dia a dia (declaração
 * de associado, edital de convocação, ofício, recibo e ata de reunião),
 * pra não obrigar o usuário a cadastrar um a um antes do primeiro
 * upload/protocolo. Continuam livremente editáveis/desativáveis depois.
 */
const NOMES_TIPOS_PADRAO = ["Declaração", "Edital", "Ofício", "Recibo", "Ata"];

export class DocumentTypeModel {
  static async list(): Promise<DocumentType[]> {
    const db = await getDatabase();
    return db.select<DocumentType[]>("SELECT * FROM document_types WHERE association_id = $1 ORDER BY name", [
      getCurrentAssociationId(),
    ]);
  }

  static async listActive(): Promise<DocumentType[]> {
    const db = await getDatabase();
    return db.select<DocumentType[]>(
      "SELECT * FROM document_types WHERE association_id = $1 AND is_active = 1 ORDER BY name",
      [getCurrentAssociationId()]
    );
  }

  static async create(dados: NovoTipoDocumento): Promise<DocumentType> {
    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();
        const db = await getDatabase();
        const id = newId();
        await db.execute(
          `INSERT INTO document_types (id, association_id, name, retention_period_months, requires_expiration, is_confidential)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            associationId,
            dados.name,
            dados.retention_period_months ?? null,
            dados.requires_expiration ? 1 : 0,
            dados.is_confidential ? 1 : 0,
          ]
        );

        const [criado] = await db.select<DocumentType[]>("SELECT * FROM document_types WHERE id = $1", [id]);
        return criado;
      },
      (tipo) => ({
        module: "DOCUMENTOS",
        description: `Tipo de documento cadastrado — ${tipo.name}`,
      })
    );
  }

  static async setActive(id: string, ativo: boolean): Promise<void> {
    const [atual] = await (await getDatabase()).select<{ name: string }[]>("SELECT name FROM document_types WHERE id = $1", [id]);

    return comAtividade(
      async () => {
        const db = await getDatabase();
        await db.execute("UPDATE document_types SET is_active = $2 WHERE id = $1", [id, ativo ? 1 : 0]);
      },
      () => ({
        module: "DOCUMENTOS",
        description: `Tipo de documento ${ativo ? "reativado" : "desativado"} — ${atual?.name ?? id}`,
      })
    );
  }

  /**
   * Cria de uma vez os tipos de documento de `NOMES_TIPOS_PADRAO` — chamado
   * só logo depois de `AssociationModel.create()`, na primeira vez que uma
   * associação é cadastrada (ver `InstitutionalDataEditor.vue`), quando
   * ainda não existe nenhum tipo na tabela.
   */
  static async seedPadrao(): Promise<void> {
    return comAtividade(
      async () => {
        for (const name of NOMES_TIPOS_PADRAO) {
          await DocumentTypeModel.create({ name });
        }
      },
      () => ({
        module: "DOCUMENTOS",
        description: `Tipos de documento padrão cadastrados — ${NOMES_TIPOS_PADRAO.join(", ")}`,
      })
    );
  }
}
