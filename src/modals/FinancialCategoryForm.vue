<script setup lang="ts">
import { ref } from "vue";
import { FinancialCategoryModel, type TipoCategoria, type FinancialCategory } from "../models/FinancialCategory.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  categorias: FinancialCategory[];
  onSaved?: () => void;
}>();

const name = ref("");
const categoryType = ref<TipoCategoria>("RECEITA");
const code = ref("");
const parentId = ref("");
const saving = ref(false);
const erro = ref("");

async function handleSubmit() {
  if (!name.value.trim()) {
    erro.value = "Informe o nome da categoria.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await FinancialCategoryModel.create({
      name: name.value.trim(),
      category_type: categoryType.value,
      code: code.value.trim() || null,
      parent_id: parentId.value || null,
    });

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
  <form class="category-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="name">Nome *</label>
      <input id="name" v-model="name" type="text" :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="category-type">Tipo</label>
      <select id="category-type" v-model="categoryType" :disabled="saving">
        <option value="RECEITA">Receita</option>
        <option value="DESPESA">Despesa</option>
        <option value="TRANSFERENCIA">Transferência</option>
      </select>
    </div>

    <div class="field">
      <label class="field-label" for="parent">Categoria superior</label>
      <select id="parent" v-model="parentId" :disabled="saving">
        <option value="">Nenhuma</option>
        <option v-for="categoria in categorias" :key="categoria.id" :value="categoria.id">{{ categoria.name }}</option>
      </select>
    </div>

    <div class="field">
      <label class="field-label" for="code">Código</label>
      <input id="code" v-model="code" type="text" :disabled="saving" />
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
.category-form {
  min-width: 340px;
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
.field select {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.field input:disabled,
.field select:disabled {
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
