<script setup lang="ts">
// Desfaz uma baixa registrada por engano (ver `AssetModel.desfazerBaixa`):
// o bem volta a "Em uso", a baixa continua na linha do tempo e a
// justificativa fica registrada logo depois dela.
import { ref } from "vue";
import { AssetModel, type Asset } from "../models/Asset.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ bem: Asset; onSaved?: () => void }>();

const justificativa = ref("");
const saving = ref(false);
const erro = ref("");

async function handleSubmit() {
  if (!justificativa.value.trim()) {
    erro.value = "Informe por que a baixa está sendo desfeita.";
    return;
  }
  saving.value = true;
  erro.value = "";
  try {
    await AssetModel.desfazerBaixa(props.bem.id, justificativa.value);
    props.onSaved?.();
    closeModal();
  } catch (error) {
    erro.value = `Não foi possível desfazer a baixa: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="reactivate-form" @submit.prevent="handleSubmit">
    <p class="bem-info">{{ bem.name }} · nº {{ bem.asset_number }}</p>
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="justificativa">Justificativa *</label>
      <textarea id="justificativa" v-model="justificativa" rows="3" :disabled="saving"></textarea>
    </div>

    <p v-if="bem.disposal_type === 'VENDA'" class="aviso">
      Se a venda foi lançada no caixa, estorne o lançamento no Financeiro — ele não é estornado automaticamente.
    </p>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Salvando..." : "Desfazer baixa" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.reactivate-form {
  width: 400px;
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
