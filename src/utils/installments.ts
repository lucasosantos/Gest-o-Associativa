/**
 * Geração de parcelas iguais para contas a pagar/receber (Etapa 5). Cálculo
 * de mês feito à mão (sem `date-fns`) — decisão da Etapa 0 era só adicionar
 * uma lib de datas quando a aritmética justificasse; somar N meses a uma
 * data, com fallback pro fim do mês, ainda é simples o suficiente sem uma.
 */

/** Soma `meses` a uma data ISO (`"AAAA-MM-DD"`), ajustando para o último dia
 * do mês de destino quando o dia original não existir nele (ex.: 31/01 + 1
 * mês = 28 ou 29/02). */
export function somarMeses(dataIso: string, meses: number): string {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  const totalMeses = (mes - 1) + meses;
  const novoAno = ano + Math.floor(totalMeses / 12);
  const novoMes = (((totalMeses % 12) + 12) % 12) + 1;
  const ultimoDiaDoMes = new Date(Date.UTC(novoAno, novoMes, 0)).getUTCDate();
  const novoDia = Math.min(dia, ultimoDiaDoMes);
  return `${novoAno}-${String(novoMes).padStart(2, "0")}-${String(novoDia).padStart(2, "0")}`;
}

export interface ParcelaGerada {
  installment_number: number;
  due_date: string;
  original_amount: number;
}

/**
 * Divide `totalAmount` (centavos) em `quantidade` parcelas mensais iguais,
 * vencendo a primeira em `primeiroVencimento`. A última parcela absorve o
 * resto da divisão, para a soma bater exatamente com `totalAmount`.
 */
export function gerarParcelasIguais(
  totalAmount: number,
  quantidade: number,
  primeiroVencimento: string
): ParcelaGerada[] {
  if (quantidade < 1) throw new Error("A quantidade de parcelas deve ser pelo menos 1.");

  const valorBase = Math.floor(totalAmount / quantidade);
  const parcelas: ParcelaGerada[] = [];

  for (let i = 0; i < quantidade; i++) {
    const ehUltima = i === quantidade - 1;
    parcelas.push({
      installment_number: i + 1,
      due_date: somarMeses(primeiroVencimento, i),
      original_amount: ehUltima ? totalAmount - valorBase * (quantidade - 1) : valorBase,
    });
  }

  return parcelas;
}
