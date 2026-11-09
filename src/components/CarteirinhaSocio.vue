<script setup lang="ts">
// Um lado da carteirinha do sócio, no tamanho de cartão de crédito
// (ISO/IEC 7810 ID-1, 85,6 × 54 mm). Quem monta as folhas (ordem dos
// cartões, frente/verso) é `ImprimirCarteirinhas.vue`.
//
// - Frente: faixa com a associação e o título, foto 3×4, nome, matrícula,
//   associado desde, CPF, RG, nascimento e validade (só quando há data —
//   sem validade o campo nem aparece). Usa a imagem de fundo
//   personalizada, se houver.
// - Verso, de cima pra baixo: a logo da associação, centralizada (sem logo
//   cadastrada, o nome da associação no lugar); a linha de assinatura do
//   presidente — com a imagem PNG da assinatura sobre ela, se houver —; a
//   data de emissão; a frase configurável (aviso, benefícios...); e um
//   rodapé com endereço e contato da associação (pode ser desligado).
import { computed } from "vue";
import type { SocioCarteirinha } from "../models/Member.js";
import type { Association } from "../models/Association.js";
import type { Address } from "../models/Address.js";
import type { CarteirinhaLayout } from "../models/CarteirinhaLayout.js";
import { formatarCpf, formatarData } from "../utils/format.js";

const props = defineProps<{
  lado: "FRENTE" | "VERSO";
  socio: SocioCarteirinha;
  associacao: Association | null;
  /** Endereço principal da associação (rodapé do verso). */
  endereco: Address | null;
  /** Data de emissão já formatada (DD/MM/AAAA) — o dia em que a carteirinha foi gerada. */
  emissao: string;
  /** Layout salvo + edições em andamento (pré-visualização ao vivo). */
  layout: CarteirinhaLayout;
  /** Validade já formatada (DD/MM/AAAA); `null` = sem validade. */
  validade: string | null;
}>();

/** Nome curto (nome fantasia, se houver). */
const nomeAssociacao = computed(() => props.associacao?.trade_name || props.associacao?.legal_name || "");
/** Razão social embaixo do nome fantasia, só quando os dois existem e são diferentes. */
const razaoSocial = computed(() => {
  const a = props.associacao;
  return a?.trade_name && a.trade_name !== a.legal_name ? a.legal_name : "";
});

/** Ex.: "Rua das Flores, 10 · Centro · Maquiné - RS · CEP 95530-000". */
const enderecoTexto = computed(() => {
  const e = props.endereco;
  if (!e) return "";
  const rua = [e.street, e.number].filter(Boolean).join(", ");
  const cidade = [e.city, e.state].filter(Boolean).join(" - ");
  return [rua, e.district, cidade, e.zip_code ? `CEP ${e.zip_code}` : ""].filter(Boolean).join(" · ");
});
const contatoTexto = computed(() =>
  [props.associacao?.phone, props.associacao?.email, props.associacao?.website].filter(Boolean).join(" · ")
);
/** Rodapé só aparece ligado E com algo pra mostrar. */
const mostrarRodape = computed(() => props.layout.mostrarRodape && Boolean(enderecoTexto.value || contatoTexto.value));

const comFundo = computed(() => props.lado === "FRENTE" && Boolean(props.layout.imagemFundo));

const estilo = computed(() => ({
  "--cor-carteira": props.layout.corPrincipal,
  "--cor-carteira-clara": props.layout.corCampos,
  ...(comFundo.value ? { backgroundImage: `url("${props.layout.imagemFundo}")` } : {}),
}));
</script>

