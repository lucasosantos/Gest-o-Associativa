import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { anoAtual } from "../utils/format.js";
import { ActivityLogModel, comAtividade } from "./ActivityLog.js";

/**
 * Espelha a tabela `protocol_books` (migration `version: 6`). `next_number`
 * é o contador atômico usado por `ProtocolEntryModel.create` (via
 * `UPDATE ... RETURNING`) — nunca deve ser editado manualmente fora dali.
 */
export interface ProtocolBook {
  id: string;
  association_id: string;
  name: string;
  protocol_type: string;
  year: number;
  prefix: string | null;
  next_number: number;
  is_active: 0 | 1;
}

export interface NovoLivroProtocolo {
  name: string;
  protocol_type: string;
  year: number;
  prefix?: string | null;
}

export interface AtualizacaoLivroProtocolo {
  name?: string;
  protocol_type?: string;
  year?: number;
  prefix?: string | null;
}

/** Livro com a contagem de protocolos já lançados nele — uso na tela de gestão de livros (ver `Documentos.vue`). */
export interface ProtocolBookComContagem extends ProtocolBook {
  entry_count: number;
}

/** Acesso à tabela `protocol_books`. */
export class ProtocolBookModel {
  /**
   * Fecha (`is_active = 0`) todo livro aberto cujo ano já passou — chamado
   * antes de listar ou de emitir um novo protocolo, pra o status refletir a
   * regra de vigência (livro só vale pro ano dele) sem depender de o
   * usuário lembrar de encerrar na virada do ano.
   */
  static async fecharLivrosDoAnoEncerrado(): Promise<void> {
    const db = await getDatabase();
    const { rowsAffected } = await db.execute(
      "UPDATE protocol_books SET is_active = 0 WHERE association_id = $1 AND is_active = 1 AND year < $2",
      [getCurrentAssociationId(), anoAtual()]
    );
    // Roda a cada listagem — só entra no histórico quando fechou algum livro de fato.
    if (rowsAffected > 0) {
      await ActivityLogModel.registrar({
        module: "PROTOCOLOS",
        description: `Livros de protocolo de anos anteriores fechados automaticamente (${rowsAffected})`,
      });
    }
  }

  /** Verdadeiro se o livro já tem algum protocolo lançado — trava edição e exclusão. */
  private static async temProtocoloLancado(id: string): Promise<boolean> {
    const db = await getDatabase();
    const [{ total }] = await db.select<{ total: number }[]>(
      "SELECT COUNT(*) AS total FROM protocol_entries WHERE protocol_book_id = $1",
      [id]
    );
    return total > 0;
  }

  static async list(): Promise<ProtocolBook[]> {
    await ProtocolBookModel.fecharLivrosDoAnoEncerrado();
    const db = await getDatabase();
    return db.select<ProtocolBook[]>(
      "SELECT * FROM protocol_books WHERE association_id = $1 ORDER BY year DESC, name",
      [getCurrentAssociationId()]
    );
  }

  /** Mesma lista, com `entry_count` (protocolos já lançados) — só editável/excluível quando esse número é 0. */
  static async listComContagem(): Promise<ProtocolBookComContagem[]> {
    await ProtocolBookModel.fecharLivrosDoAnoEncerrado();
    const db = await getDatabase();
    return db.select<ProtocolBookComContagem[]>(
      `SELECT b.*, COUNT(e.id) AS entry_count
       FROM protocol_books b
       LEFT JOIN protocol_entries e ON e.protocol_book_id = b.id
       WHERE b.association_id = $1
       GROUP BY b.id
       ORDER BY b.year DESC, b.name`,
      [getCurrentAssociationId()]
    );
  }

  /**
   * Livros ativos de um tipo específico — uso nos dropdowns de numeração
   * automática (recibo de mensalidade, declaração de associado etc., ver
   * `MembershipPaymentModel.listarLivrosRecibo`/`DeclaracaoForm.vue`).
   */
  static async listActiveByType(protocolType: string): Promise<ProtocolBook[]> {
    const livros = await ProtocolBookModel.list();
    return livros.filter((livro) => livro.protocol_type === protocolType && livro.is_active);
  }

