<script setup lang="ts">
// Lista de sócios pra impressão — matrícula, nome, data de associação, CPF,
// RG e nascimento, com cada sócio em DUAS linhas (1ª: matrícula e nome;
// 2ª: os demais dados com rótulo), pra nada ficar espremido. Filtro de
// situação e ordem vêm da query (`?situacao=ATIVO&ordem=NOME`), escolhidos
// em `ListaSociosPrintForm.vue` (sidebar de Socios.vue); dá pra trocar aqui
// mesmo na barra de ações, que não sai no papel. Mesmo padrão das outras
// telas de impressão: abre já mandando pra impressão do sistema.
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  MemberModel,
  type OrdemListaSocios,
  type SocioListaImpressao,
  type StatusSocio,
} from "../models/Member.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { ActivityLogModel } from "../models/ActivityLog.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { usePaginaImpressao } from "../composables/usePaginaImpressao.js";
import { formatarCpf, formatarData, hojeIso } from "../utils/format.js";
import { ROTULO_SITUACAO_SOCIO, SITUACOES_SOCIO } from "../utils/situacaoSocio.js";
import PrintHeader from "../components/PrintHeader.vue";

const route = useRoute();
const router = useRouter();

function lerSituacao(valor: unknown): StatusSocio | "" {
  return typeof valor === "string" && (SITUACOES_SOCIO as string[]).includes(valor) ? (valor as StatusSocio) : "";
}

const situacao = ref<StatusSocio | "">(lerSituacao(route.query.situacao));
const ordem = ref<OrdemListaSocios>(route.query.ordem === "MATRICULA" ? "MATRICULA" : "NOME");

const associacao = ref<Association | null>(null);
const endereco = ref<Address | null>(null);
const socios = ref<SocioListaImpressao[]>([]);
const loading = ref(true);

const dataEmissao = formatarData(hojeIso());
const titulo = computed(() =>
  situacao.value ? `Lista de sócios — ${ROTULO_SITUACAO_SOCIO[situacao.value].toLowerCase()}s` : "Lista de sócios"
);

// Aplica o papel padrão de Configurações → Impressão (`@page`) e só então imprime.
const { imprimir } = usePaginaImpressao("PADRAO");

async function carregarSocios() {
  socios.value = await MemberModel.listarParaImpressao(situacao.value || null, ordem.value);
}

/** Troca de filtro/ordem na barra de ações: recarrega e mantém a URL em sincronia (Voltar/F5). */
async function aplicarFiltro() {
  router.replace({ query: { situacao: situacao.value || undefined, ordem: ordem.value } });
  await carregarSocios();
}

onMounted(async () => {
  try {
    const associationId = getCurrentAssociationId();
    const [dadosAssociacao, dadosEndereco] = await Promise.all([
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
      carregarSocios(),
    ]);
    associacao.value = dadosAssociacao;
    endereco.value = dadosEndereco;
  } finally {
    loading.value = false;
  }

  await ActivityLogModel.registrar({
    module: "SOCIOS",
    description: `Lista de sócios gerada para impressão — ${
      situacao.value ? `situação ${ROTULO_SITUACAO_SOCIO[situacao.value]}` : "todas as situações"
    }, ${socios.value.length} sócio(s)`,
  });

  await nextTick();
  imprimir();
});
</script>

