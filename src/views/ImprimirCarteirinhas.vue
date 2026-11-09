<script setup lang="ts">
// Carteirinhas de sócio pra impressão — uma ou várias de vez. Cada lado é
// um `CarteirinhaSocio.vue` (cartão de crédito, 85,6 × 54 mm), e a FRENTE
// e o VERSO do mesmo sócio saem lado a lado, colados pela linha de dobra
// (tracejada): recorta-se o contorno do par, dobra-se no meio e cola-se
// (ou plastifica). Imprime em qualquer impressora, só de um lado — 5
// sócios por folha A4/Ofício, 4 em Carta, com margem de 8 mm.
//
// Quem sai vem da query — `?ids=a,b` (escolhidos um a um, ou um só a
// partir da ficha do sócio) ou `?situacao=` —, mais `ordem` e `validade`
// (AAAA-MM-DD; ausente = sem validade), escolhidos em
// `CarteirinhaPrintForm.vue`. Mesmo padrão das outras telas de impressão:
// abre já mandando pra impressão do sistema.
//
// Logo do verso, imagem de fundo e cores personalizáveis (por associação,
// `CarteirinhaLayoutModel`): escolhidas na barra de ações desta tela, que
// não sai no papel — assim a pessoa vê o resultado na hora.
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  CarteirinhaLayoutModel,
  CORES_PADRAO,
  LAYOUT_PADRAO,
  TEXTO_VERSO_MAXIMO,
  TEXTO_VERSO_PADRAO,
  type CarteirinhaLayout,
} from "../models/CarteirinhaLayout.js";
import { readImageAsDataUrl } from "../services/personPhoto.js";
import {
  MemberModel,
  type FiltroCarteirinha,
  type OrdemListaSocios,
  type SocioCarteirinha,
  type StatusSocio,
} from "../models/Member.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { ActivityLogModel } from "../models/ActivityLog.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { usePaginaImpressao } from "../composables/usePaginaImpressao.js";
import { getPrintConfig } from "../services/config.js";
import { formatarData, hojeLocalIso } from "../utils/format.js";
import { ROTULO_SITUACAO_SOCIO, SITUACOES_SOCIO } from "../utils/situacaoSocio.js";
import CarteirinhaSocio from "../components/CarteirinhaSocio.vue";

const route = useRoute();
const router = useRouter();

function lerFiltro(): FiltroCarteirinha {
  const ids = typeof route.query.ids === "string" ? route.query.ids.split(",").filter(Boolean) : null;
  if (ids) return { ids };
  const valor = route.query.situacao;
  const situacao =
    typeof valor === "string" && (SITUACOES_SOCIO as string[]).includes(valor) ? (valor as StatusSocio) : null;
  return { situacao };
}

const filtro = lerFiltro();
const ordem: OrdemListaSocios = route.query.ordem === "MATRICULA" ? "MATRICULA" : "NOME";
const validadeIso =
  typeof route.query.validade === "string" && /^\d{4}-\d{2}-\d{2}$/.test(route.query.validade)
    ? route.query.validade
    : null;
/** Validade formatada; `null` = sem validade (o campo some da carteirinha). */
const validade = validadeIso ? formatarData(validadeIso) : null;
const validadeTexto = validade ? `validade ${validade}` : "sem validade";

const associacao = ref<Association | null>(null);
const socios = ref<SocioCarteirinha[]>([]);
const loading = ref(true);
const erro = ref("");

// --- Montagem das folhas: um par frente + verso por fileira ---
/** Sócios (pares) por folha: 5 fileiras em A4/Ofício, 4 em Carta (mais baixa). */
const paresPorFolha = ref(5);

const folhas = computed<SocioCarteirinha[][]>(() => {
  const blocos: SocioCarteirinha[][] = [];
  for (let i = 0; i < socios.value.length; i += paresPorFolha.value) {
    blocos.push(socios.value.slice(i, i + paresPorFolha.value));
  }
  return blocos;
});

// --- Aparência (imagem de fundo) ---
const layout = ref<CarteirinhaLayout>({ ...LAYOUT_PADRAO });
const salvandoLayout = ref(false);
const erroLayout = ref("");

/**
 * Cores em edição: mudam a pré-visualização enquanto o seletor é arrastado
 * (`input`) e só são salvas quando a escolha é confirmada (`change`) — pra
 * não gravar uma linha de histórico a cada tom intermediário.
 */
const cores = ref({ corPrincipal: LAYOUT_PADRAO.corPrincipal, corCampos: LAYOUT_PADRAO.corCampos });
const coresSaoPadrao = computed(
  () => cores.value.corPrincipal === CORES_PADRAO.corPrincipal && cores.value.corCampos === CORES_PADRAO.corCampos
);

