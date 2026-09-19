<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import TopMenu from "./components/TopMenu.vue";
import SidebarTools from "./components/SidebarTools.vue";
import Modal from "./components/Modal.vue";
import { routes } from "./router";
import { sidebarTools } from "./composables/useSidebar.js";
import { modalState, modalComponent, modalProps, closeModal } from "./composables/useModal.js";
import { currentMembershipMode } from "./composables/useCurrentAssociation.js";
import type { MenuItem } from "./types/navigation.js";

const route = useRoute();
const router = useRouter();

// Itens do menu superior: qualquer rota que tenha meta.label vira uma aba —
// reativo a `currentMembershipMode` porque a aba "Planos" só existe no modo
// "Múltiplos planos" (`meta.requiresMembershipMode`, ver router/index.ts) e
// precisa aparecer/sumir na hora, sem reiniciar o app, quando o modo muda
// em InstitutionalDataEditor.vue.
const menuItems = computed<MenuItem[]>(() =>
  routes
    .filter((r) => r.meta?.label && r.meta?.hidden !== false)
    .filter((r) => !r.meta?.requiresMembershipMode || r.meta.requiresMembershipMode === currentMembershipMode.value)
    .map((r) => ({ id: String(r.name), label: r.meta!.label!, icon: r.meta!.icon! }))
);

const activeModuleId = computed(() => String(route.name ?? "inicio"));
const activeLabel = computed(() => route.meta?.label ?? "");
// Seletor de associação: só aparece na sidebar da tela Início (pedido do
// usuário) — nas demais telas, trocar de associação exige voltar pro Início.
const naTelaInicio = computed(() => route.name === "inicio");

function setModule(id: string) {
  router.push({ name: id });
}
</script>

<template>
  <div class="app-shell">
    <TopMenu
      :modules="menuItems"
      :active-id="activeModuleId"
      @change="setModule"
    />

    <div class="app-body">
      <SidebarTools :module-label="activeLabel" :groups="sidebarTools" :mostrar-seletor-associacao="naTelaInicio" />

      <!-- router-view renderiza src/views/<Modulo>.vue de acordo com a rota ativa.
           :key força remontagem a cada mudança de caminho — sem isso, o Vue
           Router reaproveita a instância do componente entre rotas do mesmo
           nome com :id diferente (ex.: /socios/A → /socios/B), e o
           onMounted da tela de detalhe (ou o useAssociationScopedData de
           qualquer tela) simplesmente não roda de novo, deixando dado velho
           na tela (ver useAssociationScopedData.ts). -->
      <router-view :key="route.fullPath" />
    </div>

    <!-- Cada botão da sidebar chama openModal({ title, component }) no
         próprio onClick (definido na view). App.vue só reage ao estado:
         se veio um componente, renderiza ele; senão, cai no texto padrão. -->
    <Modal v-if="modalState.isOpen" :title="modalState.title" @close="closeModal">
      <component :is="modalComponent" v-if="modalComponent" v-bind="modalProps" />
      <p v-else>Conteúdo de <strong>{{ modalState.title }}</strong> entra aqui.</p>
    </Modal>
  </div>
</template>

<style>
:root {
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  font-weight: 400;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;

  /* --- Design tokens (tema claro) --- */
  --bg: #f4f5f7;
  --surface: #ffffff;
  --surface-hover: #eef0f3;
  --border: #e2e4e9;
  --text: #1b2430;
  --text-muted: #6b7280;

  --menu-bg: #1b2a4a;
  --menu-fg: #eef1f7;
  --menu-fg-muted: #aab4cc;

  --accent: #2f6f5e;
  --accent-soft: #e4efec;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1f24;
    --surface: #24282f;
    --surface-hover: #2d323a;
    --border: #363c45;
    --text: #eef1f5;
    --text-muted: #9aa2ad;

    --menu-bg: #10192e;
    --menu-fg: #eef1f7;
    --menu-fg-muted: #8b96b4;

    --accent: #4bb693;
    --accent-soft: #1c3830;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.content {
  flex: 1;
  min-width: 0;
  padding: 1.5rem 2rem;
  overflow-y: auto;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-bottom: 1.25rem;
}
.breadcrumb .sep {
  opacity: 0.5;
}
.breadcrumb .current {
  color: var(--accent);
  font-weight: 600;
}

.placeholder {
  max-width: 640px;
}
.placeholder h2 {
  margin: 0 0 0.6rem;
  font-size: 1.4rem;
  color: var(--text);
}
.placeholder p {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.6;
  font-size: 0.9rem;
}
.placeholder code {
  background: var(--surface-hover);
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  font-size: 0.85em;
}

.page-header h2 {
  font-size: 24px;
  margin: 0 0 6px;
  color: var(--text);
}

.page-header p {
  color: var(--text-muted);
  font-size: 14px;
  max-width: 640px;
  margin: 0;
}

.state-msg {
  padding: 40px;
  text-align: center;
  color: var(--text-muted);
  font-size: 14px;
}

/* Telas de impressão (ex.: ImprimirLivroProtocolo.vue) marcam o que não
   deve sair no papel com `.no-print` — aqui só cuidamos de tirar a casca
   do app (menu/sidebar) e destravar a altura/scroll fixos do layout de
   tela, que senão cortariam a lista impressa numa página só. */
@media print {
  .top-menu,
  .sidebar {
    display: none !important;
  }

  .app-shell,
  .app-body {
    display: block !important;
    height: auto !important;
    overflow: visible !important;
  }

  .content {
    overflow: visible !important;
    padding: 0 !important;
  }
}
</style>