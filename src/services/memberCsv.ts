// Importação/exportação de sócios em CSV (tela Sócios). O mesmo layout de
// colunas serve pros dois lados: o arquivo exportado já é um modelo válido
// de importação, então dá pra exportar, editar no Excel/Google Planilhas e
// importar de volta noutra associação.
import { MemberModel, type SocioExportacao, type StatusSocio } from "../models/Member.js";
import { PersonModel, type GeneroPessoa } from "../models/Person.js";
import { PersonContactModel } from "../models/PersonContact.js";
import { AddressModel } from "../models/Address.js";
import { ActivityLogModel, comAtividade } from "../models/ActivityLog.js";
import { MembershipPlanModel } from "../models/MembershipPlan.js";
import { currentAutoRegistrationNumber, currentMembershipMode } from "../composables/useCurrentAssociation.js";
import { apenasDigitos, formatarCpf, formatarData } from "../utils/format.js";

type ChaveColuna =
  | "matricula"
  | "nome_completo"
  | "data_associacao"
  | "situacao"
  | "cpf"
  | "rg"
  | "data_nascimento"
  | "genero"
  | "estado_civil"
  | "nacionalidade"
  | "profissao"
  | "nome_mae"
  | "nome_pai"
  | "telefone"
  | "email"
  | "cep"
  | "logradouro"
  | "numero"
  | "complemento"
  | "bairro"
  | "cidade"
  | "uf"
  | "plano"
  | "mensalidade_desde"
  | "observacoes";

export interface ColunaCsv {
  chave: ChaveColuna;
  /** Essencial: sem a coluna (ou com a célula em branco) o sócio não é importado. A matrícula tem regra própria — ver `descricao`. */
  obrigatoria: boolean;
  descricao: string;
  exemplo: string;
}

/**
 * Colunas conhecidas, na ordem usada pela exportação e pelo modelo. A
 * importação lê cada coluna PELO NOME do cabeçalho (ver `mapearCabecalho`),
 * não pela posição: a planilha pode ter as colunas em qualquer ordem, só
 * algumas delas, ou colunas extras (ignoradas). Coluna ausente = campo não
 * preenchido.
 */
export const COLUNAS_CSV: readonly ColunaCsv[] = [
  { chave: "matricula", obrigatoria: false, descricao: "Obrigatória se a numeração automática estiver desligada; com ela ligada, é ignorada e o sistema gera o número.", exemplo: "0001" },
  { chave: "nome_completo", obrigatoria: true, descricao: "Nome completo do sócio.", exemplo: "Maria da Silva" },
  { chave: "data_associacao", obrigatoria: true, descricao: "DD/MM/AAAA.", exemplo: "15/03/2020" },
  { chave: "situacao", obrigatoria: false, descricao: "Ativo, Pendente, Inativo, Suspenso, Desligado ou Falecido. Em branco = Ativo.", exemplo: "Ativo" },
  { chave: "cpf", obrigatoria: false, descricao: "Com ou sem pontuação. Não pode repetir.", exemplo: "123.456.789-09" },
  { chave: "rg", obrigatoria: false, descricao: "Texto livre.", exemplo: "12.345.678-9" },
  { chave: "data_nascimento", obrigatoria: false, descricao: "DD/MM/AAAA.", exemplo: "02/07/1985" },
  { chave: "genero", obrigatoria: false, descricao: "M ou F.", exemplo: "F" },
  { chave: "estado_civil", obrigatoria: false, descricao: "Texto livre.", exemplo: "Casada" },
  { chave: "nacionalidade", obrigatoria: false, descricao: "Em branco = Brasileira.", exemplo: "Brasileira" },
  { chave: "profissao", obrigatoria: false, descricao: "Texto livre.", exemplo: "Agricultora" },
  { chave: "nome_mae", obrigatoria: false, descricao: "Filiação 1.", exemplo: "Ana da Silva" },
  { chave: "nome_pai", obrigatoria: false, descricao: "Filiação 2.", exemplo: "José da Silva" },
  { chave: "telefone", obrigatoria: false, descricao: "Com DDD. 11 dígitos vira celular.", exemplo: "(11) 98765-4321" },
  { chave: "email", obrigatoria: false, descricao: "Endereço de e-mail.", exemplo: "maria@exemplo.com" },
  { chave: "cep", obrigatoria: false, descricao: "Endereço (opcional). Só é importado se tiver logradouro, cidade e UF; faltando algum, o sócio entra sem endereço.", exemplo: "01001-000" },
  { chave: "logradouro", obrigatoria: false, descricao: "Rua, avenida, sítio...", exemplo: "Rua das Flores" },
  { chave: "numero", obrigatoria: false, descricao: "Número do endereço.", exemplo: "120" },
  { chave: "complemento", obrigatoria: false, descricao: "Complemento.", exemplo: "Casa 2" },
  { chave: "bairro", obrigatoria: false, descricao: "Bairro ou comunidade.", exemplo: "Centro" },
  { chave: "cidade", obrigatoria: false, descricao: "Cidade.", exemplo: "São Paulo" },
  { chave: "uf", obrigatoria: false, descricao: "Sigla do estado, 2 letras.", exemplo: "SP" },
  { chave: "plano", obrigatoria: false, descricao: "Nome do plano de mensalidade, igual ao cadastrado na aba Planos. Só usado no modo \"Múltiplos planos\".", exemplo: "" },
  { chave: "mensalidade_desde", obrigatoria: false, descricao: "Mensalidade legado: DD/MM/AAAA a partir de quando contar mensalidades. Em branco = desde a data de associação.", exemplo: "" },
  { chave: "observacoes", obrigatoria: false, descricao: "Texto livre.", exemplo: "" },
];

