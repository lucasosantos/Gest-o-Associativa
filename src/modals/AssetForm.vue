<script setup lang="ts">
// Cadastro/edição de bem patrimonial. Sem `bem` na prop, cadastra (e abre a
// linha do tempo com a aquisição); com `bem`, corrige os dados de cadastro.
// Local, responsável e conservação só aparecem no cadastro: depois disso
// mudam por evento na ficha do bem (Movimentar, Conservação...), pra
// ficarem registrados no histórico.
import { computed, onMounted, ref } from "vue";
import {
  AssetModel,
  ROTULO_CONSERVACAO,
  ROTULO_ORIGEM,
  type Asset,
  type EstadoConservacao,
  type LancamentoCaixaBem,
  type OrigemAquisicao,
} from "../models/Asset.js";
import { centavosParaReais, hojeIso, reaisParaCentavos } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import CashEntryOption from "../components/CashEntryOption.vue";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ bem?: Asset; onSaved?: (bem: Asset | null) => void }>();

const assetNumber = ref(props.bem?.asset_number ?? "");
const name = ref(props.bem?.name ?? "");
const category = ref(props.bem?.category ?? "");
const description = ref(props.bem?.description ?? "");
const serialNumber = ref(props.bem?.serial_number ?? "");
const acquisitionDate = ref(props.bem?.acquisition_date ?? hojeIso());
const acquisitionOrigin = ref<OrigemAquisicao>(props.bem?.acquisition_origin ?? "COMPRA");
const acquisitionSource = ref(props.bem?.acquisition_source ?? "");
const acquisitionValue = ref(props.bem?.acquisition_value != null ? centavosParaReais(props.bem.acquisition_value) : 0);
const acquisitionDocument = ref(props.bem?.acquisition_document ?? "");
const location = ref("");
const responsible = ref("");
const condition = ref<EstadoConservacao>("NOVO");
const observations = ref(props.bem?.observations ?? "");
const lancamento = ref<LancamentoCaixaBem | null>(null);

const categorias = ref<string[]>([]);
const saving = ref(false);
const erro = ref("");

const editando = computed(() => Boolean(props.bem));
const rotuloFonte = computed(
  () =>
    ({
      COMPRA: "Fornecedor / loja",
      DOACAO: "Doador",
      CESSAO: "Cedente (quem emprestou/cedeu)",
      PRODUCAO_PROPRIA: "Produzido por",
      OUTRO: "Origem",
    })[acquisitionOrigin.value]
);
const podeLancarCompra = computed(() => !editando.value && acquisitionOrigin.value === "COMPRA" && acquisitionValue.value > 0);

onMounted(async () => {
  categorias.value = await AssetModel.categorias();
  if (!editando.value) assetNumber.value = await AssetModel.proximoNumero();
});

