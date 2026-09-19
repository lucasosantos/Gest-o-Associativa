<script setup lang="ts">
// Lista de sócios aptos a votar (ex.: pauta de assembleia) — apto = situação
// ATIVO e nenhuma mensalidade vencida (mensalidade em dia). Aberta pelo botão
// da sidebar de Socios.vue; mesmo padrão das outras telas de impressão
// (ImprimirLivroProtocolo.vue): abre já mandando pra impressão do sistema.
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { MemberModel, type MemberComPessoa } from "../models/Member.js";
import { MembershipPaymentModel } from "../models/MembershipPayment.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { formatarData, formatarCpf } from "../utils/format.js";
import PrintHeader from "../components/PrintHeader.vue";

const router = useRouter();

const associacao = ref<Association | null>(null);
const endereco = ref<Address | null>(null);
const aptos = ref<MemberComPessoa[]>([]);
const loading = ref(true);

const dataEmissao = computed(() => formatarData(new Date().toISOString().slice(0, 10)));

function imprimir() {
  window.print();
}

onMounted(async () => {
  try {
    const associationId = getCurrentAssociationId();
    const [dadosAssociacao, dadosEndereco, todosSocios, inadimplentes] = await Promise.all([
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
      MemberModel.list(),
      MembershipPaymentModel.listarInadimplentesAtivos(),
    ]);
    associacao.value = dadosAssociacao;
    endereco.value = dadosEndereco;
    aptos.value = todosSocios
      .filter((socio) => socio.status === "ATIVO" && !inadimplentes.has(socio.id))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  } finally {
    loading.value = false;
  }

  await nextTick();
  imprimir();
});
</script>

<template>
  <section class="content imprimir-lista">
    <div v-if="loading" class="state-msg">Carregando...</div>

    <template v-else>
      <div class="no-print action-bar">
        <button type="button" class="btn-secondary" @click="router.back()">Voltar</button>
        <button type="button" class="btn-primary" @click="imprimir">Imprimir</button>
      </div>

      <header class="cabecalho">
        <PrintHeader v-if="associacao" :association="associacao" :address="endereco" />
        <h1>Sócios aptos a votar</h1>
        <p class="subtitulo">
          Situação Ativo e mensalidade em dia · {{ aptos.length }} sócio(s)
        </p>
        <p class="emissao">Emitido em {{ dataEmissao }}</p>
      </header>

      <p v-if="aptos.length === 0" class="state-msg">Nenhum sócio apto a votar no momento.</p>

      <table v-else class="tabela-impressao">
        <thead>
          <tr>
            <th class="col-numero">Nº</th>
            <th>Matrícula</th>
            <th>Nome</th>
            <th>CPF</th>
            <th class="col-assinatura">Assinatura</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(socio, indice) in aptos" :key="socio.id">
            <td class="col-numero">{{ indice + 1 }}</td>
            <td>{{ socio.registration_number }}</td>
            <td>{{ socio.full_name }}</td>
            <td>{{ socio.cpf ? formatarCpf(socio.cpf) : "—" }}</td>
            <td class="col-assinatura"></td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.imprimir-lista {
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
  margin-bottom: 1.5rem;
  border-bottom: 2px solid var(--text);
  padding-bottom: 1rem;
}

.cabecalho h1 {
  margin: 0 0 0.3rem;
  font-size: 1.3rem;
  color: var(--text);
}

.subtitulo {
  margin: 0 0 0.2rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.emissao {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.tabela-impressao {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.tabela-impressao th,
.tabela-impressao td {
  border: 1px solid var(--border);
  padding: 0.5rem 0.7rem;
  text-align: left;
  color: var(--text);
}

.tabela-impressao th {
  background: var(--surface-hover);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.col-numero {
  width: 3rem;
  text-align: center;
}

.col-assinatura {
  width: 30%;
}

@media print {
  .no-print {
    display: none !important;
  }

  .cabecalho {
    border-bottom-color: #000;
  }

  .tabela-impressao th,
  .tabela-impressao td {
    border-color: #000;
    color: #000;
  }

  .tabela-impressao th {
    background: none;
  }

  .tabela-impressao tr {
    break-inside: avoid;
  }
}
</style>
