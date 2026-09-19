<script setup lang="ts">
import Icon from "./Icon.vue";
import type { MenuItem } from "../types/navigation.js";

defineProps<{
  modules: MenuItem[];
  activeId: string;
}>();

const emit = defineEmits<{ change: [id: string] }>();
</script>

<template>
  <header class="top-menu">
    <div class="brand">
      <span class="brand-name">Gestão Associativa</span>
    </div>

    <nav class="tabs" role="tablist">
      <button
        v-for="m in modules"
        :key="m.id"
        class="tab"
        role="tab"
        :class="{ active: m.id === activeId }"
        :aria-selected="m.id === activeId"
        @click="emit('change', m.id)"
      >
        <Icon :name="m.icon" :size="16" />
        <span>{{ m.label }}</span>
      </button>
    </nav>
  </header>
</template>

<style scoped>
.top-menu {
  display: flex;
  align-items: center;
  gap: 2rem;
  padding: 0 1.25rem;
  height: 56px;
  background: var(--menu-bg);
  color: var(--menu-fg);
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
}

.brand-name {
  font-size: 0.95rem;
  opacity: 0.92;
}

.tabs {
  display: flex;
  height: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar {
  display: none;
}

.tab {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  height: 100%;
  padding: 0 0.9rem;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--menu-fg-muted);
  font-size: 0.85rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  box-shadow: none;
}

.tab:hover {
  color: var(--menu-fg);
  background: rgba(255, 255, 255, 0.06);
}

.tab.active {
  color: #fff;
  border-bottom-color: var(--accent);
}
</style>