async function handleSubmit() {
  if (!assetNumber.value.trim() || !name.value.trim() || !acquisitionDate.value) {
    erro.value = "Preencha número de patrimônio, nome e data de aquisição.";
    return;
  }
  if (acquisitionValue.value < 0) {
    erro.value = "O valor não pode ser negativo.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    const dados = {
      asset_number: assetNumber.value.trim(),
      name: name.value.trim(),
      category: category.value.trim() || null,
      description: description.value.trim() || null,
      serial_number: serialNumber.value.trim() || null,
      acquisition_date: acquisitionDate.value,
      acquisition_origin: acquisitionOrigin.value,
      acquisition_source: acquisitionSource.value.trim() || null,
      acquisition_value: acquisitionValue.value > 0 ? reaisParaCentavos(acquisitionValue.value) : null,
      acquisition_document: acquisitionDocument.value.trim() || null,
      observations: observations.value.trim() || null,
    };

    if (props.bem) {
      await AssetModel.update(props.bem.id, dados);
      props.onSaved?.(null);
    } else {
      const criado = await AssetModel.create({
        ...dados,
        location: location.value.trim() || null,
        responsible: responsible.value.trim() || null,
        condition: condition.value,
        lancamento: podeLancarCompra.value ? lancamento.value : null,
      });
      props.onSaved?.(criado);
    }
    closeModal();
  } catch (error) {
    erro.value = `Não foi possível salvar: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="asset-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <h3 class="section-title">Identificação</h3>
    <div class="field-grid">
      <div class="field">
        <label class="field-label" for="asset-number">Nº de patrimônio *</label>
        <input id="asset-number" v-model="assetNumber" type="text" :disabled="saving" required />
      </div>
      <div class="field span-2">
        <label class="field-label" for="name">Nome do bem *</label>
        <input id="name" v-model="name" type="text" placeholder="Mesa de escritório, notebook, cadeira..." :disabled="saving" required />
      </div>
      <div class="field">
        <label class="field-label" for="category">Categoria</label>
        <input id="category" v-model="category" type="text" list="asset-categories" placeholder="Móveis, Eletrônicos..." :disabled="saving" />
        <datalist id="asset-categories">
          <option v-for="c in categorias" :key="c" :value="c" />
        </datalist>
      </div>
      <div class="field span-2">
        <label class="field-label" for="serial-number">Nº de série / marca / modelo</label>
        <input id="serial-number" v-model="serialNumber" type="text" :disabled="saving" />
      </div>
      <div class="field span-3">
        <label class="field-label" for="description">Descrição</label>
        <input id="description" v-model="description" type="text" :disabled="saving" />
      </div>
    </div>

    <h3 class="section-title">Aquisição</h3>
    <div class="field-grid">
      <div class="field">
        <label class="field-label" for="acquisition-date">Data *</label>
        <input id="acquisition-date" v-model="acquisitionDate" type="date" :disabled="saving" required />
      </div>
      <div class="field">
        <label class="field-label" for="acquisition-origin">Origem *</label>
        <select id="acquisition-origin" v-model="acquisitionOrigin" :disabled="saving">
          <option v-for="(rotulo, valor) in ROTULO_ORIGEM" :key="valor" :value="valor">{{ rotulo }}</option>
        </select>
      </div>
      <div class="field">
        <label class="field-label" for="acquisition-value">Valor (R$)</label>
        <input id="acquisition-value" v-model.number="acquisitionValue" type="number" step="0.01" min="0" :disabled="saving" />
      </div>
      <div class="field span-2">
        <label class="field-label" for="acquisition-source">{{ rotuloFonte }}</label>
        <input id="acquisition-source" v-model="acquisitionSource" type="text" :disabled="saving" />
      </div>
      <div class="field">
        <label class="field-label" for="acquisition-document">Nota fiscal / termo</label>
        <input id="acquisition-document" v-model="acquisitionDocument" type="text" :disabled="saving" />
      </div>
    </div>

    <CashEntryOption
      v-if="podeLancarCompra"
      v-model="lancamento"
      label="Lançar a compra como despesa no caixa"
      :disabled="saving"
    />

    <template v-if="!editando">
      <h3 class="section-title">Situação inicial</h3>
      <div class="field-grid">
        <div class="field">
          <label class="field-label" for="location">Local</label>
          <input id="location" v-model="location" type="text" placeholder="Sede, secretaria..." :disabled="saving" />
        </div>
        <div class="field">
          <label class="field-label" for="responsible">Responsável</label>
          <input id="responsible" v-model="responsible" type="text" :disabled="saving" />
        </div>
        <div class="field">
          <label class="field-label" for="condition">Conservação</label>
          <select id="condition" v-model="condition" :disabled="saving">
            <option v-for="(rotulo, valor) in ROTULO_CONSERVACAO" :key="valor" :value="valor">{{ rotulo }}</option>
          </select>
        </div>
      </div>
    </template>
    <p v-else class="hint">
      Local, responsável e conservação mudam pelas ações da ficha do bem (Movimentar, Conservação...), para ficarem
      no histórico.
    </p>

    <div class="field">
      <label class="field-label" for="observations">Observações</label>
      <textarea id="observations" v-model="observations" rows="2" :disabled="saving"></textarea>
    </div>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Salvando..." : "Salvar" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.asset-form {
  width: 620px;
  max-width: 100%;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.section-title {
  margin: 0.25rem 0 0.6rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  column-gap: 0.75rem;
}

.span-2 {
  grid-column: span 2;
}

.span-3 {
  grid-column: span 3;
}

.field {
  margin-bottom: 0.9rem;
}

.field-label {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
}

.field input,
.field select,
.field textarea {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
  box-sizing: border-box;
}

.field input:disabled,
.field select:disabled {
  opacity: 0.6;
}

.hint {
  margin: 0 0 0.9rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.save-row {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
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

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
</style>