const SEPARADOR_EXPORTACAO = ";";

const STATUS_POR_TEXTO: Record<string, StatusSocio> = {
  pendente: "PENDENTE",
  ativo: "ATIVO",
  ativa: "ATIVO",
  inativo: "INATIVO",
  inativa: "INATIVO",
  suspenso: "SUSPENSO",
  suspensa: "SUSPENSO",
  desligado: "DESLIGADO",
  desligada: "DESLIGADO",
  falecido: "FALECIDO",
  falecida: "FALECIDO",
};

const STATUS_LABEL: Record<StatusSocio, string> = {
  PENDENTE: "Pendente",
  ATIVO: "Ativo",
  INATIVO: "Inativo",
  SUSPENSO: "Suspenso",
  DESLIGADO: "Desligado",
  FALECIDO: "Falecido",
};

/** Minúsculas, sem acento, espaços viram `_` — compara cabeçalhos e textos digitados à mão. */
function normalizar(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

// ---------------------------------------------------------------- exportação

function escaparCampo(valor: string): string {
  if (/[";,\r\n]/.test(valor) || valor !== valor.trim()) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

function montarCsv(linhas: string[][]): string {
  // BOM + `;` + CRLF: é o formato que o Excel em português abre direto, com
  // acentos certos e cada campo na sua coluna. O Google Planilhas também
  // detecta o `;` sozinho na importação.
  const corpo = linhas.map((linha) => linha.map(escaparCampo).join(SEPARADOR_EXPORTACAO)).join("\r\n");
  return `﻿${corpo}\r\n`;
}

function dataOuVazio(dataIso: string | null): string {
  return dataIso ? formatarData(dataIso) : "";
}

function valoresDoSocio(socio: SocioExportacao): Record<ChaveColuna, string> {
  return {
    matricula: socio.registration_number,
    nome_completo: socio.full_name,
    data_associacao: dataOuVazio(socio.association_date),
    situacao: STATUS_LABEL[socio.status] ?? socio.status,
    cpf: socio.cpf ? formatarCpf(socio.cpf) : "",
    rg: socio.rg ?? "",
    data_nascimento: dataOuVazio(socio.birth_date),
    genero: socio.gender ?? "",
    estado_civil: socio.marital_status ?? "",
    nacionalidade: socio.nationality ?? "",
    profissao: socio.profession ?? "",
    nome_mae: socio.mother_name ?? "",
    nome_pai: socio.father_name ?? "",
    telefone: socio.phone ?? "",
    email: socio.email ?? "",
    cep: socio.zip_code ?? "",
    logradouro: socio.street ?? "",
    numero: socio.number ?? "",
    complemento: socio.complement ?? "",
    bairro: socio.district ?? "",
    cidade: socio.city ?? "",
    uf: socio.state ?? "",
    plano: socio.plan_name ?? "",
    mensalidade_desde: dataOuVazio(socio.dues_start_date),
    observacoes: socio.observations ?? "",
  };
}

/** CSV com todos os sócios da associação conectada, no layout de `COLUNAS_CSV`. */
export async function gerarCsvSocios(): Promise<{ conteudo: string; total: number }> {
  const socios = await MemberModel.listParaExportacao();
  const cabecalho = COLUNAS_CSV.map((coluna) => coluna.chave);
  const linhas = socios.map((socio) => {
    const valores = valoresDoSocio(socio);
    return COLUNAS_CSV.map((coluna) => valores[coluna.chave]);
  });
  return { conteudo: montarCsv([cabecalho, ...linhas]), total: socios.length };
}

/** Modelo vazio pra preencher: cabeçalho + uma linha de exemplo (apague-a antes de importar). */
export function gerarModeloCsv(): string {
  return montarCsv([COLUNAS_CSV.map((coluna) => coluna.chave), COLUNAS_CSV.map((coluna) => coluna.exemplo)]);
}

// ---------------------------------------------------------------- importação

/** Descobre o separador pela 1ª linha: `;` (Excel pt-BR), `,` (Google Planilhas/Excel en) ou tab. */
function detectarSeparador(texto: string): string {
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] ?? "";
  const candidatos = [";", ",", "\t"];
  let melhor = SEPARADOR_EXPORTACAO;
  let maior = 0;
  for (const candidato of candidatos) {
    const total = primeiraLinha.split(candidato).length - 1;
    if (total > maior) {
      maior = total;
      melhor = candidato;
    }
  }
  return melhor;
}

/** Parser de CSV (RFC 4180): aspas duplas, `""` escapado e quebra de linha dentro de aspas. */
function lerCsv(texto: string): string[][] {
  const separador = detectarSeparador(texto);
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let entreAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreAspas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === separador) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else {
      campo += c;
    }
  }
  if (campo !== "" || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }

  // Linhas totalmente vazias (inclusive `;;;;` que o Excel deixa no fim) são ignoradas.
  return linhas.filter((l) => l.some((valor) => valor.trim() !== ""));
}

/** Aceita `DD/MM/AAAA` (também com `-` ou `.`) e `AAAA-MM-DD`. Devolve ISO ou `null` se inválida. */
function lerData(valor: string): string | null {
  let dia: number, mes: number, ano: number;
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(valor);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(valor);
  if (br) [dia, mes, ano] = [Number(br[1]), Number(br[2]), Number(br[3])];
  else if (iso) [ano, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;

  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
  return data.toISOString().slice(0, 10);
}

function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const digito = ((soma * 10) % 11) % 10;
    if (digito !== Number(cpf[tamanho])) return false;
  }
  return true;
}

