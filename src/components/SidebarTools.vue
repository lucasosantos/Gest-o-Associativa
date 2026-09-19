<script setup lang="ts">
import Icon from "./Icon.vue";
import AssociationSwitcher from "./AssociationSwitcher.vue";
import type { SidebarToolGroup } from "../composables/useSidebar.js";

defineProps<{
  moduleLabel: string;
  groups: SidebarToolGroup[];
  /** Só a tela Início mostra o seletor de associação (pedido do usuário) — nas demais, fica escondido. */
  mostrarSeletorAssociacao: boolean;
}>();
</script>

<template>
  <aside class="sidebar">
    <AssociationSwitcher v-if="mostrarSeletorAssociacao" />

    <div class="sidebar-header">{{ moduleLabel }}</div>

    <div v-for="g in groups" :key="g.group" class="tool-group">
      <div class="tool-list">
        <button
          v-for="item in g.items"
          :key="item.id"
          class="tool-btn"
          aria-haspopup="dialog"
          @click="item.onClick && item.onClick()"
        >
          <Icon :name="item.icon" :size="17" />
          <span>{{ item.label }}</span>
        </button>
      </div>
      <div class="group-caption">{{ g.group }}</div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 0.9rem 0.7rem;
  overflow-y: auto;
}

.sidebar-header {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  padding: 0 0.4rem 0.8rem;
}

.tool-group {
  margin-bottom: 0.9rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid var(--border);
}
.tool-group:last-child {
  border-bottom: none;
}

.tool-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tool-btn {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.45rem 0.5rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 0.83rem;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  box-shadow: none;
}

.tool-btn :deep(svg) {
  color: var(--text-muted);
  flex-shrink: 0;
}

.tool-btn:hover {
  background: var(--surface-hover);
  color: var(--accent);
}
.tool-btn:hover :deep(svg) {
  color: var(--accent);
}

.group-caption {
  margin-top: 0.35rem;
  padding: 0 0.5rem;
  font-size: 0.68rem;
  color: var(--text-muted);
  text-align: center;
  letter-spacing: 0.02em;
}
</style>