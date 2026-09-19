import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { apenasDigitos } from "../utils/format.js";

/** Espelha a tabela `people` (migration `version: 2`). Pessoa física — pode
 * ter, ou não, um vínculo de sócio (`members`) com a associação. */
/** `"M"` (masculino) ou `"F"` (feminino) — uso na flexão gramatical de textos gerados (ver `src/utils/genero.ts`), migration `version: 15`. */
export type GeneroPessoa = "M" | "F";

export interface Person {
  id: string;
  full_name: string;
  birth_date: string | null;
  nationality: string;
  marital_status: string | null;
  cpf: string | null;
  rg: string | null;
  profession: string | null;
  mother_name: string | null;
  father_name: string | null;
  gender: GeneroPessoa | null;
  notes: string | null;
  /** Foto de identificação como data URL (`data:<mime>;base64,...`), migration `version: 17`. `null` quando a pessoa não tem foto cadastrada. */
  photo: string | null;
  created_at: string;
  updated_at: string;
}

export interface NovaPessoa {
  full_name: string;
  birth_date?: string | null;
  nationality?: string;
  marital_status?: string | null;
  cpf?: string | null;
  rg?: string | null;
  profession?: string | null;
  mother_name?: string | null;
  father_name?: string | null;
  gender?: GeneroPessoa | null;
  notes?: string | null;
  photo?: string | null;
}

export type AtualizacaoPessoa = Partial<NovaPessoa>;

/**
 * CPF é guardado normalizado (só dígitos) — a máscara de exibição fica por
 * conta de `formatarCpf` na UI (ver `docs/dominio-associacoes.md`, seção 6).
 */
function normalizarCpf(cpf: string | null | undefined): string | null {
  if (!cpf) return null;
  const digitos = apenasDigitos(cpf);
  return digitos || null;
}

/** Acesso à tabela `people`. */
export class PersonModel {
  static async get(id: string): Promise<Person | null> {
    const db = await getDatabase();
    const rows = await db.select<Person[]>("SELECT * FROM people WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  /** Localiza uma pessoa já cadastrada pelo CPF (normalizado antes da busca). */
  static async findByCpf(cpf: string): Promise<Person | null> {
    const normalizado = normalizarCpf(cpf);
    if (!normalizado) return null;

    const db = await getDatabase();
    const rows = await db.select<Person[]>("SELECT * FROM people WHERE cpf = $1", [normalizado]);
    return rows[0] ?? null;
  }

  static async create(dados: NovaPessoa): Promise<Person> {
    const db = await getDatabase();
    const id = newId();
    await db.execute(
      `INSERT INTO people (id, full_name, birth_date, nationality, marital_status, cpf, rg, profession, mother_name, father_name, gender, notes, photo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        dados.full_name,
        dados.birth_date ?? null,
        dados.nationality ?? "Brasileira",
        dados.marital_status ?? null,
        normalizarCpf(dados.cpf),
        dados.rg ?? null,
        dados.profession ?? null,
        dados.mother_name ?? null,
        dados.father_name ?? null,
        dados.gender ?? null,
        dados.notes ?? null,
        dados.photo ?? null,
      ]
    );

    const [criada] = await db.select<Person[]>("SELECT * FROM people WHERE id = $1", [id]);
    return criada;
  }

  static async update(id: string, dados: AtualizacaoPessoa): Promise<void> {
    const normalizado: AtualizacaoPessoa = { ...dados };
    if ("cpf" in normalizado) normalizado.cpf = normalizarCpf(normalizado.cpf);

    const campos = Object.entries(normalizado).filter(([, valor]) => valor !== undefined);
    if (campos.length === 0) return;

    const db = await getDatabase();
    const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
    const valores = campos.map(([, valor]) => valor as string | null);

    await db.execute(`UPDATE people SET ${sets} WHERE id = $1`, [id, ...valores]);
  }
}
