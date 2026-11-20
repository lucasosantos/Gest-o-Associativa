<script setup lang="ts">
// Apaga de vez um lançamento já estornado — pra lançamento feito por
// engano (ver `CashTransactionModel.apagarEstornado`). Some o par
// (lançamento + estorno), o saldo não muda e o registro do que foi
// apagado, com o motivo, fica em Atividades.
import { ref } from "vue";
import { CashTransactionModel, type CashTransactionComNomes } from "../models/CashTransaction.js";
import { closeModal } from "../composables/useModal.js";
import { formatarData, formatarMoeda } from "../utils/format.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ lancamento: CashTransactionComNomes; onSaved?: () => void }>();

const motivo = ref("");
const saving = ref(false);
const erro = ref("");

async function handleSubmit() {
  if (!motivo.value.trim()) {
    erro.value = "Informe por que o lançamento está sendo apagado.";
    return;
  }
  saving.value = true;
  erro.value = "";
  try {
    await CashTransactionModel.apagarEstornado(props.lancamento.id, motivo.value);
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
  <form class="apagar-form" @submit.prevent="handleSubmit">
    <p class="lancamento-info">
      <strong>{{ lancamento.description }}</strong><br />
      {{ formatarMoeda(lancamento.amount) }} · {{ formatarData(lancamento.transaction_date) }}
    </p>

    <p class="explicacao">
      Some da lista <strong>o lançamento e o estorno dele</strong>. Como um anula o outro, o saldo da conta não muda.
      O registro do que foi apagado, com o motivo, fica guardado em <strong>Atividades</strong>. Não dá para desfazer.
    </p>

    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="motivo">Motivo *</label>
      <textarea
        id="motivo"
        v-model="motivo"
        rows="3"
        placeholder="Ex.: lançado na conta errada / valor digitado errado"
        :disabled="saving"
      ></textarea>
    </div>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-perigo" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Apagando..." : "Apagar de vez" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.apagar-form {
  width: 420px;
  max-width: 100%;
}

.lancamento-info {
  margin: 0 0 0.75rem;
  font-size: 0.88rem;
  color: var(--text);
}

.explicacao {
  margin: 0 0 0.9rem;
  font-size: 0.8rem;
  line-height: 1.45;
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

.save-row {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.btn-perigo,
.btn-secondary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
}

/* Ação destrutiva: mesmo vermelho das mensagens de erro do app. */
.btn-perigo {
  border: none;
  background: #c0392b;
  color: #fff;
}

.btn-perigo:disabled,
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