  static async get(id: string): Promise<ProtocolBook | null> {
    const db = await getDatabase();
    const rows = await db.select<ProtocolBook[]>("SELECT * FROM protocol_books WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  /** Só é possível abrir um livro para o ano corrente — nem um ano já encerrado, nem um ano à frente. */
  static async create(dados: NovoLivroProtocolo): Promise<ProtocolBook> {
    if (dados.year !== anoAtual()) {
      throw new Error(`Só é possível abrir um livro para o ano corrente (${anoAtual()}).`);
    }

    return comAtividade(
      async () => {
        const associationId = getCurrentAssociationId();
        const db = await getDatabase();
        const id = newId();
        await db.execute(
          `INSERT INTO protocol_books (id, association_id, name, protocol_type, year, prefix)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, associationId, dados.name, dados.protocol_type, dados.year, dados.prefix ?? null]
        );

        const [criado] = await db.select<ProtocolBook[]>("SELECT * FROM protocol_books WHERE id = $1", [id]);
        return criado;
      },
      (livro) => ({
        module: "PROTOCOLOS",
        description: `Livro de protocolo aberto — ${livro.name} (${livro.year})`,
      })
    );
  }

  /**
   * Edita nome/tipo/ano/prefixo — nunca `next_number` nem `is_active` (fora
   * do escopo desta tela). Bloqueado assim que o livro tem qualquer
   * protocolo lançado: mudar tipo/ano/prefixo de um livro já usado
   * invalidaria a numeração e o ano gravados nos protocolos existentes.
   * Se `year` for informado, vale a mesma regra de `create` (só o ano
   * corrente).
   */
  static async update(id: string, dados: AtualizacaoLivroProtocolo): Promise<void> {
    const campos = Object.entries(dados).filter(([, valor]) => valor !== undefined);
    if (campos.length === 0) return;

    if (await ProtocolBookModel.temProtocoloLancado(id)) {
      throw new Error("Este livro já tem protocolo lançado e não pode ser editado.");
    }

    if (dados.year !== undefined && dados.year !== anoAtual()) {
      throw new Error(`Só é possível abrir um livro para o ano corrente (${anoAtual()}).`);
    }

    const livro = await ProtocolBookModel.get(id);

    return comAtividade(
      async () => {
        const db = await getDatabase();
        const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
        const valores = campos.map(([, valor]) => valor as string | number | null);

        await db.execute(`UPDATE protocol_books SET ${sets} WHERE id = $1`, [id, ...valores]);
      },
      () => ({
        module: "PROTOCOLOS",
        description: `Livro de protocolo alterado — ${dados.name ?? livro?.name ?? id}`,
      })
    );
  }

  /**
   * Encerra (ou reabre) o livro — método dedicado, fora de `update()` de
   * propósito (mesmo padrão de `DocumentTypeModel.setActive`). Livro
   * encerrado some dos dropdowns de numeração automática
   * (`MembershipPaymentModel.listarLivrosRecibo`,
   * `ProtocolBookModel.listActiveByType`, `ProtocolEntryForm.vue`), mas os
   * protocolos já lançados nele continuam intactos — encerrar não é apagar.
   *
   * Reabrir só é permitido se o livro for do ano corrente: senão o botão
   * "Reabrir" da tela de livros driblaria o fechamento automático de
   * `fecharLivrosDoAnoEncerrado`.
   */
  static async setActive(id: string, isActive: boolean): Promise<void> {
    const livro = await ProtocolBookModel.get(id);
    if (!livro) throw new Error("Livro de protocolo não encontrado.");
    if (isActive && livro.year !== anoAtual()) {
      throw new Error(`Este livro é do ano ${livro.year} e só pode ser reaberto no ano corrente (${anoAtual()}).`);
    }

    return comAtividade(
      async () => {
        const db = await getDatabase();
        await db.execute("UPDATE protocol_books SET is_active = $2 WHERE id = $1", [id, isActive ? 1 : 0]);
      },
      () => ({
        module: "PROTOCOLOS",
        description: `Livro de protocolo ${isActive ? "reaberto" : "fechado"} — ${livro.name}`,
      })
    );
  }

  /**
   * Apaga o livro — só permitido quando ele não tem nenhum protocolo
   * lançado (checado de novo aqui como defesa em profundidade:
   * `protocol_entries.protocol_book_id` referencia este livro sem `ON
   * DELETE CASCADE`, então o próprio banco já rejeitaria o `DELETE` nesse
   * caso — este erro só fica mais amigável que o do SQLite).
   */
  static async remove(id: string): Promise<void> {
    if (await ProtocolBookModel.temProtocoloLancado(id)) {
      throw new Error("Este livro já tem protocolo lançado e não pode ser excluído.");
    }

    const livro = await ProtocolBookModel.get(id);

    return comAtividade(
      async () => {
        const db = await getDatabase();
        await db.execute("DELETE FROM protocol_books WHERE id = $1", [id]);
      },
      () => ({
        module: "PROTOCOLOS",
        description: `Livro de protocolo excluído — ${livro?.name ?? id}`,
      })
    );
  }
}