/** O que o cartão desenha: layout salvo + cores em edição. */
const aparencia = computed<CarteirinhaLayout>(() => ({
  ...layout.value,
  ...cores.value,
  textoVerso: textoVerso.value,
}));

/** Ordem dos lados no par: frente à esquerda, verso à direita. */
const LADOS = ["FRENTE", "VERSO"] as const;

/** Data de emissão impressa no verso: o dia em que as carteirinhas foram geradas. */
const emissao = formatarData(hojeLocalIso());
const endereco = ref<Address | null>(null);

/** Frase do verso em edição: pré-visualiza enquanto digita, salva ao sair do campo (`change`). */
const textoVerso = ref(LAYOUT_PADRAO.textoVerso);

function salvarTextoVerso() {
  const texto = textoVerso.value.trim().slice(0, TEXTO_VERSO_MAXIMO);
  textoVerso.value = texto;
  if (texto === layout.value.textoVerso) return;
  salvarLayout({ ...layout.value, textoVerso: texto });
}

function restaurarTextoVerso() {
  textoVerso.value = TEXTO_VERSO_PADRAO;
  salvarTextoVerso();
}

function trocarRodape(evento: Event) {
  salvarLayout({ ...layout.value, mostrarRodape: (evento.target as HTMLInputElement).checked });
}

async function salvarLayout(novo: CarteirinhaLayout) {
  salvandoLayout.value = true;
  erroLayout.value = "";
  try {
    await CarteirinhaLayoutModel.salvar(novo, layout.value);
    layout.value = novo;
  } catch (error) {
    erroLayout.value = `Não foi possível salvar a aparência: ${error instanceof Error ? error.message : error}`;
  } finally {
    salvandoLayout.value = false;
    // Se falhou, a pré-visualização volta pro que está salvo.
    cores.value = { corPrincipal: layout.value.corPrincipal, corCampos: layout.value.corCampos };
    textoVerso.value = layout.value.textoVerso;
  }
}

function salvarCores() {
  if (
    cores.value.corPrincipal === layout.value.corPrincipal &&
    cores.value.corCampos === layout.value.corCampos
  ) {
    return;
  }
  salvarLayout({ ...layout.value, ...cores.value });
}

function restaurarCores() {
  cores.value = { ...CORES_PADRAO };
  salvarCores();
}

/** Abre o seletor de imagem e salva no campo pedido do layout (fundo da frente ou logo do verso). */
type CampoImagem = "imagemFundo" | "logo" | "assinatura";

async function escolherImagem(campo: CampoImagem) {
  // Assinatura só em PNG: é o formato com fundo transparente, pra traço
  // "pousar" na linha sem um retângulo branco em volta.
  const filtro =
    campo === "assinatura"
      ? { name: "Imagem PNG", extensions: ["png"] }
      : { name: "Imagens", extensions: ["png", "jpg", "jpeg", "gif"] };
  const caminho = await openDialog({ multiple: false, filters: [filtro] });
  if (!caminho || Array.isArray(caminho)) return;
  try {
    const imagem = await readImageAsDataUrl(caminho);
    await salvarLayout({ ...layout.value, [campo]: imagem });
  } catch (error) {
    erroLayout.value = `Não foi possível carregar a imagem: ${error instanceof Error ? error.message : error}`;
  }
}

function removerImagem(campo: CampoImagem) {
  salvarLayout({ ...layout.value, [campo]: null });
}

function trocarTextoTopo(evento: Event) {
  const valor = (evento.target as HTMLSelectElement).value === "ESCURO" ? "ESCURO" : "CLARO";
  salvarLayout({ ...layout.value, textoTopo: valor });
}

// Margem menor que a dos relatórios: com 8 mm cabem 5 carteirinhas de
// altura numa folha A4 (5 × 54 mm + 4 × 1,5 mm = 276 mm ≤ 281 mm úteis).
const { imprimir } = usePaginaImpressao("PADRAO", { margem: "8mm" });

/** Carta (279 mm) só tem altura pra 4 fileiras; A4 e Ofício, 5. */
async function lerParesPorFolha(): Promise<number> {
  try {
    return (await getPrintConfig()).default_paper === "CARTA" ? 4 : 5;
  } catch {
    return 5; // Sem config (ex.: só o Vite): A4, como `usePaginaImpressao`.
  }
}

