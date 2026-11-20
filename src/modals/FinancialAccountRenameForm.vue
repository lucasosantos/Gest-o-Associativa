<script setup lang="ts">
// Troca o nome de uma conta financeira (aba Contas do Financeiro), com
// motivo obrigatório — vai pra Atividades junto com o nome antigo (ver
// `FinancialAccountModel.renomear`).
import { ref } from "vue";
import { FinancialAccountModel, type FinancialAccountComSaldo } from "../models/FinancialAccount.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ conta: FinancialAccountComSaldo; onSaved?: () => void }>();

const nome = ref(props.conta.name);
const motivo = ref("");
const saving = ref(false);
const erro = ref("");

async function handleSubmit() {
  if (!nome.value.trim()) {
    erro.value = "Informe o novo nome da conta.";
    return;
  }
  if (!motivo.value.trim()) {
    erro.value = "Informe o motivo — ele fica registrado em Atividades.";
    return;
  }
  saving.value = true;
  erro.value = "";
  try {
    await FinancialAccountModel.renomear(props.conta.id, nome.value, motivo.value);
    props.onSaved?.();
    closeModal();
  } catch (error) {
    erro.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="renomear-form" @submit.prevent="handleSubmit">
    <p class="atual">Nome atual: <strong>{{ conta.name }}</strong></p>
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="novo-nome">Novo nome *</label>
      <input id="novo-nome" v-model="nome" type="text" :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="motivo">Motivo *</label>
      <textarea
        id="motivo"
        v-model="motivo"
        rows="3"
        placeholder="Ex.: conta trocou de banco / nome digitado errado"
        :disabled="saving"
      ></textarea>
    </div>

    <p class="aviso">
      Os lançamentos continuam ligados à conta: extratos e relatórios passam a mostrar o nome novo. O nome antigo fica
      registrado em Atividades.
    </p>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Salvando..." : "Renomear" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.renomear-form {
  width: 400px;
  max-width: 100%;
}

.atual {
  margin: 0 0 0.9rem;
  font-size: 0.85rem;
  color: var(--text-muted);
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
  line-height: 1.45;
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
