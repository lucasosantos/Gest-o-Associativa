<script setup lang="ts">
// Histórico de atividades, um dia por página: todas as atividades do dia
// escolhido em ordem cronológica. "Dia anterior"/"Próximo dia" pulam
// direto pro dia mais próximo que tenha atividade (respeitando os
// filtros), sem passar por dias vazios. Só leitura — o registro é gravado
// pelos models (`comAtividade`) e a tabela é imutável no banco (migration
// `version: 24`). "Imprimir" usa a própria página: barra de navegação e
// filtros somem no papel, entra o cabeçalho padrão da associação.
import { computed, onMounted, ref } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import {
  ActivityLogModel,
  ROTULO_MODULO_ATIVIDADE,
  type ActivityLog,
  type FiltroAtividades,
  type ModuloAtividade,
} from "../models/ActivityLog.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { setSidebarTools } from "../composables/useSidebar.js";
import { useAssociationScopedData } from "../composables/useAssociationScopedData.js";
import { formatarData, formatarDiaPorExtenso, formatarHora, hojeLocalIso } from "../utils/format.js";
import PrintHeader from "../components/PrintHeader.vue";

const router = useRouter();

const dia = ref(hojeLocalIso());
const atividades = ref<ActivityLog[]>([]);
const diaAnterior = ref<string | null>(null);
const proximoDia = ref<string | null>(null);
const loading = ref(true);

const filtroModulo = ref<ModuloAtividade | "">("");
const texto = ref("");

const associacao = ref<Association | null>(null);
const endereco = ref<Address | null>(null);

const filtro = computed<FiltroAtividades>(() => ({ module: filtroModulo.value || null, texto: texto.value }));
const ehHoje = computed(() => dia.value === hojeLocalIso());
const descricaoFiltro = computed(() => {
  const partes: string[] = [];
  if (filtroModulo.value) partes.push(`módulo ${ROTULO_MODULO_ATIVIDADE[filtroModulo.value]}`);
  if (texto.value.trim()) partes.push(`contendo "${texto.value.trim()}"`);
  return partes.join(", ");
});

/** Carrega o dia atual (`dia`) e descobre os vizinhos com atividade pra habilitar a navegação. */
async function carregarDia() {
  if (!dia.value) dia.value = hojeLocalIso(); // campo de data apagado
  loading.value = true;
  try {
    const [lista, anterior, proximo] = await Promise.all([
      ActivityLogModel.listarDoDia(dia.value, filtro.value),
      ActivityLogModel.diaVizinho(dia.value, "anterior", filtro.value),
      ActivityLogModel.diaVizinho(dia.value, "proximo", filtro.value),
    ]);
    atividades.value = lista;
    diaAnterior.value = anterior;
    proximoDia.value = proximo;
  } finally {
    loading.value = false;
  }
}

/**
 * Abertura da tela (e troca de associação): começa em hoje; se hoje não
 * tiver nada, vai pro dia mais recente com atividade.
 */
async function carregarInicial() {
  const [dadosAssociacao, dadosEndereco] = await Promise.all([
    AssociationModel.get(getCurrentAssociationId()),
    AddressModel.primaryForAssociation(getCurrentAssociationId()),
  ]);
  associacao.value = dadosAssociacao;
  endereco.value = dadosEndereco;

  dia.value = hojeLocalIso();
  await carregarDia();
  if (atividades.value.length === 0 && diaAnterior.value) {
    dia.value = diaAnterior.value;
    await carregarDia();
  }
}

function irPara(novoDia: string | null) {
  if (!novoDia) return;
  dia.value = novoDia;
  carregarDia();
}

function irParaHoje() {
  irPara(hojeLocalIso());
}

function limparFiltros() {
  filtroModulo.value = "";
  texto.value = "";
  carregarDia();
}

function imprimir() {
  window.print();
}

/** Ficha do registro ligado à atividade, quando existe uma tela pra ele. */
function destino(atividade: ActivityLog): RouteLocationRaw | null {
  if (!atividade.entity_id) return null;
  switch (atividade.entity_type) {
    case "MEMBER":
      return { name: "socio-detalhes", params: { id: atividade.entity_id } };
    case "DOCUMENT":
      return { name: "documento-detalhes", params: { id: atividade.entity_id } };
    case "ASSET":
      return { name: "patrimonio-detalhes", params: { id: atividade.entity_id } };
    default:
      return null;
  }
}

useAssociationScopedData(carregarInicial);

onMounted(() => {
  setSidebarTools([
    { group: "Atividades", items: [{ id: "imprimir", label: "Imprimir dia", icon: "file", onClick: imprimir }] },
  ]);
});
</script>