<template>
  <section class="content imprimir-lista">
    <div v-if="loading" class="state-msg">Carregando...</div>

    <template v-else>
      <div class="no-print action-bar">
        <label>
          Situação
          <select v-model="situacao" @change="aplicarFiltro">
            <option value="">Todas</option>
            <option v-for="codigo in SITUACOES_SOCIO" :key="codigo" :value="codigo">
              {{ ROTULO_SITUACAO_SOCIO[codigo] }}
            </option>
          </select>
        </label>
        <label>
          Ordem
          <select v-model="ordem" @change="aplicarFiltro">
            <option value="NOME">Nome</option>
            <option value="MATRICULA">Matrícula</option>
          </select>
        </label>
        <span class="espaco"></span>
        <button type="button" class="btn-secondary" @click="router.back()">Voltar</button>
        <button type="button" class="btn-primary" :disabled="socios.length === 0" @click="imprimir">Imprimir</button>
      </div>

      <header class="cabecalho">
        <PrintHeader v-if="associacao" :association="associacao" :address="endereco" />
        <h1>{{ titulo }}</h1>
        <p class="subtitulo">
          {{ socios.length }} sócio(s) · ordem por {{ ordem === "NOME" ? "nome" : "matrícula" }}
        </p>
        <p class="emissao">Emitido em {{ dataEmissao }}</p>
      </header>

      <p v-if="socios.length === 0" class="state-msg">Nenhum sócio nesta situação.</p>

      <table v-else class="tabela-socios">
        <colgroup>
          <col class="col-1" />
          <col class="col-2" />
          <col class="col-3" />
          <col class="col-4" />
        </colgroup>
        <!-- Um <tbody> por sócio: as duas linhas andam juntas (não se separam entre folhas). -->
        <tbody v-for="socio in socios" :key="socio.id" class="socio">
          <tr class="linha-nome">
            <td class="nao-quebrar">
              <span class="rotulo">Matrícula</span>
              <strong>{{ socio.registration_number }}</strong>
            </td>
            <td colspan="3">
              <span class="rotulo">Nome</span>
              <strong>{{ socio.full_name }}</strong>
              <span v-if="!situacao" class="situacao">{{ ROTULO_SITUACAO_SOCIO[socio.status] }}</span>
            </td>
          </tr>
          <tr class="linha-dados">
            <td class="nao-quebrar">
              <span class="rotulo">Associado em</span>
              {{ formatarData(socio.association_date) }}
            </td>
            <td class="nao-quebrar">
              <span class="rotulo">CPF</span>
              {{ socio.cpf ? formatarCpf(socio.cpf) : "—" }}
            </td>
            <td>
              <span class="rotulo">RG</span>
              {{ socio.rg || "—" }}
            </td>
            <td class="nao-quebrar">
              <span class="rotulo">Nascimento</span>
              {{ socio.birth_date ? formatarData(socio.birth_date) : "—" }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.imprimir-lista {
  max-width: 100%;
}

.action-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1.5rem;
}

.action-bar label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.action-bar select {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.espaco {
  flex: 1;
}

.btn-primary,
.btn-secondary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
}

.btn-primary {
  border: none;
  background: var(--accent);
  color: #fff;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.cabecalho {
  text-align: center;
  margin-bottom: 1.25rem;
  border-bottom: 2px solid var(--text);
  padding-bottom: 1rem;
}

.cabecalho h1 {
  margin: 0 0 0.3rem;
  font-size: 1.3rem;
  color: var(--text);
}

.subtitulo {
  margin: 0 0 0.2rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.emissao {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.tabela-socios {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.col-1 {
  width: 22%;
}

.col-2 {
  width: 26%;
}

.col-3 {
  width: 28%;
}

.col-4 {
  width: 24%;
}

.tabela-socios td {
  padding: 0.3rem 0.6rem;
  vertical-align: top;
  color: var(--text);
}

/* Separação entre sócios: linha forte em cima do bloco, fraca entre as duas linhas dele. */
.socio {
  border-top: 1px solid var(--text-muted);
}

.socio:last-of-type {
  border-bottom: 1px solid var(--text-muted);
}

.socio:nth-of-type(even) td {
  background: var(--surface-hover);
}

.linha-nome td {
  padding-top: 0.5rem;
}

.linha-dados td {
  padding-bottom: 0.5rem;
}

.rotulo {
  display: block;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.situacao {
  margin-left: 0.5rem;
  padding: 0 0.4rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 0.72rem;
  color: var(--text-muted);
}

@media print {
  .no-print {
    display: none !important;
  }

  .tabela-socios {
    font-size: 0.8rem;
  }

  .socio {
    break-inside: avoid;
  }

  /* Faixa cinza alternada também no papel, pra seguir o sócio com o olho. */
  .socio:nth-of-type(even) td {
    background: #f0f0f0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
</style>
