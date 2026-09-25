<script setup lang="ts">
// Escolhe o filtro da lista impressa de sócios antes de abrir a tela de
// impressão (`ImprimirListaSocios.vue`, que já abre mandando imprimir).
import { ref } from "vue";
import { useRouter } from "vue-router";
import type { OrdemListaSocios, StatusSocio } from "../models/Member.js";
import { ROTULO_SITUACAO_SOCIO, SITUACOES_SOCIO } from "../utils/situacaoSocio.js";
import { closeModal } from "../composables/useModal.js";

const router = useRouter();

const situacao = ref<StatusSocio | "">("ATIVO");
const ordem = ref<OrdemListaSocios>("NOME");

function gerar() {
  // A navegação fecha o modal sozinha (`router.beforeEach` em router/index.ts).
  router.push({
    name: "lista-socios-imprimir",
    query: { situacao: situacao.value || undefined, ordem: ordem.value },
  });
}
</script>

<template>
  <form class="lista-form" @submit.prevent="gerar">
    <div class="field">
      <label class="field-label" for="situacao">Situação</label>
      <select id="situacao" v-model="situacao">
        <option value="">Todas as situações</option>
        <option v-for="codigo in SITUACOES_SOCIO" :key="codigo" :value="codigo">
          {{ ROTULO_SITUACAO_SOCIO[codigo] }}
        </option>
      </select>
    </div>

    <div class="field">
      <label class="field-label" for="ordem">Ordenar por</label>
      <select id="ordem" v-model="ordem">
        <option value="NOME">Nome</option>
        <option value="MATRICULA">Matrícula</option>
      </select>
    </div>

    <p class="hint">Cada sócio sai em duas linhas: matrícula e nome; data de associação, CPF, RG e nascimento.</p>

    <div class="save-row">
      <button type="button" class="btn-secondary" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary">Gerar lista</button>
    </div>
  </form>
</template>

<style scoped>
.lista-form {
  width: 360px;
  max-width: 100%;
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

.hint {
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

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
</style>