<template>
  <section class="content atividades">
    <div class="page-header no-print">
      <div>
        <h2>Atividades</h2>
        <p>Tudo o que foi feito no sistema, dia a dia. Os registros não podem ser alterados nem apagados.</p>
      </div>
    </div>

    <!-- Cabeçalho que só aparece no papel -->
    <header class="cabecalho-impressao">
      <PrintHeader v-if="associacao" :association="associacao" :address="endereco" />
      <h1>Atividades de {{ formatarData(dia) }}</h1>
      <p v-if="descricaoFiltro" class="subtitulo">Filtro: {{ descricaoFiltro }}</p>
      <p class="subtitulo">{{ atividades.length }} atividade(s) · emitido em {{ formatarData(hojeLocalIso()) }}</p>
    </header>

    <div class="navegacao no-print">
      <button type="button" class="btn-secondary" :disabled="!diaAnterior" @click="irPara(diaAnterior)">
        ‹ Dia anterior
      </button>
      <input v-model="dia" type="date" class="seletor-dia" @change="carregarDia" />
      <button type="button" class="btn-secondary" :disabled="!proximoDia" @click="irPara(proximoDia)">
        Próximo dia ›
      </button>
      <button v-if="!ehHoje" type="button" class="link-btn" @click="irParaHoje">Hoje</button>
      <button type="button" class="btn-primary imprimir" :disabled="atividades.length === 0" @click="imprimir">
        Imprimir
      </button>
    </div>

    <div class="filtros no-print">
      <select v-model="filtroModulo" @change="carregarDia">
        <option value="">Todos os módulos</option>
        <option v-for="(rotulo, valor) in ROTULO_MODULO_ATIVIDADE" :key="valor" :value="valor">{{ rotulo }}</option>
      </select>
      <input v-model="texto" class="busca" type="text" placeholder="Buscar na descrição..." @keyup.enter="carregarDia" />
      <button type="button" class="btn-secondary" @click="carregarDia">Buscar</button>
      <button v-if="filtroModulo || texto" type="button" class="link-btn" @click="limparFiltros">Limpar</button>
    </div>

    <h3 class="titulo-dia no-print">
      {{ formatarDiaPorExtenso(dia) }}
      <span>· {{ atividades.length }} atividade(s)</span>
    </h3>

    <div v-if="loading" class="state-msg">Carregando...</div>
    <p v-else-if="atividades.length === 0" class="state-msg">
      Nenhuma atividade neste dia{{ descricaoFiltro ? " com este filtro" : "" }}.
    </p>

    <table v-else class="data-table">
      <thead>
        <tr>
          <th class="hora">Hora</th>
          <th class="modulo">Módulo</th>
          <th>Descrição</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="atividade in atividades" :key="atividade.id">
          <td class="hora">{{ formatarHora(atividade.created_at) }}</td>
          <td class="modulo">
            <span class="badge">{{ ROTULO_MODULO_ATIVIDADE[atividade.module] }}</span>
          </td>
          <td>
            <button
              v-if="destino(atividade)"
              type="button"
              class="descricao-link"
              @click="router.push(destino(atividade)!)"
            >
              {{ atividade.description }}
            </button>
            <span v-else>{{ atividade.description }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.cabecalho-impressao {
  display: none;
}

.navegacao {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 1000px;
  margin-top: 1rem;
}

.seletor-dia,
.filtros input,
.filtros select {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.imprimir {
  margin-left: auto;
}

.filtros {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  max-width: 1000px;
  margin: 0.75rem 0 1.25rem;
}

.filtros .busca {
  flex: 1;
  min-width: 200px;
}

.titulo-dia {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  color: var(--text);
}

.titulo-dia::first-letter {
  text-transform: uppercase;
}

.titulo-dia span {
  font-weight: 400;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.btn-primary,
.btn-secondary {
  padding: 0.45rem 0.9rem;
  border-radius: 6px;
  font-size: 0.82rem;
  font-family: inherit;
  cursor: pointer;
}

.btn-primary {
  border: none;
  background: var(--accent);
  color: #fff;
}

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.link-btn {
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 0.82rem;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

.link-btn:hover {
  color: var(--accent);
}

.data-table {
  width: 100%;
  max-width: 1000px;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  font-size: 0.85rem;
}

.data-table th {
  text-align: left;
  padding: 0.6rem 0.9rem;
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--border);
}

.data-table td {
  padding: 0.55rem 0.9rem;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  vertical-align: top;
}

.data-table tr:last-child td {
  border-bottom: none;
}

.hora {
  width: 60px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.modulo {
  width: 120px;
}

.badge {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--accent-soft);
  color: var(--accent);
  white-space: nowrap;
}

.descricao-link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.descricao-link:hover {
  color: var(--accent);
  text-decoration: underline;
}

@media print {
  .no-print {
    display: none !important;
  }

  .cabecalho-impressao {
    display: block;
    text-align: center;
    margin-bottom: 1.25rem;
    padding-bottom: 0.8rem;
    border-bottom: 2px solid #000;
  }

  .cabecalho-impressao h1 {
    margin: 0 0 0.3rem;
    font-size: 1.2rem;
    color: #000;
  }

  .subtitulo {
    margin: 0;
    font-size: 0.8rem;
    color: #000;
  }

  .data-table {
    max-width: 100%;
    border-collapse: collapse;
    border: none;
    border-radius: 0;
    background: none;
    font-size: 0.8rem;
  }

  .data-table th,
  .data-table td,
  .hora {
    border: 1px solid #000;
    color: #000;
  }

  .badge {
    padding: 0;
    background: none;
    color: #000;
    font-weight: 400;
  }

  .descricao-link {
    color: #000;
  }

  .data-table tr {
    break-inside: avoid;
  }
}
</style>