<template>
  <article
    class="carteirinha"
    :class="[
      lado === 'FRENTE' ? 'frente' : 'verso',
      { 'com-fundo': comFundo, 'texto-topo-escuro': comFundo && layout.textoTopo === 'ESCURO' },
    ]"
    :style="estilo"
  >
    <!-- ================= FRENTE ================= -->
    <template v-if="lado === 'FRENTE'">
      <header class="faixa">
        <div class="instituicao">
          <p class="inst-nome">{{ nomeAssociacao }}</p>
          <p v-if="razaoSocial" class="inst-linha">{{ razaoSocial }}</p>
          <p v-if="associacao?.cnpj" class="inst-linha">CNPJ {{ associacao.cnpj }}</p>
        </div>
        <p class="titulo">Carteira de<br />Associado</p>
      </header>

      <div class="corpo">
        <img v-if="socio.photo" :src="socio.photo" alt="" class="foto" />
        <div v-else class="foto foto-vazia">Foto<br />3×4</div>

        <dl class="campos">
          <div class="campo campo-largo">
            <dt>Nome</dt>
            <dd class="nome">{{ socio.full_name }}</dd>
          </div>
          <div class="campo">
            <dt>Matrícula</dt>
            <dd>{{ socio.registration_number }}</dd>
          </div>
          <div class="campo">
            <dt>Associado desde</dt>
            <dd>{{ formatarData(socio.association_date) }}</dd>
          </div>
          <div class="campo">
            <dt>CPF</dt>
            <dd>{{ socio.cpf ? formatarCpf(socio.cpf) : "—" }}</dd>
          </div>
          <div class="campo">
            <dt>RG</dt>
            <dd>{{ socio.rg || "—" }}</dd>
          </div>
          <div class="campo">
            <dt>Nascimento</dt>
            <dd>{{ socio.birth_date ? formatarData(socio.birth_date) : "—" }}</dd>
          </div>
          <div v-if="validade" class="campo">
            <dt>Validade</dt>
            <dd>{{ validade }}</dd>
          </div>
        </dl>
      </div>

      <footer class="filete"></footer>
    </template>

    <!-- ================= VERSO: logo + assinatura do presidente ================= -->
    <template v-else>
      <div class="verso-logo">
        <img v-if="layout.logo" :src="layout.logo" alt="" class="logo" />
        <p v-else class="verso-nome">{{ associacao?.legal_name }}</p>
      </div>
      <div class="assinatura-presidente">
        <!-- Área de altura fixa: com ou sem imagem, a linha fica no mesmo lugar. -->
        <div class="assinatura-area">
          <img v-if="layout.assinatura" :src="layout.assinatura" alt="" class="assinatura-img" />
        </div>
        <span class="assinatura-rotulo">Assinatura do presidente</span>
      </div>
      <p class="emissao">Emitida em {{ emissao }}</p>
      <p v-if="layout.textoVerso.trim()" class="texto-verso">{{ layout.textoVerso }}</p>
      <footer v-if="mostrarRodape" class="rodape-verso">
        <p v-if="enderecoTexto">{{ enderecoTexto }}</p>
        <p v-if="contatoTexto">{{ contatoTexto }}</p>
      </footer>
      <!-- Sem rodapé, um respiro embaixo pra frase não encostar na borda. -->
      <div v-else class="respiro"></div>
    </template>
  </article>
</template>

<style scoped>
/*
 * Cores próprias da carteirinha (`--cor-carteira`, `--cor-carteira-clara`),
 * vindas do layout salvo (`CarteirinhaLayoutModel`, padrão = verde do tema
 * claro). Não usam os tokens do app de propósito: o `@media print` de
 * App.vue troca `--accent` por preto pra relatório sair sóbrio, mas a
 * carteirinha é colorida.
 */