/**
 * Outros nomes de cabeçalho aceitos (já normalizados — ver `normalizar`),
 * pra planilhas montadas à mão sem seguir o modelo à risca.
 */
const APELIDOS_COLUNA: Record<string, ChaveColuna> = {
  n_matricula: "matricula",
  numero_matricula: "matricula",
  numero_de_matricula: "matricula",
  nome: "nome_completo",
  nome_do_socio: "nome_completo",
  socio: "nome_completo",
  data_de_associacao: "data_associacao",
  associado_em: "data_associacao",
  data_de_entrada: "data_associacao",
  status: "situacao",
  data_de_nascimento: "data_nascimento",
  nascimento: "data_nascimento",
  sexo: "genero",
  profissao_ocupacao: "profissao",
  mae: "nome_mae",
  nome_da_mae: "nome_mae",
  pai: "nome_pai",
  nome_do_pai: "nome_pai",
  celular: "telefone",
  fone: "telefone",
  "e-mail": "email",
  endereco: "logradouro",
  rua: "logradouro",
  complemento_endereco: "complemento",
  municipio: "cidade",
  estado: "uf",
  observacao: "observacoes",
  obs: "observacoes",
};

/**
 * Posição de cada coluna conhecida no arquivo, pelo nome do cabeçalho
 * (nome oficial de `COLUNAS_CSV` ou um apelido). Cabeçalho que não bate
 * com nada vai pra `ignoradas`; se a mesma coluna aparecer duas vezes, vale
 * a primeira.
 */
function mapearCabecalho(cabecalho: string[]): { posicoes: Map<ChaveColuna, number>; ignoradas: string[] } {
  const conhecidas = new Set<string>(COLUNAS_CSV.map((coluna) => coluna.chave));
  const posicoes = new Map<ChaveColuna, number>();
  const ignoradas: string[] = [];
  cabecalho.forEach((titulo, indice) => {
    const nome = normalizar(titulo);
    if (!nome) return;
    const chave = conhecidas.has(nome) ? (nome as ChaveColuna) : APELIDOS_COLUNA[nome];
    if (chave && !posicoes.has(chave)) posicoes.set(chave, indice);
    else ignoradas.push(titulo.trim());
  });
  return { posicoes, ignoradas };
}

