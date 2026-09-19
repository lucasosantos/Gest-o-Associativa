<script setup lang="ts">
// Impressão da declaração de associado — aberta logo depois de gerar o
// protocolo em `DeclaracaoForm.vue` (mesmo padrão de recibo/protocolo: cria
// primeiro, imprime depois) ou reaberta pelo botão "Imprimir" da lista de
// Protocolos (`Documentos.vue`, quando `document_type === 'DECLARACAO'`).
// A inadimplência já foi checada na criação (`DeclaracaoForm.vue`, ANTES de
// consumir número de protocolo) — reimpressão nunca bloqueia de novo, só
// mostra o que foi declarado na época.
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ProtocolEntryModel, type ProtocolEntryComLivro } from "../models/ProtocolEntry.js";
import { MemberModel, type MemberComPessoa } from "../models/Member.js";
import { PersonModel, type Person } from "../models/Person.js";
import { AddressModel, type Address } from "../models/Address.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { formatarCpf, formatarData, formatarDataPorExtenso } from "../utils/format.js";
import { flexionar } from "../utils/genero.js";
import { openModal } from "../composables/useModal.js";
import PrintHeader from "../components/PrintHeader.vue";
import DocumentUploadForm from "../modals/DocumentUploadForm.vue";

const route = useRoute();
const router = useRouter();
const protocoloId = String(route.params.id);

const protocolo = ref<ProtocolEntryComLivro | null>(null);
const socio = ref<MemberComPessoa | null>(null);
const pessoa = ref<Person | null>(null);
const enderecoSocio = ref<Address | null>(null);
const associacao = ref<Association | null>(null);
const enderecoAssociacao = ref<Address | null>(null);
const loading = ref(true);
const erro = ref("");

function flex(masculino: string, feminino: string): string {
  return flexionar(socio.value?.gender ?? null, masculino, feminino);
}

const numeroDeclaracao = computed(() => {
  if (!protocolo.value) return "";
  return `DECLARAÇÃO Nº ${String(protocolo.value.number).padStart(2, "0")} DE ${protocolo.value.year}`;
});

const nacionalidade = computed(() => {
  const valor = pessoa.value?.nationality ?? "";
  if (/^brasileir[oa]$/i.test(valor)) return flex("brasileiro", "brasileira");
  return valor.toLowerCase();
});

const enderecoTexto = computed(() => {
  const e = enderecoSocio.value;
  if (!e) return "";
  const partes = [`${e.street}${e.number ? `, ${e.number}` : ", S/N"}`, e.complement, e.district, `${e.city}/${e.state}`];
  return partes.filter(Boolean).join(", ");
});

const localDataEmissao = computed(() => {
  const cidade = enderecoAssociacao.value?.city;
  const uf = enderecoAssociacao.value?.state;
  const local = [cidade, uf].filter(Boolean).join("/");
  const data = protocolo.value ? formatarDataPorExtenso(protocolo.value.protocol_date) : "";
  return local ? `${local}, ${data}.` : `${data}.`;
});

function imprimir() {
  window.print();
}

function vincularComoDocumento() {
  if (!socio.value || !protocolo.value) return;
  openModal({
    title: "Vincular declaração como documento",
    component: DocumentUploadForm,
    props: {
      memberId: socio.value.id,
      tituloSugerido: numeroDeclaracao.value,
      dataSugerida: protocolo.value.protocol_date,
    },
  });
}

onMounted(async () => {
  try {
    const dadosProtocolo = await ProtocolEntryModel.get(protocoloId);
    if (!dadosProtocolo || !dadosProtocolo.member_id) {
      erro.value = "Declaração não encontrada.";
      return;
    }
    protocolo.value = dadosProtocolo;

    const associationId = getCurrentAssociationId();
    const [dadosSocio, dadosAssociacao, dadosEnderecoAssociacao] = await Promise.all([
      MemberModel.get(dadosProtocolo.member_id),
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
    ]);
    if (!dadosSocio) {
      erro.value = "Sócio da declaração não foi encontrado.";
      return;
    }
    socio.value = dadosSocio;
    associacao.value = dadosAssociacao;
    enderecoAssociacao.value = dadosEnderecoAssociacao;

    const [dadosPessoa, enderecos] = await Promise.all([
      PersonModel.get(dadosSocio.person_id),
      AddressModel.listByPerson(dadosSocio.person_id),
    ]);
    pessoa.value = dadosPessoa;
    enderecoSocio.value = enderecos[0] ?? null;
  } finally {
    loading.value = false;
  }

  if (!erro.value) {
    await nextTick();
    imprimir();
  }
});
</script>

