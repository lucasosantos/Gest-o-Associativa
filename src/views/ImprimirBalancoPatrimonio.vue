<script setup lang="ts">
// Balanço de patrimônio — lista de todos os bens em posse da associação,
// agrupados por categoria com subtotal de quantidade e valor de aquisição.
// Aberta pelo botão da sidebar de Patrimonio.vue; mesmo padrão das outras
// telas de impressão (ImprimirAptosAVotar.vue): abre já mandando pra
// impressão do sistema. Bens baixados ficam numa seção à parte, opcional
// (caixa na barra de ações, que não sai no papel).
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  AssetModel,
  ROTULO_CONSERVACAO,
  ROTULO_ORIGEM,
  ROTULO_STATUS_BEM,
  ROTULO_TIPO_BAIXA,
  type Asset,
} from "../models/Asset.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { ActivityLogModel } from "../models/ActivityLog.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { formatarData, formatarMoeda, hojeIso } from "../utils/format.js";
import PrintHeader from "../components/PrintHeader.vue";
import { usePaginaImpressao } from "../composables/usePaginaImpressao.js";

const router = useRouter();

const associacao = ref<Association | null>(null);
const endereco = ref<Address | null>(null);
const bens = ref<Asset[]>([]);
const incluirBaixados = ref(false);
const loading = ref(true);

const dataEmissao = formatarData(hojeIso());
const SEM_CATEGORIA = "Sem categoria";

const emPosse = computed(() => bens.value.filter((bem) => bem.status !== "BAIXADO"));
const baixados = computed(() =>
  bens.value
    .filter((bem) => bem.status === "BAIXADO")
    .sort((a, b) => (b.disposal_date ?? "").localeCompare(a.disposal_date ?? ""))
);

/** Bens em posse agrupados por categoria (ordem alfabética, "Sem categoria" por último). */
const grupos = computed(() => {
  const mapa = new Map<string, Asset[]>();
  for (const bem of emPosse.value) {
    const categoria = bem.category?.trim() || SEM_CATEGORIA;
    mapa.set(categoria, [...(mapa.get(categoria) ?? []), bem]);
  }
  return [...mapa.entries()]
    .sort(([a], [b]) => (a === SEM_CATEGORIA ? 1 : b === SEM_CATEGORIA ? -1 : a.localeCompare(b)))
    .map(([categoria, itens]) => ({ categoria, itens, total: somarValor(itens) }));
});

const totalEmPosse = computed(() => somarValor(emPosse.value));
const semValor = computed(() => emPosse.value.filter((bem) => !bem.acquisition_value).length);

function somarValor(itens: Asset[]): number {
  return itens.reduce((soma, bem) => soma + (bem.acquisition_value ?? 0), 0);
}

// Aplica o papel padrão de Configurações → Impressão (`@page`) e só então imprime.
const { imprimir } = usePaginaImpressao("PADRAO");

