<script setup lang="ts">
// Indicador de carregamento pra botões de salvar/confirmar — feedback de
// "aguarde" enquanto uma ação grava no banco (o próprio botão já vem
// desabilitado via :disabled="saving" pra não disparar 2 vezes).
withDefaults(defineProps<{ size?: number }>(), { size: 14 });
</script>

<template>
  <svg
    class="spinner"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" stroke-dasharray="34 60" />
  </svg>
</template>

<style scoped>
.spinner {
  display: inline-block;
  vertical-align: -2px;
  margin-right: 0.4rem;
  animation: spinner-girar 0.7s linear infinite;
}

@keyframes spinner-girar {
  to {
    transform: rotate(360deg);
  }
}
</style>
