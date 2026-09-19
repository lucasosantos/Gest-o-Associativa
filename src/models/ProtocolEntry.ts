import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { ProtocolBookModel } from "./ProtocolBook.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { anoAtual } from "../utils/format.js";

export type DirecaoProtocolo = "RECEBIDO" | "EXPEDIDO" | "INTERNO";
export type StatusProtocolo = "ABERTO" | "EM_ANDAMENTO" | "RESPONDIDO" | "ENCERRADO" | "CANCELADO";

/** Espelha a tabela `protocol_entries` (migration `version: 6`). */
export interface ProtocolEntry {
  id: string;
  protocol_book_id: string;
  number: number;
  year: number;
  direction: DirecaoProtocolo;
  document_type: string;
  protocol_date: string;
  sender_name: string | null;
  recipient_name: string | null;
  subject: string;
  /** Solto, sem FK: `users` só existe a partir da Etapa 8. */
  responsible_user_id: string | null;
  deadline: string | null;
  status: StatusProtocolo;
  response_protocol_id: string | null;
  /** Solto, sem FK: `documents` só existe a partir da Etapa 7. */
  document_id: string | null;
  /** Sócio a quem este protocolo se refere, se algum (ex.: declaração de associado) — migration `version: 15`. */
  member_id: string | null;
  notes: string | null;
  created_at: string;
}

/** Protocolo com o nome do livro já unido, para exibição em lista. */
export interface ProtocolEntryComLivro extends ProtocolEntry {
  book_name: string;
  book_prefix: string | null;
}

export interface NovoProtocolo {
  protocol_book_id: string;
  direction: DirecaoProtocolo;
  protocol_date: string;
  sender_name?: string | null;
  recipient_name?: string | null;
  subject: string;
  deadline?: string | null;
  notes?: string | null;
  response_protocol_id?: string | null;
  member_id?: string | null;
}

const SELECT_COM_LIVRO = `
  SELECT e.*, b.name AS book_name, b.prefix AS book_prefix
  FROM protocol_entries e
  JOIN protocol_books b ON b.id = e.protocol_book_id
`;

/** Formata o número do protocolo para exibição (ex.: "OF-15/2026"). */
export function formatarNumeroProtocolo(entry: Pick<ProtocolEntry, "number" | "year">, prefix: string | null): string {
  return `${prefix ?? ""}${entry.number}/${entry.year}`;
}

/**
 * Acesso à tabela `protocol_entries`. Protocolos lançados não são apagados
 * — só cancelados via mudança de `status` (ver
 * `docs/dominio-associacoes.md`, seção 2.6 e regra da seção 6).
 */
export class ProtocolEntryModel {
  static async list(filtros?: { protocolBookId?: string; status?: StatusProtocolo }): Promise<ProtocolEntryComLivro[]> {
    const db = await getDatabase();
    const condicoes: string[] = ["b.association_id = $1"];
    const valores: string[] = [getCurrentAssociationId()];

    if (filtros?.protocolBookId) {
      valores.push(filtros.protocolBookId);
      condicoes.push(`e.protocol_book_id = $${valores.length}`);
    }
    if (filtros?.status) {
      valores.push(filtros.status);
      condicoes.push(`e.status = $${valores.length}`);
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";
    return db.select<ProtocolEntryComLivro[]>(
      `${SELECT_COM_LIVRO} ${where} ORDER BY e.protocol_date DESC, e.number DESC`,
      valores
    );
  }

  static async get(id: string): Promise<ProtocolEntryComLivro | null> {
    const db = await getDatabase();
    const rows = await db.select<ProtocolEntryComLivro[]>(`${SELECT_COM_LIVRO} WHERE e.id = $1`, [id]);
    return rows[0] ?? null;
  }

  /**
   * Numeração atômica via `UPDATE ... RETURNING` em `protocol_books.next_number`
   * (SQLite ≥ 3.35 — ver nota na migration `version: 6`), seguida do
   * `INSERT` do protocolo com o número obtido.
   *
   * Antes de numerar: fecha automaticamente qualquer livro aberto cujo ano
   * já passou (`ProtocolBookModel.fecharLivrosDoAnoEncerrado`) e recusa
   * emitir protocolo em livro de ano já encerrado ou já fechado — livro só
   * vale pro ano dele. `document_type` não é recebido de fora: sempre o
   * `protocol_type` do livro escolhido, pra um protocolo nunca divergir do
   * tipo do livro em que foi lançado.
   */
  static async create(dados: NovoProtocolo): Promise<ProtocolEntry> {
    await ProtocolBookModel.fecharLivrosDoAnoEncerrado();

    const livro = await ProtocolBookModel.get(dados.protocol_book_id);
    if (!livro) throw new Error("Livro de protocolo não encontrado.");
    if (livro.year < anoAtual()) {
      throw new Error(`Este livro é do ano ${livro.year}, já encerrado — não é possível emitir um novo protocolo nele.`);
    }
    if (!livro.is_active) {
      throw new Error("Este livro está fechado e não aceita novos protocolos.");
    }

    const db = await getDatabase();
    const [{ numero }] = await db.select<{ numero: number }[]>(
      "UPDATE protocol_books SET next_number = next_number + 1 WHERE id = $1 RETURNING next_number - 1 AS numero",
      [livro.id]
    );

    const id = newId();
    await db.execute(
      `INSERT INTO protocol_entries
         (id, protocol_book_id, number, year, direction, document_type, protocol_date, sender_name, recipient_name,
          subject, deadline, notes, response_protocol_id, member_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        livro.id,
        numero,
        livro.year,
        dados.direction,
        livro.protocol_type,
        dados.protocol_date,
        dados.sender_name ?? null,
        dados.recipient_name ?? null,
        dados.subject,
        dados.deadline ?? null,
        dados.notes ?? null,
        dados.response_protocol_id ?? null,
        dados.member_id ?? null,
      ]
    );

    const [criado] = await db.select<ProtocolEntry[]>("SELECT * FROM protocol_entries WHERE id = $1", [id]);
    return criado;
  }

  /** Muda a situação do protocolo (nunca exclui um registro lançado). */
  static async updateStatus(id: string, status: StatusProtocolo): Promise<void> {
    const db = await getDatabase();
    await db.execute("UPDATE protocol_entries SET status = $2 WHERE id = $1", [id, status]);
  }
}
