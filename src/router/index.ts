import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import { clearSidebarTools } from "../composables/useSidebar.js";
import { closeModal } from "../composables/useModal.js";

declare module "vue-router" {
  interface RouteMeta {
    label?: string;
    icon?: string;
    hidden?: boolean;
    /** Só vira aba do menu superior quando o modo de mensalidade da associação bater (ver `App.vue`). */
    requiresMembershipMode?: "UNICO" | "MULTIPLO";
  }
}

// Novos módulos entram aqui como novas entradas de rota — qualquer uma com
// `meta.label` vira aba do menu superior automaticamente (ver App.vue).
export const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "inicio",
    component: () => import("../views/Inicio.vue"),
    meta: { label: "Início", icon: "home" },
  },
  {
    path: "/socios",
    name: "socios",
    component: () => import("../views/Socios.vue"),
    meta: { label: "Sócios", icon: "users" },
  },
  {
    path: "/socios/novo",
    name: "socio-novo",
    component: () => import("../views/SocioForm.vue"),
    // Sem meta.label: só alcançável pelo botão "Novo sócio" (lista de sócios).
    meta: { hidden: true },
  },
  {
    path: "/socios/:id",
    name: "socio-detalhes",
    component: () => import("../views/SocioDetalhes.vue"),
    // Sem meta.label: não vira aba do menu superior, só é alcançável a
    // partir da lista de sócios.
    meta: { hidden: true },
  },
  {
    path: "/socios/:id/editar",
    name: "socio-editar",
    component: () => import("../views/SocioForm.vue"),
    // Sem meta.label: só alcançável pelo botão "Editar sócio" na ficha do sócio.
    meta: { hidden: true },
  },
  {
    path: "/socios/aptos-a-votar/imprimir",
    name: "aptos-a-votar-imprimir",
    component: () => import("../views/ImprimirAptosAVotar.vue"),
    // Sem meta.label: só alcançável pelo botão da sidebar da lista de Sócios.
    meta: { hidden: true },
  },
  {
    path: "/planos",
    name: "planos",
    component: () => import("../views/Planos.vue"),
    // Só vira aba do menu quando a associação estiver no modo "Múltiplos
    // planos" (ver App.vue e InstitutionalDataEditor.vue).
    meta: { label: "Planos", icon: "box", requiresMembershipMode: "MULTIPLO" },
  },
  {
    path: "/cobrancas",
    name: "cobrancas",
    component: () => import("../views/Cobrancas.vue"),
    meta: { label: "Cobranças", icon: "list" },
  },
  {
    path: "/financeiro",
    name: "financeiro",
    component: () => import("../views/Financeiro.vue"),
    meta: { label: "Financeiro", icon: "dollar" },
  },
  {
    path: "/documentos",
    name: "documentos",
    component: () => import("../views/Documentos.vue"),
    meta: { label: "Documentos", icon: "file" },
  },
  {
    path: "/documentos/:id",
    name: "documento-detalhes",
    component: () => import("../views/DocumentoDetalhes.vue"),
    // Sem meta.label: só é alcançável a partir da lista de documentos.
    meta: { hidden: true },
  },
  {
    path: "/documentos/:id/visualizar",
    name: "documento-visualizar",
    component: () => import("../views/VisualizarDocumento.vue"),
    // Sem meta.label: só alcançável pelo botão "Visualizar" na ficha do documento.
    meta: { hidden: true },
  },
  {
    path: "/livros/:id/imprimir",
    name: "livro-protocolo-imprimir",
    component: () => import("../views/ImprimirLivroProtocolo.vue"),
    // Sem meta.label: só é alcançável a partir da aba Livros, em Documentos.
    meta: { hidden: true },
  },
  {
    path: "/recibos/:id/imprimir",
    name: "recibo-imprimir",
    component: () => import("../views/ImprimirRecibo.vue"),
    // Sem meta.label: só é alcançável logo depois de registrar um pagamento
    // de mensalidade (ver MembershipPaymentForm.vue).
    meta: { hidden: true },
  },
  {
    path: "/protocolos/:id/imprimir",
    name: "protocolo-imprimir",
    component: () => import("../views/ImprimirProtocolo.vue"),
    // Sem meta.label: só é alcançável a partir do botão "Imprimir" da lista
    // de Protocolos, em Documentos.vue — comprovante genérico (protocolo
    // que não é recibo de mensalidade cai aqui; quem é, vai pra
    // recibo-imprimir, ver MembershipPaymentModel.buscarPorProtocolo).
    meta: { hidden: true },
  },
  {
    path: "/acordos/:id/imprimir",
    name: "acordo-imprimir",
    component: () => import("../views/ImprimirReciboAcordo.vue"),
    // Sem meta.label: só alcançável logo depois de efetivar um acordo
    // (MembershipAgreementForm.vue) ou pelo botão "Imprimir" da lista de
    // Protocolos, em Documentos.vue, quando o protocolo é o recibo de um
    // acordo (ver MembershipAgreementModel.buscarPorProtocolo).
    meta: { hidden: true },
  },
  {
    path: "/relatorios/prestacao-contas/imprimir",
    name: "prestacao-contas-imprimir",
    component: () => import("../views/ImprimirPrestacaoContas.vue"),
    // Sem meta.label: só alcançável a partir da aba Relatórios, em
    // Financeiro.vue. Datas do período vêm via query string (`?inicio=&fim=`).
    meta: { hidden: true },
  },
  {
    path: "/relatorios/extrato/:id/imprimir",
    name: "extrato-conta-imprimir",
    component: () => import("../views/ImprimirExtratoConta.vue"),
    // Sem meta.label: só alcançável a partir da aba Relatórios, em
    // Financeiro.vue. `:id` é a conta financeira; período via query string.
    meta: { hidden: true },
  },
  {
    path: "/declaracoes/:id/imprimir",
    name: "declaracao-imprimir",
    component: () => import("../views/ImprimirDeclaracao.vue"),
    // Sem meta.label: só é alcançável a partir do botão "Gerar declaração"
    // da ficha do sócio (DeclaracaoForm.vue) ou do botão "Imprimir" da
    // lista de Protocolos, em Documentos.vue, quando o protocolo é uma
    // declaração (document_type === "DECLARACAO").
    meta: { hidden: true },
  },
  {
    path: "/configuracoes",
    name: "configuracoes",
    component: () => import("../views/Configuracoes.vue"),
    meta: { label: "Configurações", icon: "settings" },
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// Some com as ferramentas da tela anterior assim que a navegação começa;
// a view de destino chama setSidebarTools() ao montar e preenche de novo.
router.beforeEach(() => {
  clearSidebarTools();
  closeModal();
});
