import type { MemberComPessoa } from "../models/Member.js";
import type { Person } from "../models/Person.js";
import type { MembershipMode } from "../models/Association.js";
import { formatarCpf, formatarData, formatarDataHora } from "./format.js";
import { ROTULO_SITUACAO_SOCIO } from "./situacaoSocio.js";

/** Um campo da ficha do sócio; `valor: null` = em branco (a tela mostra "—"). */
export interface CampoFicha {
  rotulo: string;
  valor: string | null;
}

export interface SecaoFicha {
  titulo: string;
  campos: CampoFicha[];
}

const GENERO_LABEL: Record<string, string> = { M: "Masculino", F: "Feminino" };

/**
 * Ficha do sócio: TODOS os campos de `people` + `members`, inclusive os
 * vazios, agrupados em seções. Fonte única da aba Dados
 * (`SocioDetalhes.vue`) e da ficha impressa (`ImprimirFichaSocio.vue`) —
 * campo novo entra aqui e aparece nas duas.
 */
export function montarFichaSocio(dados: {
  socio: MemberComPessoa;
  pessoa: Person | null;
  nomePlano: string | null;
  modoMensalidade: MembershipMode;
}): SecaoFicha[] {
  const { socio: s, pessoa: p, nomePlano, modoMensalidade } = dados;
  const data = (valor: string | null | undefined) => (valor ? formatarData(valor) : null);

  return [
    {
      titulo: "Dados pessoais",
      campos: [
        { rotulo: "Nome completo", valor: p?.full_name ?? s.full_name },
        { rotulo: "CPF", valor: s.cpf ? formatarCpf(s.cpf) : null },
        { rotulo: "RG", valor: p?.rg ?? null },
        { rotulo: "Data de nascimento", valor: data(p?.birth_date) },
        { rotulo: "Gênero", valor: p?.gender ? GENERO_LABEL[p.gender] : null },
        { rotulo: "Estado civil", valor: p?.marital_status ?? null },
        { rotulo: "Nacionalidade", valor: p?.nationality ?? null },
        { rotulo: "Profissão", valor: p?.profession ?? null },
        { rotulo: "Nome da mãe", valor: p?.mother_name ?? null },
        { rotulo: "Nome do pai", valor: p?.father_name ?? null },
        { rotulo: "Anotações da pessoa", valor: p?.notes ?? null },
      ],
    },
    {
      titulo: "Vínculo com a associação",
      campos: [
        { rotulo: "Matrícula", valor: s.registration_number },
        { rotulo: "Data de associação", valor: data(s.association_date) },
        { rotulo: "Situação", valor: ROTULO_SITUACAO_SOCIO[s.status] },
        { rotulo: "Data de saída", valor: data(s.exit_date) },
        { rotulo: "Motivo da saída", valor: s.exit_reason },
        {
          rotulo: "Plano de mensalidade",
          valor: modoMensalidade === "MULTIPLO" ? nomePlano : 'Valor único da associação (modo "Plano único")',
        },
        {
          rotulo: "Mensalidade legado",
          valor: s.dues_start_date ? `Considerada a partir de ${formatarData(s.dues_start_date)}` : null,
        },
        { rotulo: "Observações", valor: s.observations },
      ],
    },
    {
      titulo: "Registro",
      campos: [
        { rotulo: "Cadastrado em", valor: formatarDataHora(s.created_at) },
        { rotulo: "Última alteração", valor: formatarDataHora(s.updated_at) },
      ],
    },
  ];
}