/** Linha já validada e convertida, pronta pra `importarSocios`. */
export interface SocioImportacao {
  /** Número da linha no arquivo (1 = cabeçalho), pra mensagens de erro. */
  linha: number;
  nome: string;
  registration_number: string | undefined;
  association_date: string;
  status: StatusSocio;
  cpf: string | null;
  rg: string | null;
  birth_date: string | null;
  gender: GeneroPessoa | null;
  marital_status: string | null;
  nationality: string | null;
  profession: string | null;
  mother_name: string | null;
  father_name: string | null;
  phone: string | null;
  email: string | null;
  endereco: {
    zip_code: string | null;
    street: string;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string;
    state: string;
  } | null;
  membership_plan_id: string | null;
  dues_start_date: string | null;
  observations: string | null;
}

export interface ErroLinha {
  linha: number;
  mensagem: string;
}

export interface AnaliseCsv {
  validas: SocioImportacao[];
  erros: ErroLinha[];
  /** Linhas que serão importadas, mas com algum dado deixado de fora (ex.: endereço incompleto). */
  avisos: ErroLinha[];
  /** Colunas conhecidas que não existem no arquivo — ficam em branco em todos os sócios. */
  colunasAusentes: ChaveColuna[];
  /** Cabeçalhos do arquivo que não correspondem a nenhuma coluna conhecida. */
  colunasIgnoradas: string[];
}

/**
 * Lê o texto do CSV, identifica as colunas pelo cabeçalho e valida linha a
 * linha — inclusive matrícula/CPF repetidos no próprio arquivo ou já
 * cadastrados. Coluna ausente ou célula em branco não é erro: o campo só
 * não é preenchido. Erro de verdade só quando falta o que o cadastro não
 * dispensa (nome, data de associação e, com a numeração automática
 * desligada, matrícula) ou quando um valor preenchido é inválido. Não grava
 * nada: a tela mostra o resultado e só então chama `importarSocios` com as
 * linhas válidas.
 */
