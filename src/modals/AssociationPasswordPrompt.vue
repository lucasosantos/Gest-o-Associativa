<script setup lang="ts">
// Pede a senha de acesso de uma associação antes de conectar nela (ver
// `useCurrentAssociation.ts`, `selectAssociation`). `onSubmit` faz a
// verificação de verdade e lança erro se a senha estiver incorreta.
import { ref } from "vue";
import { closeModal } from "../composables/useModal.js";

const props = defineProps<{ associationName: string; onSubmit: (password: string) => Promise<void> }>();

const password = ref("");
const enviando = ref(false);
const erro = ref("");

async function handleSubmit() {
  enviando.value = true;
  erro.value = "";
  try {
    await props.onSubmit(password.value);
    closeModal();
  } catch (error) {
    erro.value = error instanceof Error ? error.message : "Não foi possível entrar nessa associação.";
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <form class="password-form" @submit.prevent="handleSubmit">
    <p class="descricao">Digite a senha de acesso de "{{ associationName }}".</p>
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="password">Senha</label>
      <input id="password" v-model="password" type="password" autofocus :disabled="enviando" required />
    </div>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="enviando" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary" :disabled="enviando">
        {{ enviando ? "Entrando..." : "Entrar" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.password-form {
  min-width: 340px;
}

.descricao {
  margin: 0 0 0.9rem;
  color: var(--text-muted);
  font-size: 0.85rem;
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
