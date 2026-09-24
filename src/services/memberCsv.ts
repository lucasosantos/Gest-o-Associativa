// Importação/exportação de sócios em CSV (tela Sócios). O mesmo layout de
// colunas serve pros dois lados: o arquivo exportado já é um modelo válido
// de importação, então dá pra exportar, editar no Excel/Google Planilhas e
// importar de volta noutra associação.
import { MemberModel, type SocioExportacao, type StatusSocio } from "../models/Member.js";
import { PersonModel, type GeneroPessoa } from "../models/Person.js";
import { PersonContactModel } from "../models/PersonContact.js";
import { AddressModel } from "../models/Address.js";
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
  /** Obrigatória em toda linha (a matrícula tem regra própria — ver `descricao`). */
  obrigatoria: boolean;
  descricao: string;
  exemplo: string;
}

/**
 * Ordem OFICIAL das colunas — a importação lê por posição e confere o
 * cabeçalho contra esta lista. Não reordene: arquivos já exportados
 * deixariam de ser importáveis. Coluna nova só entra no FIM.
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
  { chave: "cep", obrigatoria: false, descricao: "Endereço (opcional). Se preencher qualquer campo do endereço, logradouro, cidade e UF viram obrigatórios.", exemplo: "01001-000" },
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
}

/**
 * Lê o texto do CSV, confere o cabeçalho contra `COLUNAS_CSV` e valida
 * linha a linha — inclusive matrícula/CPF repetidos no próprio arquivo ou
 * já cadastrados. Não grava nada: a tela mostra o resultado e só então
 * chama `importarSocios` com as linhas válidas.
 */
export async function analisarCsv(texto: string): Promise<AnaliseCsv> {
  const linhas = lerCsv(texto.replace(/^﻿/, ""));
  if (linhas.length === 0) return { validas: [], erros: [{ linha: 1, mensagem: "O arquivo está vazio." }] };

  const cabecalho = linhas[0].map(normalizar);
  for (let i = 0; i < Math.min(cabecalho.length, COLUNAS_CSV.length); i++) {
    if (cabecalho[i] !== COLUNAS_CSV[i].chave && cabecalho[i] !== "") {
      return {
        validas: [],
        erros: [
          {
            linha: 1,
            mensagem: `Cabeçalho fora do modelo: a coluna ${i + 1} devia ser "${COLUNAS_CSV[i].chave}", mas é "${linhas[0][i]}". Baixe o modelo e mantenha a ordem das colunas.`,
          },
        ],
      };
    }
  }
  if (cabecalho.length < 3) {
    return { validas: [], erros: [{ linha: 1, mensagem: "O arquivo precisa ter pelo menos as colunas matricula, nome_completo e data_associacao." }] };
  }

  const matriculaAutomatica = currentAutoRegistrationNumber.value;
  const modoMultiplo = currentMembershipMode.value === "MULTIPLO";
  const planos = modoMultiplo ? await MembershipPlanModel.list() : [];
  const planoPorNome = new Map(planos.map((plano) => [normalizar(plano.name), plano.id]));

  const validas: SocioImportacao[] = [];
  const erros: ErroLinha[] = [];
  const matriculasNoArquivo = new Set<string>();
  const cpfsNoArquivo = new Set<string>();

  for (let indice = 1; indice < linhas.length; indice++) {
    const numeroLinha = indice + 1;
    const bruto = linhas[indice];
    const campo = (chave: ChaveColuna): string => {
      const posicao = COLUNAS_CSV.findIndex((coluna) => coluna.chave === chave);
      return (bruto[posicao] ?? "").trim();
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

    let endereco: SocioImportacao["endereco"] = null;
    const camposEndereco: ChaveColuna[] = ["cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf"];
    if (camposEndereco.some((chave) => campo(chave))) {
      const faltando = (["logradouro", "cidade", "uf"] as ChaveColuna[]).filter((chave) => !campo(chave));
      if (faltando.length > 0) problemas.push(`endereço incompleto: falta ${faltando.join(", ")}`);
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

  return { validas, erros };
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
      importados++;
    } catch (error) {
      erros.push({ linha: socio.linha, mensagem: `${socio.nome}: ${error instanceof Error ? error.message : error}` });
    }
    aoProgredir?.(indice + 1);
  }

  return { importados, erros };
}
