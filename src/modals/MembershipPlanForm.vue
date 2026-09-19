<script setup lang="ts">
// Criação/edição de plano de mensalidade (aba Planos, só existe no modo
// "Múltiplos planos" — ver `Planos.vue`). Sem `plano` na prop, cria um novo;
// com `plano`, edita o existente (nome/descrição/valor).
import { ref } from "vue";
import { MembershipPlanModel, type MembershipPlan } from "../models/MembershipPlan.js";
import { centavosParaReais, reaisParaCentavos } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ plano?: MembershipPlan; onSaved?: () => void }>();

const name = ref(props.plano?.name ?? "");
const description = ref(props.plano?.description ?? "");
const amount = ref(props.plano ? centavosParaReais(props.plano.amount) : 0);
const saving = ref(false);
const erro = ref("");

async function handleSubmit() {
  if (!name.value.trim()) {
    erro.value = "Informe o nome do plano.";
    return;
  }
  if (amount.value <= 0) {
    erro.value = "Informe o valor mensal do plano.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    const dados = {
      name: name.value.trim(),
      description: description.value.trim() || null,
      amount: reaisParaCentavos(amount.value),
    };

    if (props.plano) {
      await MembershipPlanModel.update(props.plano.id, dados);
    } else {
      await MembershipPlanModel.create(dados);
    }
    props.onSaved?.();
    closeModal();
  } catch (error) {
    erro.value = `Não foi possível salvar: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="plan-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="name">Nome *</label>
      <input id="name" v-model="name" type="text" placeholder="Contribuinte, Colaborador, Benemérito..." :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="description">Descrição</label>
      <input id="description" v-model="description" type="text" :disabled="saving" />
    </div>

    <div class="field">
      <label class="field-label" for="amount">Valor mensal (R$) *</label>
      <input id="amount" v-model.number="amount" type="number" step="0.01" min="0.01" :disabled="saving" required />
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
.plan-form {
  min-width: 360px;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
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

.field input {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.field input:disabled {
  opacity: 0.6;
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
