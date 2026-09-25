# Frontend — `src/**`

- Sempre `<script setup lang="ts">` (Composition API), como em
  [App.vue](../../src/App.vue) e [Inicio.vue](../../src/views/Inicio.vue).
- Estado global é feito com composables simples
  ([useModal.ts](../../src/composables/useModal.ts),
  [useSidebar.ts](../../src/composables/useSidebar.ts)) — não introduza Vuex/Pinia
  sem pedir confirmação antes.
- Rotas usam `createWebHashHistory` ([src/router/index.ts](../../src/router/index.ts)).
  Uma rota só vira aba do menu superior se tiver `meta.label` (e `meta.hidden` não for `false`).
- Views não montam SQL: toda leitura/escrita passa por um método estático de
  `src/models/*.ts`. Se um método que você precisa não existir no model, crie-o lá,
  não faça `db.select`/`db.execute` direto na view.
- Textos de UI e comentários em português, no mesmo tom já usado nas telas existentes.
- Tokens de cor (`--bg`, `--accent`, etc.) são definidos em `:root` de
  [App.vue](../../src/App.vue), incluindo variante `@media (prefers-color-scheme: dark)`.
  Reaproveite esses tokens em vez de cravar cores novas.
- Tela de impressão (`src/views/Imprimir*.vue`): imprima com o `imprimir()` de
  [usePaginaImpressao.ts](../../src/composables/usePaginaImpressao.ts)
  (`"PADRAO"` ou `"RECIBO"`), nunca `window.print()` direto — é ele que aplica o
  tamanho de papel de Configurações → Impressão (`@page`). Nada de largura fixa
  maior que a página; em tabela, coluna de dado curto (nº, data, tipo, valor,
  situação) leva `class="nao-quebrar"` (regra global em `App.vue`).