.carteirinha {
  display: inline-flex;
  flex-direction: column;
  vertical-align: top;
  box-sizing: border-box;
  width: 85.6mm;
  height: 54mm;
  overflow: hidden;
  border: 0.3mm solid #b5b5b5;
  /* Cantos retos (90°), a pedido — inclusive foto e caixas de dados. */
  border-radius: 0;
  background: #fff;
  color: #1a1a1a;
  font-family: inherit;
  line-height: 1.2;
  text-align: left;
  break-inside: avoid;
  page-break-inside: avoid;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.carteirinha p,
.carteirinha dl,
.carteirinha dd {
  margin: 0;
}

/* --- Frente: faixa colorida com associação e título --- */
.faixa {
  display: flex;
  align-items: center;
  gap: 2mm;
  height: 15mm;
  flex-shrink: 0;
  padding: 1.5mm 3mm;
  box-sizing: border-box;
  /* Cor sólida de reserva pra WebKitGTK antigo, sem `color-mix`. */
  background: var(--cor-carteira);
  background: linear-gradient(115deg, var(--cor-carteira) 62%, color-mix(in srgb, var(--cor-carteira) 75%, #fff));
  color: #fff;
}

.instituicao {
  flex: 1;
  min-width: 0;
}

.inst-nome {
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  line-height: 1.1;
  /* Nome muito longo: no máximo 2 linhas. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.inst-linha {
  font-size: 5pt;
  opacity: 0.92;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.titulo {
  flex-shrink: 0;
  font-size: 8pt;
  font-weight: 700;
  text-align: right;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  line-height: 1.1;
}

/* --- Frente: foto e dados --- */
.corpo {
  flex: 1;
  display: flex;
  gap: 2mm;
  min-height: 0;
  padding: 2.2mm 3mm 0;
}

/* Proporção 3×4, como foto de documento. */
.foto {
  flex-shrink: 0;
  width: 22mm;
  height: 29.3mm;
  object-fit: cover;
  border: 0.3mm solid var(--cor-carteira);
}

.foto-vazia {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-style: dashed;
  font-size: 6pt;
  text-align: center;
  color: #777;
}

.campos {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-content: start;
  /* Compacto: nome + até 3 fileiras de 2 campos ao lado da foto. */
  gap: 0.9mm 1.2mm;
}

.campo {
  min-width: 0;
  padding: 0.4mm 1.1mm 0.5mm;
  background: var(--cor-carteira-clara);
}

.campo-largo {
  grid-column: 1 / -1;
}

.campo dt {
  font-size: 4.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--cor-carteira);
}

.campo dd {
  font-size: 7pt;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Nome: até 2 linhas. */
.campo dd.nome {
  font-size: 7.5pt;
  font-weight: 700;
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.filete {
  flex-shrink: 0;
  height: 1.6mm;
  background: var(--cor-carteira);
}

/*
 * --- Frente com imagem de fundo personalizada ---
 * A imagem cobre o cartão inteiro (a arte da associação já traz faixa,
 * logo etc.): some a faixa colorida e o filete, e os campos ganham fundo
 * branco translúcido pra continuarem legíveis sobre qualquer imagem.
 */
.carteirinha.com-fundo {
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.com-fundo .faixa {
  background: none;
  text-shadow: 0 0 0.6mm rgba(0, 0, 0, 0.45);
}

.com-fundo.texto-topo-escuro .faixa {
  color: #1a1a1a;
  text-shadow: 0 0 0.6mm rgba(255, 255, 255, 0.7);
}

.com-fundo .campo,
.com-fundo .foto-vazia {
  background: rgba(255, 255, 255, 0.82);
}

.com-fundo .filete {
  background: transparent;
}

/* --- Verso: logo centralizada no fundo branco + assinatura embaixo --- */
.verso-logo {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 2.5mm 8mm 1mm;
}

/* Logo inteira (sem cortar), proporção preservada, no espaço acima da assinatura. */
.logo {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.assinatura-presidente {
  flex-shrink: 0;
  align-self: center;
  width: 45mm;
  text-align: center;
}

/* A imagem "pousa" na linha (base da área), como uma assinatura de caneta. */
.assinatura-area {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  height: 8mm;
  border-bottom: 0.2mm solid #555;
}

.assinatura-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.assinatura-rotulo {
  display: block;
  padding-top: 0.5mm;
  font-size: 4.8pt;
  color: #555;
}

.emissao {
  flex-shrink: 0;
  margin-top: 0.6mm !important;
  font-size: 4.5pt;
  text-align: center;
  color: #777;
}

/* Até 2 linhas, centralizada, em itálico. */
.texto-verso {
  flex-shrink: 0;
  margin: 0.8mm 5mm 0 !important;
  font-size: 4.8pt;
  font-style: italic;
  line-height: 1.25;
  text-align: center;
  color: #444;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rodape-verso {
  flex-shrink: 0;
  margin-top: 1.2mm;
  padding: 0.8mm 3mm 1mm;
  border-top: 0.3mm solid var(--cor-carteira);
  background: var(--cor-carteira-clara);
  font-size: 4.5pt;
  line-height: 1.3;
  text-align: center;
  color: #333;
}

.rodape-verso p {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.respiro {
  flex-shrink: 0;
  height: 2mm;
}

.verso-nome {
  font-size: 10pt;
  font-weight: 700;
  line-height: 1.25;
  text-align: center;
  text-transform: uppercase;
  color: var(--cor-carteira);
}

@media print {
  /* As regras globais de impressão (App.vue) quebram texto em qualquer
     ponto; na carteirinha o corte é por reticências/limite de linhas. */
  .carteirinha p,
  .carteirinha dd {
    overflow-wrap: normal;
  }

  .carteirinha img {
    max-width: none;
  }
}
</style>
