import type { GeneroPessoa } from "../models/Person.js";

/**
 * Flexiona um par de formas ("Sr."/"Sra.", "brasileiro"/"brasileira",
 * "associado"/"associada") de acordo com o gênero cadastrado da pessoa —
 * uso nos textos gerados (ex.: declaração de associado, `ImprimirDeclaracao.vue`).
 * Sem gênero cadastrado (`null`, cadastros antigos), usa a forma masculina
 * como padrão neutro.
 */
export function flexionar(gender: GeneroPessoa | null, masculino: string, feminino: string): string {
  return gender === "F" ? feminino : masculino;
}
