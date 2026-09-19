<script setup lang="ts">
// Cabeçalho institucional padrão de toda tela de impressão — nome da
// associação, localização (a partir do endereço principal, se houver),
// data de fundação por extenso e CNPJ. Cada view de impressão busca
// `Association` e `AddressModel.primaryForAssociation` no mesmo
// `Promise.all` que já usa pra montar o resto da página, e encaixa este
// componente dentro do próprio `<header class="cabecalho">` — quem desenha
// a borda/espaçamento externo continua sendo a view, não este componente.
import { computed } from "vue";
import type { Association } from "../models/Association.js";
import type { Address } from "../models/Address.js";
import { formatarDataPorExtenso } from "../utils/format.js";

const props = defineProps<{
  association: Association;
  address?: Address | null;
}>();

const localizacao = computed(() => {
  const endereco = props.address;
  if (!endereco) return "";
  const cidadeUf = [endereco.city, endereco.state].filter(Boolean).join(" - ");
  return [endereco.district, cidadeUf].filter(Boolean).join(" - ");
});

const fundacao = computed(() => {
  if (!props.association.foundation_date) return "";
  return `Fundada em ${formatarDataPorExtenso(props.association.foundation_date)}`;
});
</script>

<template>
  <div class="print-header">
    <p class="nome">{{ association.legal_name }}</p>
    <p v-if="localizacao" class="localizacao">{{ localizacao }}</p>
    <p v-if="fundacao" class="fundacao">{{ fundacao }}</p>
    <p v-if="association.cnpj" class="cnpj">CNPJ: {{ association.cnpj }}</p>
  </div>
</template>

<style scoped>
.print-header {
  text-align: center;
}

.nome {
  margin: 0 0 0.2rem;
  font-weight: 600;
  color: var(--text);
  text-transform: uppercase;
}

.localizacao,
.fundacao {
  margin: 0 0 0.15rem;
  color: var(--text-muted);
  font-size: 0.8rem;
  text-transform: uppercase;
}

.cnpj {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8rem;
}

@media print {
  .nome {
    color: #000;
  }
}
</style>
