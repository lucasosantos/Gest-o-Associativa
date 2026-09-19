<script setup lang="ts">
// Seletor de associação ativa — antes vivia só dentro de Inicio.vue
// (visível só nessa tela); agora é um bloco fixo no topo da sidebar
// (SidebarTools.vue), visível em qualquer módulo, já que trocar de
// associação sem precisar navegar até o Início é o próprio pedido. Lógica
// movida (não duplicada) de Inicio.vue, incluindo o botão "Entrar
// novamente" (necessário porque re-selecionar a MESMA opção do <select>
// não dispara @change) e o prompt de senha.
import { computed, onMounted, ref } from "vue";
import { associationList, loadingAssociationList, reloadAssociationList } from "../composables/useAssociationList.js";
import {
  currentAssociationConfigId,
  isAssociationConnected,
  selectAssociation,
} from "../composables/useCurrentAssociation.js";
import type { AssociationSummary } from "../services/config.js";
import { openModal } from "../composables/useModal.js";
import AssociationForm from "../modals/AssociationForm.vue";
import AssociationPasswordPrompt from "../modals/AssociationPasswordPrompt.vue";

const conectando = ref(false);
const erroConexao = ref("");

const associacaoSelecionada = computed(
  () => associationList.value.find((a) => a.id === currentAssociationConfigId.value) ?? null
);
const associacaoConectada = computed(() => (isAssociationConnected.value ? associacaoSelecionada.value : null));

/** Lança o erro adiante (não guarda em `erroConexao`) — quem chama decide como mostrar. */
async function conectar(entry: AssociationSummary, password?: string) {
  conectando.value = true;
  try {
    await selectAssociation(entry, password);
  } finally {
    conectando.value = false;
  }
}

function entrarNovamente(entry: AssociationSummary) {
  erroConexao.value = "";

  if (entry.has_password) {
    openModal({
      title: `Entrar em "${entry.name}"`,
      component: AssociationPasswordPrompt,
      props: {
        associationName: entry.name,
        onSubmit: (password: string) => conectar(entry, password),
      },
    });
    return;
  }

  conectar(entry).catch((error) => {
    erroConexao.value = `Não foi possível conectar: ${error instanceof Error ? error.message : error}`;
  });
}

function onSelecionar(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const entry = associationList.value.find((a) => a.id === id);
  if (!entry) return;
  entrarNovamente(entry);
}

function abrirNovaAssociacao() {
  openModal({
    title: "Nova associação",
    component: AssociationForm,
    props: { onCreated: reloadAssociationList },
  });
}

onMounted(async () => {
  await reloadAssociationList();

  // Reconecta sozinho na última associação usada, só quando ela não tem
  // senha — com senha, o usuário precisa escolher e digitar de novo.
  const lembrada = associacaoSelecionada.value;
  if (lembrada && !lembrada.has_password && !isAssociationConnected.value) {
    try {
      await conectar(lembrada);
    } catch (error) {
      erroConexao.value = `Não foi possível reconectar: ${error instanceof Error ? error.message : error}`;
    }
  }
});
</script>

<template>
  <div class="association-switcher">
    <div class="switcher-header">Associação</div>

    <div v-if="loadingAssociationList" class="state-msg">Carregando...</div>

    <template v-else-if="associationList.length === 0">
      <p class="state-msg">Nenhuma cadastrada.</p>
      <button type="button" class="link-btn" @click="abrirNovaAssociacao">+ Nova associação</button>
    </template>

    <template v-else>
      <select
        class="switcher-select"
        :value="associacaoSelecionada?.id ?? ''"
        :disabled="conectando"
        @change="onSelecionar"
      >
        <option value="" disabled>Selecione...</option>
        <option v-for="associacao in associationList" :key="associacao.id" :value="associacao.id">
          {{ associacao.name }}{{ associacao.has_password ? " 🔒" : "" }}
        </option>
      </select>

      <button
        v-if="associacaoSelecionada && !associacaoConectada"
        type="button"
        class="btn-secondary"
        :disabled="conectando"
        @click="entrarNovamente(associacaoSelecionada)"
      >
        {{ conectando ? "Entrando..." : "Entrar novamente" }}
      </button>

      <p v-if="erroConexao" class="erro">{{ erroConexao }}</p>
      <p v-else-if="associacaoSelecionada && !associacaoConectada" class="aviso">Desbloqueie pra usar os módulos.</p>

      <button type="button" class="link-btn" @click="abrirNovaAssociacao">+ Nova associação</button>
    </template>
  </div>
</template>

<style scoped>
.association-switcher {
  padding: 0 0.4rem 0.9rem;
  margin-bottom: 0.9rem;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.switcher-header {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.switcher-select {
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.82rem;
  font-family: inherit;
}

.switcher-select:disabled {
  opacity: 0.6;
}

.btn-secondary {
  padding: 0.35rem 0.6rem;
  border-radius: 6px;
  font-size: 0.78rem;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.btn-secondary:disabled {
  opacity: 0.6;
  cursor: default;
}

.link-btn {
  align-self: flex-start;
  border: none;
  background: none;
  color: var(--accent);
  font-size: 0.78rem;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

.state-msg {
  padding: 0;
  text-align: left;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.erro {
  margin: 0;
  color: #c0392b;
  font-size: 0.74rem;
}

.aviso {
  margin: 0;
  color: #a3690a;
  font-size: 0.74rem;
}
</style>