export async function analisarCsv(texto: string): Promise<AnaliseCsv> {
  const linhas = lerCsv(texto.replace(/^\uFEFF/, ""));
  const vazia = { validas: [], avisos: [], colunasAusentes: [], colunasIgnoradas: [] };
  if (linhas.length === 0) return { ...vazia, erros: [{ linha: 1, mensagem: "O arquivo está vazio." }] };

  const { posicoes, ignoradas } = mapearCabecalho(linhas[0]);
  const matriculaAutomatica = currentAutoRegistrationNumber.value;

  const essenciais: ChaveColuna[] = ["nome_completo", "data_associacao"];
  if (!matriculaAutomatica) essenciais.unshift("matricula");
  const faltandoEssenciais = essenciais.filter((chave) => !posicoes.has(chave));
  if (faltandoEssenciais.length > 0) {
    const dicaMatricula = faltandoEssenciais.includes("matricula")
      ? " (ou ligue a numeração automática de matrícula em Instituição)"
      : "";
    return {
      ...vazia,
      colunasIgnoradas: ignoradas,
      erros: [
        {
          linha: 1,
          mensagem: `O cabeçalho (1ª linha) precisa ter a(s) coluna(s) ${faltandoEssenciais.join(", ")}${dicaMatricula} — sem elas não dá pra cadastrar nenhum sócio.`,
        },
      ],
    };
  }
  const colunasAusentes = COLUNAS_CSV.map((coluna) => coluna.chave).filter(
    (chave) => !posicoes.has(chave) && !(chave === "matricula" && matriculaAutomatica)
  );

  const modoMultiplo = currentMembershipMode.value === "MULTIPLO";
  const planos = modoMultiplo ? await MembershipPlanModel.list() : [];
  const planoPorNome = new Map(planos.map((plano) => [normalizar(plano.name), plano.id]));

  const validas: SocioImportacao[] = [];
  const erros: ErroLinha[] = [];
  const avisos: ErroLinha[] = [];
  const matriculasNoArquivo = new Set<string>();
  const cpfsNoArquivo = new Set<string>();

  for (let indice = 1; indice < linhas.length; indice++) {
    const numeroLinha = indice + 1;
    const bruto = linhas[indice];
    // Coluna ausente no arquivo ou célula em branco = "" (campo não preenchido).
    const campo = (chave: ChaveColuna): string => {
      const posicao = posicoes.get(chave);
      return posicao === undefined ? "" : (bruto[posicao] ?? "").trim();
    };
    const opcional = (chave: ChaveColuna): string | null => campo(chave) || null;
    const problemas: string[] = [];

    const nome = campo("nome_completo");
    if (!nome) problemas.push("nome_completo em branco");

    let registrationNumber: string | undefined;
    if (!matriculaAutomatica) {
      registrationNumber = campo("matricula");
      if (!registrationNumber) problemas.push("matricula em branco (a numeração automática está desligada)");
      else if (matriculasNoArquivo.has(registrationNumber)) problemas.push(`matrícula ${registrationNumber} repetida no arquivo`);
      else if (await MemberModel.existeMatricula(registrationNumber)) problemas.push(`matrícula ${registrationNumber} já cadastrada`);
      else matriculasNoArquivo.add(registrationNumber);
    }

    const associationDate = lerData(campo("data_associacao"));
    if (!campo("data_associacao")) problemas.push("data_associacao em branco");
    else if (!associationDate) problemas.push(`data_associacao inválida ("${campo("data_associacao")}") — use DD/MM/AAAA`);

    let status: StatusSocio = "ATIVO";
    if (campo("situacao")) {
      const lido = STATUS_POR_TEXTO[normalizar(campo("situacao"))];
      if (lido) status = lido;
      else problemas.push(`situacao desconhecida ("${campo("situacao")}")`);
    }

    let cpf: string | null = null;
    if (campo("cpf")) {
      // Excel apaga o zero à esquerda quando a coluna não está como Texto.
      const digitos = apenasDigitos(campo("cpf")).padStart(11, "0");
      if (!cpfValido(digitos)) problemas.push(`CPF inválido ("${campo("cpf")}")`);
      else if (cpfsNoArquivo.has(digitos)) problemas.push(`CPF ${formatarCpf(digitos)} repetido no arquivo`);
      else if (await PersonModel.findByCpf(digitos)) problemas.push(`CPF ${formatarCpf(digitos)} já cadastrado`);
      else {
        cpf = digitos;
        cpfsNoArquivo.add(digitos);
      }
    }

    let birthDate: string | null = null;
    if (campo("data_nascimento")) {
      birthDate = lerData(campo("data_nascimento"));
      if (!birthDate) problemas.push(`data_nascimento inválida ("${campo("data_nascimento")}") — use DD/MM/AAAA`);
    }

    let gender: GeneroPessoa | null = null;
    if (campo("genero")) {
      const letra = normalizar(campo("genero"))[0]?.toUpperCase();
      if (letra === "M" || letra === "F") gender = letra;
      else problemas.push(`genero inválido ("${campo("genero")}") — use M ou F`);
    }

    const email = opcional("email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problemas.push(`email inválido ("${email}")`);

    // Endereço só é gravado com logradouro, cidade e UF (o cadastro exige os
    // três); faltando algum, o sócio entra sem endereço — aviso, não erro.
    let endereco: SocioImportacao["endereco"] = null;
    const avisosLinha: string[] = [];
    const camposEndereco: ChaveColuna[] = ["cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf"];
    if (camposEndereco.some((chave) => campo(chave))) {
      const faltando = (["logradouro", "cidade", "uf"] as ChaveColuna[]).filter((chave) => !campo(chave));
      if (faltando.length > 0) avisosLinha.push(`endereço não importado (falta ${faltando.join(", ")})`);
      else
        endereco = {
          zip_code: opcional("cep"),
          street: campo("logradouro"),
          number: opcional("numero"),
          complement: opcional("complemento"),
          district: opcional("bairro"),
          city: campo("cidade"),
          state: campo("uf").toUpperCase(),
        };
    }

    let membershipPlanId: string | null = null;
    if (modoMultiplo && campo("plano")) {
      membershipPlanId = planoPorNome.get(normalizar(campo("plano"))) ?? null;
      if (!membershipPlanId) problemas.push(`plano "${campo("plano")}" não cadastrado na aba Planos`);
    }

    let duesStartDate: string | null = null;
    if (campo("mensalidade_desde")) {
      duesStartDate = lerData(campo("mensalidade_desde"));
      if (!duesStartDate) problemas.push(`mensalidade_desde inválida ("${campo("mensalidade_desde")}") — use DD/MM/AAAA`);
      else if (associationDate && duesStartDate < associationDate) problemas.push("mensalidade_desde anterior à data_associacao");
    }

    if (problemas.length > 0 || !associationDate) {
      erros.push({ linha: numeroLinha, mensagem: `${nome || "(sem nome)"}: ${problemas.join("; ")}` });
      continue;
    }

    if (avisosLinha.length > 0) {
      avisos.push({ linha: numeroLinha, mensagem: `${nome}: ${avisosLinha.join("; ")}` });
    }

    validas.push({
      linha: numeroLinha,
      nome,
      registration_number: registrationNumber,
      association_date: associationDate,
      status,
      cpf,
      rg: opcional("rg"),
      birth_date: birthDate,
      gender,
      marital_status: opcional("estado_civil"),
      nationality: opcional("nacionalidade"),
      profession: opcional("profissao"),
      mother_name: opcional("nome_mae"),
      father_name: opcional("nome_pai"),
      phone: opcional("telefone"),
      email,
      endereco,
      membership_plan_id: membershipPlanId,
      dues_start_date: duesStartDate,
      observations: opcional("observacoes"),
    });
  }

  return { validas, erros, avisos, colunasAusentes, colunasIgnoradas: ignoradas };
}

/**
 * Grava as linhas já validadas por `analisarCsv`, uma a uma: sócio (via
 * `MemberModel.create`, que cuida da numeração automática), telefone,
 * e-mail, endereço e, se a situação não for "Pendente" (padrão do banco),
 * a mudança de situação — registrada no histórico com a data de associação.
 * Uma linha que falhar não interrompe as demais.
 */
export async function importarSocios(
  socios: SocioImportacao[],
  aoProgredir?: (feitos: number) => void
): Promise<{ importados: number; erros: ErroLinha[] }> {
  let importados = 0;
  const erros: ErroLinha[] = [];

  for (const [indice, socio] of socios.entries()) {
    try {
      // Uma atividade por linha — contatos, endereço e situação gravados
      // junto não viram linhas próprias no histórico (ver `comAtividade`).
      await comAtividade(
        async () => {
          const criado = await MemberModel.create({
            full_name: socio.nome,
            registration_number: socio.registration_number,
            association_date: socio.association_date,
            cpf: socio.cpf,
            rg: socio.rg,
            birth_date: socio.birth_date,
            gender: socio.gender,
            marital_status: socio.marital_status,
            nationality: socio.nationality ?? undefined,
            profession: socio.profession,
            mother_name: socio.mother_name,
            father_name: socio.father_name,
            membership_plan_id: socio.membership_plan_id,
            dues_start_date: socio.dues_start_date,
            observations: socio.observations,
          });

          if (socio.phone) {
            await PersonContactModel.create({
              person_id: criado.person_id,
              contact_type: apenasDigitos(socio.phone).length === 11 ? "CELULAR" : "TELEFONE",
              contact_value: socio.phone,
              is_primary: 1,
            });
          }
          if (socio.email) {
            await PersonContactModel.create({
              person_id: criado.person_id,
              contact_type: "EMAIL",
              contact_value: socio.email,
              is_primary: socio.phone ? 0 : 1,
            });
          }
          if (socio.endereco) {
            await AddressModel.create({ person_id: criado.person_id, ...socio.endereco, is_primary: 1 });
          }
          if (socio.status !== criado.status) {
            await MemberModel.changeStatus(criado.id, socio.status, {
              effectiveDate: socio.association_date,
              reason: "Importado de planilha CSV",
            });
          }
          return criado;
        },
        (criado) => ({
          module: "SOCIOS",
          description: `Novo sócio importado de planilha — ${socio.nome} (matrícula ${criado.registration_number})`,
          entity_type: "MEMBER",
          entity_id: criado.id,
        })
      );
      importados++;
    } catch (error) {
      erros.push({ linha: socio.linha, mensagem: `${socio.nome}: ${error instanceof Error ? error.message : error}` });
    }
    aoProgredir?.(indice + 1);
  }

  await ActivityLogModel.registrar({
    module: "SOCIOS",
    description: `Importação de sócios por planilha — ${importados} importado(s)${
      erros.length ? `, ${erros.length} com erro` : ""
    }`,
  });

  return { importados, erros };
}
