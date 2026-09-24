<script setup lang="ts">
// Baixa do bem (ver `AssetModel.darBaixa`): tira o bem do inventário ativo
// sem apagar nada — cadastro e linha do tempo continuam guardados. Motivo
// é sempre obrigatório; comprador/donatário e valor só aparecem nos tipos
// em que fazem sentido. Venda com valor pode lançar a receita no caixa.
import { computed, ref } from "vue";
import { AssetModel, ROTULO_TIPO_BAIXA, type Asset, type LancamentoCaixaBem, type TipoBaixa } from "../models/Asset.js";
import { hojeIso, reaisParaCentavos } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import CashEntryOption from "../components/CashEntryOption.vue";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ bem: Asset; onSaved?: () => void }>();

const AJUDA_TIPO: Record<TipoBaixa, string> = {
  VENDA: "O bem foi vendido. Informe comprador e valor.",
  DOACAO: "O bem foi doado a outra entidade ou pessoa.",
  DESCARTE: "Sem conserto ou sem uso — foi para o lixo, reciclagem ou sucata.",
  PERDA: "Extraviado, não foi mais encontrado.",
  FURTO_ROUBO: "Furtado ou roubado — registre o nº do boletim de ocorrência no motivo.",
  OUTRO: "Qualquer outra saída do patrimônio.",
};

const disposalType = ref<TipoBaixa>("DESCARTE");
const disposalDate = ref(hojeIso());
const reason = ref("");
const recipient = ref("");
const saleValue = ref(0);
const lancamento = ref<LancamentoCaixaBem | null>(null);
const saving = ref(false);
const erro = ref("");

const pedeDestinatario = computed(() => disposalType.value === "VENDA" || disposalType.value === "DOACAO");
const ehVenda = computed(() => disposalType.value === "VENDA");

async function handleSubmit() {
  erro.value = "";
  if (!disposalDate.value) {
    erro.value = "Informe a data da baixa.";
    return;
  }
  if (!reason.value.trim()) {
    erro.value = "Informe o motivo da baixa.";
    return;
  }
  if (ehVenda.value && saleValue.value <= 0) {
    erro.value = "Informe o valor da venda.";
    return;
  }

  saving.value = true;
  try {
    await AssetModel.darBaixa(props.bem.id, {
      disposal_type: disposalType.value,
      disposal_date: disposalDate.value,
      disposal_reason: reason.value.trim(),
      disposal_recipient: pedeDestinatario.value ? recipient.value.trim() || null : null,
      disposal_value: ehVenda.value ? reaisParaCentavos(saleValue.value) : null,
      lancamento: ehVenda.value ? lancamento.value : null,
    });
    props.onSaved?.();
    closeModal();
  } catch (error) {
    erro.value = `Não foi possível dar baixa: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="disposal-form" @submit.prevent="handleSubmit">
    <p class="bem-info">{{ bem.name }} · nº {{ bem.asset_number }}</p>
    <p v-if="erro" class="erro">{{ erro }}</p>

    <fieldset class="tipos" :disabled="saving">
      <legend class="field-label">Tipo de baixa *</legend>
      <label
        v-for="(rotulo, valor) in ROTULO_TIPO_BAIXA"
        :key="valor"
        class="tipo"
        :class="{ ativo: disposalType === valor }"
      >
        <input v-model="disposalType" type="radio" name="disposal-type" :value="valor" />
        <span>
          <strong>{{ rotulo }}</strong>
          <small>{{ AJUDA_TIPO[valor] }}</small>
        </span>
      </label>
    </fieldset>

    <div class="field-row">
      <div class="field">
        <label class="field-label" for="disposal-date">Data *</label>
        <input id="disposal-date" v-model="disposalDate" type="date" :min="bem.acquisition_date" :disabled="saving" required />
      </div>
      <div v-if="ehVenda" class="field">
        <label class="field-label" for="sale-value">Valor da venda (R$) *</label>
        <input id="sale-value" v-model.number="saleValue" type="number" step="0.01" min="0.01" :disabled="saving" />
      </div>
    </div>

    <div v-if="pedeDestinatario" class="field">
      <label class="field-label" for="recipient">{{ ehVenda ? "Comprador" : "Donatário (quem recebeu)" }}</label>
      <input id="recipient" v-model="recipient" type="text" :disabled="saving" />
    </div>

    <CashEntryOption
      v-if="ehVenda && saleValue > 0"
      v-model="lancamento"
      label="Lançar a venda como receita no caixa"
      :disabled="saving"
    />

    <div class="field">
      <label class="field-label" for="reason">Motivo *</label>
      <textarea
        id="reason"
        v-model="reason"
        rows="3"
        placeholder="Ex.: tela quebrada sem conserto; aprovado em reunião de diretoria de 10/09/2026."
        :disabled="saving"
      ></textarea>
    </div>

    <p class="aviso">
      A baixa tira o bem do inventário ativo. O cadastro e todo o histórico continuam guardados — e a baixa pode ser
      desfeita depois, com justificativa, se tiver sido registrada por engano.
    </p>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-danger" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Registrando..." : "Dar baixa" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.disposal-form {
  width: 480px;
  max-width: 100%;
}

.bem-info {
  margin: 0 0 0.9rem;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.tipos {
  border: none;
  padding: 0;
  margin: 0 0 0.9rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.tipos legend {
  grid-column: 1 / -1;
  padding: 0;
}

.tipo {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  cursor: pointer;
  font-size: 0.82rem;
  color: var(--text);
}

.tipo.ativo {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.tipo input {
  margin-top: 0.15rem;
}

.tipo small {
  display: block;
  margin-top: 0.15rem;
  color: var(--text-muted);
  font-size: 0.72rem;
  line-height: 1.3;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
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

.aviso {
  margin: 0;
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

.btn-danger,
.btn-secondary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
}

.btn-danger {
  border: none;
  background: #c0392b;
  color: #fff;
}

.btn-danger:disabled,
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