onMounted(async () => {
  try {
    const associationId = getCurrentAssociationId();
    const [dadosAssociacao, dadosEndereco, todos] = await Promise.all([
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
      AssetModel.list(),
    ]);
    associacao.value = dadosAssociacao;
    endereco.value = dadosEndereco;
    bens.value = todos;
  } finally {
    loading.value = false;
  }

  await ActivityLogModel.registrar({
    module: "PATRIMONIO",
    description: `Balanço de patrimônio gerado — ${emPosse.value.length} bem(ns) em posse, ${formatarMoeda(totalEmPosse.value)}`,
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
        <label class="checkbox">
          <input v-model="incluirBaixados" type="checkbox" />
          Incluir bens baixados ({{ baixados.length }})
        </label>
        <button type="button" class="btn-secondary" @click="router.back()">Voltar</button>
        <button type="button" class="btn-primary" @click="imprimir">Imprimir</button>
      </div>

      <header class="cabecalho">
        <PrintHeader v-if="associacao" :association="associacao" :address="endereco" />
        <h1>Balanço de patrimônio</h1>
        <p class="subtitulo">
          {{ emPosse.length }} bem(ns) em posse da associação · valor de aquisição total {{ formatarMoeda(totalEmPosse) }}
        </p>
        <p class="emissao">Emitido em {{ dataEmissao }}</p>
      </header>

      <p v-if="emPosse.length === 0" class="state-msg">Nenhum bem em posse da associação.</p>

      <table v-else class="tabela-impressao">
        <thead>
          <tr>
            <th class="col-numero">Nº</th>
            <th>Bem</th>
            <th>Aquisição</th>
            <th>Local / responsável</th>
            <th>Conservação</th>
            <th>Situação</th>
            <th class="col-valor">Valor</th>
          </tr>
        </thead>
        <tbody v-for="grupo in grupos" :key="grupo.categoria">
          <tr class="linha-grupo">
            <td colspan="7">{{ grupo.categoria }}</td>
          </tr>
          <tr v-for="bem in grupo.itens" :key="bem.id">
            <td class="col-numero nao-quebrar">{{ bem.asset_number }}</td>
            <td>
              {{ bem.name }}
              <span v-if="bem.serial_number" class="detalhe">{{ bem.serial_number }}</span>
            </td>
            <td>
              {{ formatarData(bem.acquisition_date) }}
              <span class="detalhe">{{ ROTULO_ORIGEM[bem.acquisition_origin] }}</span>
            </td>
            <td>
              {{ bem.location || "—" }}
              <span v-if="bem.responsible" class="detalhe">{{ bem.responsible }}</span>
            </td>
            <td class="nao-quebrar">{{ ROTULO_CONSERVACAO[bem.condition] }}</td>
            <td class="nao-quebrar">{{ ROTULO_STATUS_BEM[bem.status] }}</td>
            <td class="col-valor">{{ bem.acquisition_value ? formatarMoeda(bem.acquisition_value) : "—" }}</td>
          </tr>
          <tr class="linha-subtotal">
            <td colspan="6">Subtotal {{ grupo.categoria }} — {{ grupo.itens.length }} bem(ns)</td>
            <td class="col-valor">{{ formatarMoeda(grupo.total) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="linha-total">
            <td colspan="6">Total geral — {{ emPosse.length }} bem(ns)</td>
            <td class="col-valor">{{ formatarMoeda(totalEmPosse) }}</td>
          </tr>
        </tfoot>
      </table>

      <p v-if="semValor > 0" class="nota">
        {{ semValor }} bem(ns) sem valor de aquisição informado (ex.: doações sem avaliação) — não entram no total.
      </p>

      <template v-if="incluirBaixados && baixados.length > 0">
        <h2 class="secao">Bens baixados</h2>
        <table class="tabela-impressao">
          <thead>
            <tr>
              <th class="col-numero">Nº</th>
              <th>Bem</th>
              <th>Aquisição</th>
              <th>Baixa</th>
              <th>Motivo</th>
              <th class="col-valor">Valor aquisição</th>
              <th class="col-valor">Valor venda</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="bem in baixados" :key="bem.id">
              <td class="col-numero nao-quebrar">{{ bem.asset_number }}</td>
              <td>{{ bem.name }}</td>
              <td class="nao-quebrar">{{ formatarData(bem.acquisition_date) }}</td>
              <td>
                {{ bem.disposal_date ? formatarData(bem.disposal_date) : "—" }}
                <span v-if="bem.disposal_type" class="detalhe">
                  {{ ROTULO_TIPO_BAIXA[bem.disposal_type] }}<template v-if="bem.disposal_recipient">
                    — {{ bem.disposal_recipient }}</template>
                </span>
              </td>
              <td>{{ bem.disposal_reason }}</td>
              <td class="col-valor">{{ bem.acquisition_value ? formatarMoeda(bem.acquisition_value) : "—" }}</td>
              <td class="col-valor">{{ bem.disposal_value ? formatarMoeda(bem.disposal_value) : "—" }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <div class="assinaturas">
        <div>Responsável pelo patrimônio</div>
        <div>Presidente</div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.imprimir-lista {
  max-width: 100%;
}

.action-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1.5rem;
}

.checkbox {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-right: auto;
  font-size: 0.85rem;
  color: var(--text);
  cursor: pointer;
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

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.cabecalho {
  text-align: center;
  margin-bottom: 1.5rem;
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

.tabela-impressao {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.tabela-impressao th,
.tabela-impressao td {
  border: 1px solid var(--border);
  padding: 0.4rem 0.6rem;
  text-align: left;
  vertical-align: top;
  color: var(--text);
}

.tabela-impressao th {
  background: var(--surface-hover);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.detalhe {
  display: block;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.linha-grupo td {
  font-weight: 700;
  background: var(--surface);
}

.linha-subtotal td {
  font-style: italic;
  color: var(--text-muted);
}

.linha-total td {
  font-weight: 700;
  border-top: 2px solid var(--text);
}

.col-numero {
  width: 3.5rem;
  text-align: center;
}

.col-valor {
  text-align: right !important;
  white-space: nowrap;
}

.nota {
  margin: 0.6rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.secao {
  margin: 2rem 0 0.75rem;
  font-size: 1rem;
  color: var(--text);
}

.assinaturas {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3rem;
  margin-top: 4rem;
  font-size: 0.8rem;
  text-align: center;
  color: var(--text);
}

.assinaturas div {
  border-top: 1px solid var(--text);
  padding-top: 0.35rem;
}

@media print {
  .no-print {
    display: none !important;
  }

  .cabecalho,
  .linha-total td {
    border-color: #000;
  }

  .tabela-impressao th,
  .tabela-impressao td,
  .detalhe,
  .nota,
  .assinaturas {
    border-color: #000;
    color: #000;
  }

  .tabela-impressao th,
  .linha-grupo td {
    background: none;
  }

  .tabela-impressao tr,
  .assinaturas {
    break-inside: avoid;
  }
}
</style>
