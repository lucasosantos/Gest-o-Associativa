<script setup lang="ts">
// Inventário de bens patrimoniais. Cada linha abre a ficha do bem
// (`PatrimonioDetalhes.vue`), onde ficam a linha do tempo e as ações
// (movimentar, manutenção, empréstimo, baixa...).
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  AssetModel,
  ROTULO_CONSERVACAO,
  ROTULO_STATUS_BEM,
  type Asset,
  type FiltroBens,
} from "../models/Asset.js";
import { formatarData, formatarMoeda } from "../utils/format.js";
import { openModal } from "../composables/useModal.js";
import { setSidebarTools } from "../composables/useSidebar.js";
import { useAssociationScopedData } from "../composables/useAssociationScopedData.js";
import AssetForm from "../modals/AssetForm.vue";

const router = useRouter();

const bens = ref<Asset[]>([]);
const loading = ref(true);
const termoBusca = ref("");
const filtroStatus = ref<NonNullable<FiltroBens["status"]> | "">("ATIVOS");

/** Totais sempre sobre os bens não baixados, independente do filtro da tabela. */
const ativos = ref<Asset[]>([]);
const resumo = computed(() => ({
  quantidade: ativos.value.length,
  valor: ativos.value.reduce((soma, bem) => soma + (bem.acquisition_value ?? 0), 0),
  manutencao: ativos.value.filter((bem) => bem.status === "EM_MANUTENCAO").length,
  emprestados: ativos.value.filter((bem) => bem.status === "EMPRESTADO").length,
}));

async function carregar() {
  loading.value = true;
  try {
    const [lista, todosAtivos] = await Promise.all([
      AssetModel.list({ texto: termoBusca.value, status: filtroStatus.value || null }),
      AssetModel.list({ status: "ATIVOS" }),
    ]);
    bens.value = lista;
    ativos.value = todosAtivos;
  } finally {
    loading.value = false;
  }
}

function abrirNovoBem() {
  openModal({
    title: "Novo bem",
    component: AssetForm,
    props: {
      onSaved: (bem: Asset | null) => {
        if (bem) router.push({ name: "patrimonio-detalhes", params: { id: bem.id } });
      },
    },
  });
}

function abrirFicha(bem: Asset) {
  router.push({ name: "patrimonio-detalhes", params: { id: bem.id } });
}

useAssociationScopedData(carregar);

onMounted(() => {
  setSidebarTools([
    { group: "Patrimônio", items: [{ id: "novo-bem", label: "Novo bem", icon: "plus", onClick: abrirNovoBem }] },
    {
      group: "Relatórios",
      items: [
        {
          id: "balanco",
          label: "Balanço de patrimônio",
          icon: "file",
          onClick: () => router.push({ name: "balanco-patrimonio-imprimir" }),
        },
      ],
    },
  ]);
});
</script>

<template>
  <section class="content">
    <div class="page-header">
      <div>
        <h2>Patrimônio</h2>
        <p>Bens da associação — aquisição, localização, manutenção, empréstimos e baixas.</p>
      </div>
    </div>

    <div class="cards">
      <div class="card">
        <span class="card-label">Bens ativos</span>
        <strong>{{ resumo.quantidade }}</strong>
      </div>
      <div class="card">
        <span class="card-label">Valor de aquisição</span>
        <strong>{{ formatarMoeda(resumo.valor) }}</strong>
      </div>
      <div class="card">
        <span class="card-label">Em manutenção</span>
        <strong>{{ resumo.manutencao }}</strong>
      </div>
      <div class="card">
        <span class="card-label">Emprestados</span>
        <strong>{{ resumo.emprestados }}</strong>
      </div>
    </div>

    <div class="search-row">
      <input
        v-model="termoBusca"
        type="text"
        placeholder="Buscar por nome, nº, categoria, local, responsável ou nº de série..."
        @keyup.enter="carregar"
      />
      <select v-model="filtroStatus" @change="carregar">
        <option value="ATIVOS">Não baixados</option>
        <option value="">Todos</option>
        <option v-for="(rotulo, valor) in ROTULO_STATUS_BEM" :key="valor" :value="valor">{{ rotulo }}</option>
      </select>
      <button type="button" class="btn-secondary" @click="carregar">Buscar</button>
    </div>

    <div v-if="loading" class="state-msg">Carregando...</div>
    <p v-else-if="bens.length === 0" class="state-msg">
      {{ termoBusca || filtroStatus !== "ATIVOS" ? "Nenhum bem encontrado." : "Nenhum bem cadastrado ainda — use \"Novo bem\" na barra lateral." }}
    </p>

    <table v-else class="data-table">
      <thead>
        <tr>
          <th>Nº</th>
          <th>Bem</th>
          <th>Local / responsável</th>
          <th>Conservação</th>
          <th>Situação</th>
          <th>Aquisição</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="bem in bens" :key="bem.id" class="clickable" @click="abrirFicha(bem)">
          <td class="numero">{{ bem.asset_number }}</td>
          <td>
            <strong>{{ bem.name }}</strong>
            <span v-if="bem.category" class="muted"> · {{ bem.category }}</span>
          </td>
          <td>
            {{ bem.location || "—" }}
            <span v-if="bem.responsible" class="muted"> · {{ bem.responsible }}</span>
          </td>
          <td>{{ ROTULO_CONSERVACAO[bem.condition] }}</td>
          <td>
            <span class="badge" :class="`status-${bem.status}`">{{ ROTULO_STATUS_BEM[bem.status] }}</span>
          </td>
          <td>
            {{ formatarData(bem.acquisition_date) }}
            <span v-if="bem.acquisition_value" class="muted"> · {{ formatarMoeda(bem.acquisition_value) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0.75rem;
  max-width: 900px;
  margin-top: 1rem;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.8rem 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.card-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.card strong {
  font-size: 1.15rem;
  color: var(--text);
}

.search-row {
  display: flex;
  gap: 0.5rem;
  margin: 1.25rem 0;
  max-width: 900px;
}

.search-row input,
.search-row select {
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.search-row input {
  flex: 1;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.data-table {
  width: 100%;
  max-width: 1100px;
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
  padding: 0.65rem 0.9rem;
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--border);
}

.data-table td {
  padding: 0.6rem 0.9rem;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  vertical-align: top;
}

.data-table tr:last-child td {
  border-bottom: none;
}

.clickable {
  cursor: pointer;
}

.clickable:hover td {
  background: var(--surface-hover);
}

.numero {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.muted {
  color: var(--text-muted);
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

.status-EM_MANUTENCAO,
.status-EMPRESTADO {
  background: transparent;
  border: 1px solid var(--accent);
}

.status-BAIXADO {
  background: var(--surface-hover);
  color: var(--text-muted);
}
</style>