onMounted(async () => {
  try {
    const associationId = getCurrentAssociationId();
    const [dadosAssociacao, dadosEndereco, dadosSocios, dadosLayout, porFolha] = await Promise.all([
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
      MemberModel.listarParaCarteirinha(filtro, ordem),
      CarteirinhaLayoutModel.get(),
      lerParesPorFolha(),
    ]);
    associacao.value = dadosAssociacao;
    endereco.value = dadosEndereco;
    socios.value = dadosSocios;
    paresPorFolha.value = porFolha;
    layout.value = dadosLayout;
    cores.value = { corPrincipal: dadosLayout.corPrincipal, corCampos: dadosLayout.corCampos };
    textoVerso.value = dadosLayout.textoVerso;
  } catch (error) {
    erro.value = `Não foi possível montar as carteirinhas: ${error instanceof Error ? error.message : error}`;
    return;
  } finally {
    loading.value = false;
  }

  if (socios.value.length === 0) return;

  const unico = socios.value.length === 1 && "ids" in filtro ? socios.value[0] : null;
  await ActivityLogModel.registrar(
    unico
      ? {
          module: "SOCIOS",
          description: `Carteirinha do sócio gerada para impressão — ${unico.full_name} (matrícula ${unico.registration_number}), ${validadeTexto}`,
          entity_type: "MEMBER",
          entity_id: unico.id,
        }
      : {
          module: "SOCIOS",
          description: `Carteirinhas geradas para impressão — ${socios.value.length} sócio(s), ${
            "ids" in filtro
              ? "escolhidos na lista"
              : filtro.situacao
                ? `situação ${ROTULO_SITUACAO_SOCIO[filtro.situacao]}`
                : "todas as situações"
          }, ${validadeTexto}`,
        }
  );

  await nextTick();
  imprimir();
});
</script>

<template>
  <section class="content imprimir-carteirinhas">
    <div v-if="loading" class="state-msg">Carregando...</div>
    <p v-else-if="erro" class="state-msg">{{ erro }}</p>

    <template v-else>
      <div class="no-print action-bar">
        <p class="resumo">
          {{ socios.length }} carteirinha(s) · {{ validadeTexto }} · {{ folhas.length }} folha(s)
        </p>
        <button type="button" class="btn-secondary" @click="router.back()">Voltar</button>
        <button type="button" class="btn-primary" :disabled="socios.length === 0" @click="imprimir">Imprimir</button>
      </div>

      <div class="no-print barra-fundo">
        <span class="barra-rotulo">Logo (verso)</span>
        <button type="button" class="btn-secondary" :disabled="salvandoLayout" @click="escolherImagem('logo')">
          {{ layout.logo ? "Trocar logo..." : "Escolher logo..." }}
        </button>
        <button
          v-if="layout.logo"
          type="button"
          class="btn-secondary"
          :disabled="salvandoLayout"
          @click="removerImagem('logo')"
        >
          Remover logo
        </button>
        <span class="barra-separador"></span>
        <span class="barra-rotulo">Assinatura do presidente</span>
        <button type="button" class="btn-secondary" :disabled="salvandoLayout" @click="escolherImagem('assinatura')">
          {{ layout.assinatura ? "Trocar PNG..." : "Escolher PNG..." }}
        </button>
        <button
          v-if="layout.assinatura"
          type="button"
          class="btn-secondary"
          :disabled="salvandoLayout"
          @click="removerImagem('assinatura')"
        >
          Assinar à caneta
        </button>
        <label class="barra-campo">
          <input type="checkbox" :checked="layout.mostrarRodape" :disabled="salvandoLayout" @change="trocarRodape" />
          Endereço e contato no verso
        </label>
        <label class="barra-campo barra-texto">
          Frase do verso
          <input
            v-model="textoVerso"
            type="text"
            :maxlength="TEXTO_VERSO_MAXIMO"
            placeholder="Em branco = sem frase"
            :disabled="salvandoLayout"
            @change="salvarTextoVerso"
          />
        </label>
        <button
          v-if="textoVerso !== TEXTO_VERSO_PADRAO"
          type="button"
          class="btn-secondary"
          :disabled="salvandoLayout"
          @click="restaurarTextoVerso"
        >
          Frase padrão
        </button>
        <span class="barra-separador"></span>
        <span class="barra-rotulo">Fundo (frente)</span>
        <button type="button" class="btn-secondary" :disabled="salvandoLayout" @click="escolherImagem('imagemFundo')">
          {{ layout.imagemFundo ? "Trocar imagem..." : "Escolher imagem..." }}
        </button>
        <button
          v-if="layout.imagemFundo"
          type="button"
          class="btn-secondary"
          :disabled="salvandoLayout"
          @click="removerImagem('imagemFundo')"
        >
          Usar fundo padrão
        </button>
        <label v-if="layout.imagemFundo" class="barra-campo">
          Texto do topo
          <select :value="layout.textoTopo" :disabled="salvandoLayout" @change="trocarTextoTopo">
            <option value="CLARO">Claro (fundo escuro)</option>
            <option value="ESCURO">Escuro (fundo claro)</option>
          </select>
        </label>
        <span class="barra-separador"></span>
        <span class="barra-rotulo">Cores</span>
        <label class="barra-campo" :title="layout.imagemFundo ? 'Com imagem de fundo, vale só para os rótulos' : ''">
          Principal
          <input
            v-model="cores.corPrincipal"
            type="color"
            class="seletor-cor"
            :disabled="salvandoLayout"
            @change="salvarCores"
          />
        </label>
        <label v-if="!layout.imagemFundo" class="barra-campo">
          Campos
          <input v-model="cores.corCampos" type="color" class="seletor-cor" :disabled="salvandoLayout" @change="salvarCores" />
        </label>
        <button
          v-if="!coresSaoPadrao"
          type="button"
          class="btn-secondary"
          :disabled="salvandoLayout"
          @click="restaurarCores"
        >
          Cores padrão
        </button>
        <p class="barra-dica">
          O verso traz a logo (de preferência PNG com fundo transparente; sem logo, sai o nome da associação) e a
          assinatura do presidente: com um PNG de fundo transparente ela já sai impressa sobre a linha; sem ele, a
          linha fica em branco para assinar à caneta. Embaixo saem a data de emissão (hoje), a frase (até 2 linhas) e,
          se marcado, o endereço e o contato da associação. Imagem de fundo ideal: 1011 × 638 px (proporção do
          cartão, 300 dpi). Tudo fica salvo para esta associação.
        </p>
        <p class="barra-dica">
          Cada fileira tem a frente e o verso do mesmo sócio: recorte o contorno do par, dobre na linha tracejada e
          cole (ou plastifique).
        </p>
        <p v-if="erroLayout" class="erro-layout">{{ erroLayout }}</p>
      </div>

      <p v-if="socios.length === 0" class="state-msg">Nenhum sócio para gerar carteirinha.</p>

      <template v-else>
        <div v-for="(folha, indice) in folhas" :key="indice" class="folha" :class="{ quebra: indice < folhas.length - 1 }">
          <p v-if="folhas.length > 1" class="no-print titulo-folha">Folha {{ indice + 1 }}</p>
          <!-- Um par por fileira: frente à esquerda, verso à direita, colados pela dobra. -->
          <div v-for="socio in folha" :key="socio.id" class="par">
            <CarteirinhaSocio
              v-for="lado in LADOS"
              :key="lado"
              :lado="lado"
              :socio="socio"
              :associacao="associacao"
              :endereco="endereco"
              :emissao="emissao"
              :layout="aparencia"
              :validade="validade"
            />
          </div>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
