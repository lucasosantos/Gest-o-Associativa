/**
 * Códigos legíveis que ligam mensalidade ↔ acordo ↔ lançamento de caixa
 * (migration `version: 25`). O prefixo é o número da associação
 * (`associations.numero`, "01", "02"...), pra um código impresso num recibo
 * nunca ser confundido com o de outra associação da mesma instalação.
 *
 * - Mensalidade: `01-0012-03-2026` — associação, matrícula, mês, ano.
 *   Calculado (não gravado): sócio + competência já identificam o mês.
 * - Acordo:      `01-0012-AC-0001` — associação, matrícula, nº do acordo.
 * - Lançamento:  `01-L-2026-000123` — associação, ano, nº sequencial no ano.
 */
import { currentAssociationNumero } from "../composables/useCurrentAssociation.js";

/** "01" — número da associação ativa com 2 dígitos. */
export function prefixoAssociacao(numero: number | null = currentAssociationNumero.value): string {
  return String(numero ?? 1).padStart(2, "0");
}

/** Matrícula com 4 dígitos quando é só número ("12" → "0012"); texto livre fica como está. */
export function matriculaNoCodigo(matricula: string): string {
  const limpa = matricula.trim();
  return /^\d+$/.test(limpa) ? limpa.padStart(4, "0") : limpa.replace(/\s+/g, "");
}

/** `01-0012-03-2026` a partir da matrícula e da competência (`AAAA-MM-01`). */
export function codigoMensalidade(matricula: string, competenceMonth: string): string {
  const [ano, mes] = competenceMonth.split("-");
  return `${prefixoAssociacao()}-${matriculaNoCodigo(matricula)}-${mes}-${ano}`;
}

/** `01-0012-AC-0001`; `null` se o acordo ainda não tem número. */
export function codigoAcordo(matricula: string, numero: number | null | undefined): string | null {
  if (!numero) return null;
  return `${prefixoAssociacao()}-${matriculaNoCodigo(matricula)}-AC-${String(numero).padStart(4, "0")}`;
}

/** `01-0012-PS-0001` — prestação de serviço que pagou mensalidades (migration `version: 26`). */
export function codigoServico(matricula: string, numero: number | null | undefined): string | null {
  if (!numero) return null;
  return `${prefixoAssociacao()}-${matriculaNoCodigo(matricula)}-PS-${String(numero).padStart(4, "0")}`;
}

/** `01-L-2026-000123`; `null` se o lançamento não tem número (não deveria acontecer depois da migration 25). */
export function codigoLancamento(ano: number | null | undefined, numero: number | null | undefined): string | null {
  if (!ano || !numero) return null;
  return `${prefixoAssociacao()}-L-${ano}-${String(numero).padStart(6, "0")}`;
}
