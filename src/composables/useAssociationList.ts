import { ref } from "vue";
import { listAssociations, type AssociationSummary } from "../services/config.js";

/**
 * Lista de associações cadastradas (`config.json`), como estado de módulo
 * compartilhado — mesmo padrão de `useCurrentAssociation.ts`/`useSidebar.ts`.
 * Existe pra `AssociationSwitcher.vue` (montado na sidebar só quando a tela
 * Início está ativa, `SidebarTools.vue`) e `Inicio.vue` (aba Instituição,
 * que ainda cria/edita associações) enxergarem sempre a mesma lista sem
 * duplicar o fetch nem precisar de um jeito de "avisar" o outro componente
 * quando ela muda — estado de módulo sobrevive ao unmount/remount do
 * switcher entre navegações.
 */
export const associationList = ref<AssociationSummary[]>([]);
export const loadingAssociationList = ref(false);

export async function reloadAssociationList(): Promise<void> {
  loadingAssociationList.value = true;
  try {
    associationList.value = await listAssociations();
  } finally {
    loadingAssociationList.value = false;
  }
}