/* O visual do cartão (cores, frente, verso) fica em `CarteirinhaSocio.vue`. */
.imprimir-carteirinhas {
  max-width: 100%;
}

.action-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1.5rem;
}

.resumo {
  flex: 1;
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-muted);
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

.btn-primary:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.barra-fundo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  margin: -0.75rem 0 1.5rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

.barra-rotulo {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text);
}

.barra-campo {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.barra-campo select {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.barra-texto input {
  width: 22rem;
  max-width: 60vw;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.barra-separador {
  width: 1px;
  align-self: stretch;
  margin: 0 0.3rem;
  background: var(--border);
}

.seletor-cor {
  width: 2.2rem;
  height: 1.8rem;
  padding: 0.1rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  cursor: pointer;
}

.barra-dica {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.erro-layout {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.82rem;
  color: #c0392b;
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}

/*
 * Uma `.folha` = uma página impressa (a quebra é explícita, `.quebra`),
 * com um `.par` por fileira. O par é um bloco comum (e não grid), porque a
 * quebra de página entre blocos funciona igual no WebView2 (Windows) e no
 * WebKitGTK (Linux). 5 fileiras × 54 mm + 4 × 2 mm = 278 mm ≤ 281 mm úteis
 * em A4 (com 3 mm de espaço já não cabia a 5ª fileira).
 */
.folha + .folha {
  margin-top: 1.5rem;
}

/* Frente + verso colados: 2 × 85,6 mm = 171,2 mm, centralizado na folha. */
.par {
  display: flex;
  width: 171.2mm;
  max-width: 100%;
  margin: 0 auto 2mm;
  break-inside: avoid;
  page-break-inside: avoid;
}

.par:last-child {
  margin-bottom: 0;
}

.par :deep(.carteirinha) {
  flex-shrink: 0;
  margin: 0;
}

/* Linha de dobra: borda tracejada entre os dois lados. */
.par :deep(.frente) {
  border-right: 0.3mm dashed #888;
}

.par :deep(.verso) {
  border-left: none;
}

.titulo-folha {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  line-height: 1.3;
  text-align: left;
  color: var(--text-muted);
}

@media print {
  .no-print {
    display: none !important;
  }

  .folha + .folha {
    margin-top: 0;
  }

  .folha.quebra {
    break-after: page;
    page-break-after: always;
  }
}
</style>