<template>
  <section class="content imprimir-declaracao">
    <div v-if="loading" class="state-msg">Carregando...</div>
    <p v-else-if="erro" class="state-msg">{{ erro }}</p>

    <template v-else-if="protocolo && socio && pessoa && associacao">
      <div class="no-print action-bar">
        <button type="button" class="btn-secondary" @click="router.back()">Voltar</button>
        <button type="button" class="btn-secondary" @click="vincularComoDocumento">Vincular como documento</button>
        <button type="button" class="btn-primary" @click="imprimir">Imprimir</button>
      </div>

      <div class="declaracao">
        <header class="cabecalho">
          <PrintHeader :association="associacao" :address="enderecoAssociacao" />
        </header>

        <h1>{{ numeroDeclaracao }}</h1>

        <p class="corpo">
          Declaramos para os devidos fins de direito e a quem possa interessar que {{ flex("o Sr.", "a Sra.") }}
          <strong>{{ socio.full_name }}</strong>, {{ nacionalidade }}<template v-if="pessoa.profession">, {{ pessoa.profession }}</template>,
          <template v-if="pessoa.cpf">{{ flex("inscrito", "inscrita") }} no CPF/MF sob o nº {{ formatarCpf(pessoa.cpf) }}, </template>
          <template v-if="enderecoTexto">{{ flex("residente e domiciliado", "residente e domiciliada") }} no {{ enderecoTexto }}, </template>
          é {{ flex("ASSOCIADO", "ASSOCIADA") }} INTEGRANTE desta instituição ({{ associacao.legal_name }}), devidamente
          {{ flex("registrado", "registrada") }} sob o nº {{ socio.registration_number }}.
        </p>

        <p class="corpo">
          Atestamos ainda que {{ flex("o referido associado", "a referida associada") }} encontra-se
          {{ flex("admitido", "admitida") }} no quadro social desde: {{ formatarData(socio.association_date) }}, estando em
          pleno gozo de seus direitos estatutários e quite com suas obrigações administrativas e financeiras perante
          esta Associação até a presente data.
        </p>

        <p class="corpo">
          Por ser verdade, firmamos a presente declaração para que produza seus efeitos legais e administrativos.
        </p>

        <p class="local-data">{{ localDataEmissao }}</p>

        <div class="assinatura">
          <div class="linha-assinatura"></div>
          <p>Assinatura</p>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.imprimir-declaracao {
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

.declaracao {
  max-width: 680px;
  margin: 0 auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 2.5rem 3rem;
  background: var(--surface);
}

.cabecalho {
  margin-bottom: 1.5rem;
  border-bottom: 2px solid var(--text);
  padding-bottom: 1rem;
}

.declaracao h1 {
  text-align: center;
  margin: 0 0 1.75rem;
  font-size: 1.05rem;
  letter-spacing: 0.04em;
  color: var(--text);
}

.corpo {
  color: var(--text);
  font-size: 0.95rem;
  line-height: 1.9;
  text-align: justify;
  margin: 0 0 1.25rem;
}

.local-data {
  margin: 2rem 0 3rem;
  color: var(--text);
  font-size: 0.9rem;
}

.assinatura {
  text-align: center;
}

.linha-assinatura {
  border-top: 1px solid var(--text);
  width: 70%;
  margin: 0 auto 0.4rem;
}

.assinatura p {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8rem;
}

@media print {
  .no-print {
    display: none !important;
  }

  .declaracao {
    border-color: #000;
  }

  .cabecalho {
    border-bottom-color: #000;
  }

  .declaracao h1,
  .corpo,
  .local-data {
    color: #000;
  }

  .linha-assinatura {
    border-top-color: #000;
  }
}
</style>
