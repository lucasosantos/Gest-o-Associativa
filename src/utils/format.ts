/**
 * Conversões e formatações usadas pelos módulos de domínio.
 *
 * Convenções (ver `docs/plano-implementacao.md`):
 * - Valores monetários são guardados como `INTEGER` em centavos no banco,
 *   para não sofrer com imprecisão de ponto flutuante em somas de parcelas
 *   e baixas. Estas funções fazem a ponte entre centavos (banco/lógica) e
 *   reais (o que o usuário digita e vê na tela).
 * - Datas são guardadas como `TEXT` ISO (`"AAAA-MM-DD"`). A formatação para
 *   exibição em pt-BR usa `Intl`, sempre fixando `timeZone: "UTC"` — sem
 *   isso, `new Date("2026-09-01")` é interpretado como meia-noite UTC e
 *   pode exibir o dia anterior em fusos horários negativos.
 */

/** Converte um valor em centavos (como guardado no banco) para reais. */
export function centavosParaReais(centavos: number): number {
  return centavos / 100;
}

/** Converte um valor em reais (ex.: vindo de um `<input type="number">`) para centavos. */
export function reaisParaCentavos(reais: number): number {
  return Math.round(reais * 100);
}

const formatadorMoeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Formata um valor em centavos como moeda brasileira (ex.: 150000 → "R$ 1.500,00"). */
export function formatarMoeda(centavos: number): string {
  return formatadorMoeda.format(centavosParaReais(centavos));
}

const formatadorData = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/** Formata uma data ISO (`"AAAA-MM-DD"`) como `"DD/MM/AAAA"`. */
export function formatarData(dataIso: string): string {
  return formatadorData.format(new Date(`${dataIso}T00:00:00Z`));
}

const formatadorCompetencia = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Formata uma competência ISO (`"AAAA-MM-01"`) como `"setembro de 2026"`. */
export function formatarCompetencia(competenciaIso: string): string {
  return formatadorCompetencia.format(new Date(`${competenciaIso}T00:00:00Z`));
}

const MESES_POR_EXTENSO = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * Formata uma data ISO (`"AAAA-MM-DD"`) por extenso (ex.: "04 de maio de
 * 1986") — uso no cabeçalho padrão de impressão (`PrintHeader.vue`), pra
 * data de fundação da associação.
 */
export function formatarDataPorExtenso(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  return `${String(dia).padStart(2, "0")} de ${MESES_POR_EXTENSO[mes - 1]} de ${ano}`;
}

/** Data atual no formato ISO (`"AAAA-MM-DD"`), em UTC. */
export function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Soma `meses` a uma data ISO (`"AAAA-MM-DD"`). Se o dia não existir no mês
 * de destino, usa o último dia dele (31/01 + 1 mês → 28 ou 29/02).
 */
export function somarMeses(dataIso: string, meses: number): string {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  const indiceMes = mes - 1 + meses;
  const anoDestino = ano + Math.floor(indiceMes / 12);
  const mesDestino = ((indiceMes % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(anoDestino, mesDestino + 1, 0)).getUTCDate();
  const data = new Date(Date.UTC(anoDestino, mesDestino, Math.min(dia, ultimoDia)));
  return data.toISOString().slice(0, 10);
}

/** Ano corrente — usado nas regras de vigência do livro de protocolo (ver `ProtocolBookModel`). */
export function anoAtual(): number {
  return new Date().getFullYear();
}

/** Competência do mês atual, ISO `"AAAA-MM-01"` (uso em `Parcela`/`MembershipPayment`). */
export function competenciaAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Competência seguinte a uma dada (ISO `"AAAA-MM-01"`) — cuida da virada de ano sozinha. */
export function proximaCompetencia(competenceMonth: string): string {
  const [ano, mes] = competenceMonth.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes, 1)); // "mes" (1-based) já cai no índice 0-based do mês seguinte
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Ajusta o dia de vencimento (`Association.monthly_contribution_due_day`)
 * para um mês existir de verdade nele (ex.: dia 31 em fevereiro → 28/29).
 * Uso em `MembershipPayment` — vencimento da mensalidade é sempre calculado
 * na aplicação, nunca guardado por mês/sócio.
 */
export function calcularVencimento(competenceMonth: string, dueDay: number | null): string {
  const [ano, mes] = competenceMonth.split("-").map(Number);
  const ultimoDiaDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dia = Math.min(dueDay ?? 10, ultimoDiaDoMes);
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Remove tudo que não é dígito (uso em CPF, telefone, CEP). */
export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/**
 * Aplica a máscara de CPF (`000.000.000-00`) para exibição. Guarde o CPF
 * normalizado (só dígitos, via `apenasDigitos`) no banco — a máscara é só
 * de apresentação (ver `docs/dominio-associacoes.md`, seção 6).
 */
export function formatarCpf(cpf: string): string {
  const digitos = apenasDigitos(cpf);
  if (digitos.length !== 11) return cpf;
  return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

/** Formata um tamanho de arquivo em bytes (`document_versions.file_size`) de forma legível (ex.: 205824 → "201 KB"). */
export function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unidades = ["KB", "MB", "GB"];
  let valor = bytes / 1024;
  let indice = 0;
  while (valor >= 1024 && indice < unidades.length - 1) {
    valor /= 1024;
    indice++;
  }
  return `${valor.toFixed(valor < 10 ? 1 : 0)} ${unidades[indice]}`;
}

const formatadorDataHora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Formata um `created_at` do banco (`"AAAA-MM-DD HH:MM:SS"`, sempre UTC —
 * é o que `CURRENT_TIMESTAMP` grava) como `"DD/MM/AAAA HH:MM"` na hora
 * LOCAL do computador. Diferente de `formatarData`, aqui a conversão de
 * fuso é o comportamento desejado.
 */
export function formatarDataHora(timestampUtc: string): string {
  return formatadorDataHora.format(new Date(`${timestampUtc.replace(" ", "T")}Z`)).replace(",", "");
}

const formatadorDiaPorExtenso = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Formata uma data ISO (`"AAAA-MM-DD"`) como `"quinta-feira, 24 de setembro de 2026"`. */
export function formatarDiaPorExtenso(dataIso: string): string {
  return formatadorDiaPorExtenso.format(new Date(`${dataIso}T00:00:00Z`));
}

/**
 * Data atual no fuso LOCAL do computador (`"AAAA-MM-DD"`). Diferente de
 * `hojeIso` (UTC): usada onde a data precisa bater com o `date(...,
 * 'localtime')` do SQLite, como na tela Atividades.
 */
export function hojeLocalIso(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/** Só a hora local (`"HH:MM"`) de um `created_at` do banco (UTC) — ver `formatarDataHora`. */
export function formatarHora(timestampUtc: string): string {
  return formatarDataHora(timestampUtc).split(" ")[1] ?? "";
}
