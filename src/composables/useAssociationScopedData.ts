import { onMounted, watch } from "vue";
import { currentAssociationId } from "./useCurrentAssociation.js";

/**
 * Toda view cujo dado depende da associação ativa deve carregar os dados
 * com isto em vez de um `onMounted(carregar)` puro. Motivo: a troca de
 * associação vive na sidebar (`AssociationSwitcher.vue`), visível só na
 * tela Início — mas o próprio Início também mostra dado dependente da
 * associação (ver `Inicio.vue`), e sem reagir à troca sozinho ficaria
 * mostrando o dado da associação anterior até uma navegação forçar
 * remontagem. `:key="route.fullPath"` no `<router-view>` de `App.vue` já
 * cobre trocar de registro na mesma rota (ex.: `/socios/A` → `/socios/B`);
 * este composable cobre trocar de associação SEM navegar — a tela continua
 * montada, então só um remount não ajudaria. Usado em toda view por
 * consistência (mesmo padrão em qualquer tela), embora hoje só o Início
 * realmente dispare o `watch` — é o único lugar de onde dá pra trocar.
 */
export function useAssociationScopedData(loadFn: () => void | Promise<void>): void {
  onMounted(loadFn);
  watch(currentAssociationId, loadFn);
}
