<script setup lang="ts">
// Ficha cadastral do sócio pra impressão — os mesmos campos da aba Dados
// da ficha (`montarFichaSocio`, fonte única), inclusive os em branco ("—"),
// mais a foto de identificação. Aberta pelo botão "Imprimir ficha" da
// sidebar de SocioDetalhes.vue; mesmo padrão das outras telas de
// impressão: abre já mandando pra impressão do sistema.
import { nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MemberModel, type MemberComPessoa } from "../models/Member.js";
import { PersonModel } from "../models/Person.js";
import { MembershipPlanModel } from "../models/MembershipPlan.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { ActivityLogModel } from "../models/ActivityLog.js";
import { getCurrentAssociationId, currentMembershipMode } from "../composables/useCurrentAssociation.js";
import { usePaginaImpressao } from "../composables/usePaginaImpressao.js";
import { montarFichaSocio, type SecaoFicha } from "../utils/fichaSocio.js";
import { formatarData, hojeLocalIso } from "../utils/format.js";
import PrintHeader from "../components/PrintHeader.vue";

const route = useRoute();
const router = useRouter();
const memberId = String(route.params.id);

const associacao = ref<Association | null>(null);
const endereco = ref<Address | null>(null);
const socio = ref<MemberComPessoa | null>(null);
const secoes = ref<SecaoFicha[]>([]);
const loading = ref(true);
const erro = ref("");

const dataEmissao = formatarData(hojeLocalIso());

// Aplica o papel padrão de Configurações → Impressão (`@page`) e só então
// imprime. Margem maior que a dos relatórios (20 mm): ficha é documento de
// uma folha, compacto e com respiro nas bordas.
const { imprimir } = usePaginaImpressao("PADRAO", { margem: "20mm" });

onMounted(async () => {
  try {
    const associationId = getCurrentAssociationId();
    const [dadosAssociacao, dadosEndereco, dadosSocio] = await Promise.all([
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
      MemberModel.get(memberId),
    ]);
    associacao.value = dadosAssociacao;
    endereco.value = dadosEndereco;
    socio.value = dadosSocio;
    if (!dadosSocio) {
      erro.value = "Sócio não encontrado.";
      return;
    }

    const [pessoa, planos] = await Promise.all([
      PersonModel.get(dadosSocio.person_id),
      dadosSocio.membership_plan_id ? MembershipPlanModel.list() : Promise.resolve([]),
    ]);
    secoes.value = montarFichaSocio({
      socio: dadosSocio,
      pessoa,
      nomePlano: planos.find((plano) => plano.id === dadosSocio.membership_plan_id)?.name ?? null,
      modoMensalidade: currentMembershipMode.value,
    });
  } catch (error) {
    erro.value = `Não foi possível montar a ficha: ${error instanceof Error ? error.message : error}`;
    return;
  } finally {
    loading.value = false;
  }

  if (!socio.value) return;
  await ActivityLogModel.registrar({
    module: "SOCIOS",
    description: `Ficha do sócio impressa — ${socio.value.full_name} (matrícula ${socio.value.registration_number})`,
    entity_type: "MEMBER",
    entity_id: memberId,
  });

  await nextTick();
  imprimir();
});
</script>

<template>
  <section class="content imprimir-ficha">
    <div v-if="loading" class="state-msg">Carregando...</div>
    <p v-else-if="erro" class="state-msg">{{ erro }}</p>

    <template v-else-if="socio">
      <div class="no-print action-bar">
        <button type="button" class="btn-secondary" @click="router.back()">Voltar</button>
        <button type="button" class="btn-primary" @click="imprimir">Imprimir</button>
      </div>

      <header class="cabecalho">
        <PrintHeader v-if="associacao" :association="associacao" :address="endereco" />
        <h1>Ficha do sócio</h1>
        <p class="emissao">Emitido em {{ dataEmissao }}</p>
      </header>

      <div class="identificacao">
        <img v-if="socio.photo" :src="socio.photo" alt="Foto do sócio" class="foto" />
        <div v-else class="foto foto-vazia">Foto</div>
        <div class="identificacao-texto">
          <p class="nome">{{ socio.full_name }}</p>
          <p class="matricula">Matrícula {{ socio.registration_number }}</p>
        </div>
      </div>

      <section v-for="secao in secoes" :key="secao.titulo" class="secao">
        <h2>{{ secao.titulo }}</h2>
        <dl class="campos">
          <div v-for="campo in secao.campos" :key="campo.rotulo" class="campo">
            <dt>{{ campo.rotulo }}</dt>
            <dd :class="{ vazio: !campo.valor }">{{ campo.valor || "—" }}</dd>
          </div>
        </dl>
      </section>
    </template>
  </section>
</template>

<style scoped>
.imprimir-ficha {
  max-width: 100%;
}

.action-bar {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-bottom: 1.5rem;
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

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.cabecalho {
  text-align: center;
  margin-bottom: 0.8rem;
  border-bottom: 2px solid var(--text);
  padding-bottom: 0.6rem;
}

.cabecalho :deep(.print-header p) {
  font-size: 0.72rem;
}

.cabecalho :deep(.print-header .nome) {
  font-size: 0.85rem;
}

.cabecalho h1 {
  margin: 0.3rem 0 0;
  font-size: 1rem;
  color: var(--text);
}

.identificacao {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 0.8rem;
}

/* Proporção 3×4, como foto de documento (reduzida). */
.foto {
  width: 21mm;
  height: 28mm;
  object-fit: cover;
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.foto-vazia {
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
  font-size: 0.65rem;
  color: var(--text-muted);
}

.nome {
  margin: 0 0 0.15rem;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
}

.matricula {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.secao {
  margin-bottom: 0.7rem;
  break-inside: avoid;
}

.secao h2 {
  margin: 0 0 0.35rem;
  padding-bottom: 0.2rem;
  border-bottom: 1px solid var(--text-muted);
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text);
}

/* Duas colunas de campos; campo com texto longo quebra dentro da própria célula. */
.campos {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.25rem 1.25rem;
  margin: 0;
}

.campo {
  min-width: 0;
  padding-bottom: 0.15rem;
  border-bottom: 1px dotted var(--border);
}

.campo dt {
  font-size: 0.58rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.campo dd {
  margin: 0.05rem 0 0;
  font-size: 0.76rem;
  color: var(--text);
}

.campo dd.vazio {
  color: var(--text-muted);
}

.emissao {
  margin: 0.15rem 0 0;
  font-size: 0.7rem;
  color: var(--text-muted);
}

@media print {
  .no-print {
    display: none !important;
  }

  .cabecalho {
    border-bottom-color: #000;
  }

  .foto {
    border-color: #000;
  }

  .campo {
    border-bottom-color: #999;
  }
}
</style>
