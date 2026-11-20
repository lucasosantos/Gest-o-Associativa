<script setup lang="ts">
// Detalhe de uma prestação de serviço que pagou mensalidades: o texto do
// serviço, os meses quitados, o PDF do relatório (se houver) e o "Desfazer"
// (meses voltam a ficar em aberto, com motivo em Atividades).
import { computed, onMounted, ref } from "vue";
import { MembershipServiceModel, type MembershipServiceComDetalhes } from "../models/MembershipService.js";
import { abrirArquivoDocumento } from "../services/documentFiles.js";
import { closeModal } from "../composables/useModal.js";
import { centavosParaReais, formatarCompetencia, formatarData, formatarMoeda, reaisParaCentavos } from "../utils/format.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ serviceId: string; onSaved?: () => void }>();

const servico = ref<MembershipServiceComDetalhes | null>(null);
const carregando = ref(true);
const mostrarDesfazer = ref(false);
const motivo = ref("");
const salvando = ref(false);
const erro = ref("");
const editandoValor = ref(false);
/** Valor de uma mensalidade em reais, no campo de correção. */
const novoValorMensal = ref(0);

const valorMensalAtual = computed(() =>
  servico.value && servico.value.months_count > 0
    ? Math.round(servico.value.reference_amount / servico.value.months_count)
    : 0
);

async function carregar() {
  servico.value = await MembershipServiceModel.get(props.serviceId);
}

function abrirEdicaoValor() {
  novoValorMensal.value = centavosParaReais(valorMensalAtual.value);
  editandoValor.value = true;
}

async function salvarValor() {
  const centavos = reaisParaCentavos(novoValorMensal.value || 0);
  if (centavos <= 0) {
    erro.value = "Informe o valor da mensalidade (maior que zero).";
    return;
  }
  salvando.value = true;
  erro.value = "";
  try {
    await MembershipServiceModel.alterarValorMensal(props.serviceId, centavos);
    await carregar();
    editandoValor.value = false;
    props.onSaved?.();
  } catch (error) {
    erro.value = error instanceof Error ? error.message : String(error);
  } finally {
    salvando.value = false;
  }
}

onMounted(async () => {
  try {
    await carregar();
  } catch (error) {
    erro.value = error instanceof Error ? error.message : String(error);
  } finally {
    carregando.value = false;
  }
});

async function abrirPdf() {
  if (!servico.value?.document_storage_key) return;
  try {
    await abrirArquivoDocumento(servico.value.document_storage_key);
  } catch (error) {
    erro.value = `Não foi possível abrir o PDF: ${error instanceof Error ? error.message : error}`;
  }
}

async function desfazer() {
  if (!motivo.value.trim()) {
    erro.value = "Informe o motivo — ele fica registrado em Atividades.";
    return;
  }
  salvando.value = true;
  erro.value = "";
  try {
    await MembershipServiceModel.desfazer(props.serviceId, motivo.value);
    props.onSaved?.();
    closeModal();
  } catch (error) {
    erro.value = error instanceof Error ? error.message : String(error);
  } finally {
    salvando.value = false;
  }
}
</script>

<template>
  <div class="servico-detalhe">
    <p v-if="carregando" class="state-msg">Carregando...</p>
    <p v-else-if="!servico" class="state-msg">Prestação de serviço não encontrada.</p>

    <template v-else>
      <dl class="detalhes">
        <dt>Código</dt>
        <dd class="codigo">{{ servico.codigo }}</dd>
        <dt>Sócio</dt>
        <dd>{{ servico.full_name }} (matrícula {{ servico.registration_number }})</dd>
        <dt>Data do serviço</dt>
        <dd>{{ formatarData(servico.service_date) }}</dd>
        <dt>Meses quitados</dt>
        <dd>{{ servico.competence_months.map((c) => formatarCompetencia(c)).join(", ") || "—" }}</dd>
        <dt>Valor do serviço</dt>
        <dd>
          <template v-if="!editandoValor">
            <span v-if="servico.reference_amount > 0">
              {{ servico.months_count }} × {{ formatarMoeda(valorMensalAtual) }} =
              <strong>{{ formatarMoeda(servico.reference_amount) }}</strong> (não entra no caixa)
            </span>
            <span v-else class="aviso-valor">Sem valor informado</span>
            <button v-if="!mostrarDesfazer" type="button" class="link-btn" :disabled="salvando" @click="abrirEdicaoValor">
              {{ servico.reference_amount > 0 ? "Corrigir valor" : "Informar valor" }}
            </button>
          </template>
          <span v-else class="edicao-valor">
            <label for="valor-mensal">Mensalidade (R$)</label>
            <input id="valor-mensal" v-model.number="novoValorMensal" type="number" step="0.01" min="0.01" :disabled="salvando" />
            <span>× {{ servico.months_count }} = {{ formatarMoeda(reaisParaCentavos(novoValorMensal || 0) * servico.months_count) }}</span>
            <button type="button" class="link-btn" :disabled="salvando" @click="salvarValor">Salvar</button>
            <button type="button" class="link-btn" :disabled="salvando" @click="editandoValor = false">Cancelar</button>
          </span>
        </dd>
        <template v-if="servico.approved_by">
          <dt>Aprovado por</dt>
          <dd>{{ servico.approved_by }}</dd>
        </template>
      </dl>

      <h3 class="titulo">Como foi a prestação de serviço</h3>
      <p class="descricao">{{ servico.description }}</p>

      <div class="pdf">
        <button v-if="servico.document_storage_key" type="button" class="btn-secondary" @click="abrirPdf">
          Abrir relatório (PDF)
        </button>
        <span v-else class="state-msg">Sem relatório em PDF anexado.</span>
      </div>

      <div v-if="mostrarDesfazer" class="field">
        <label class="field-label" for="motivo-desfazer">Motivo para desfazer *</label>
        <textarea
          id="motivo-desfazer"
          v-model="motivo"
          rows="2"
          placeholder="Ex.: serviço não foi concluído / registrado no sócio errado"
          :disabled="salvando"
        ></textarea>
        <p class="aviso">
          Os {{ servico.competence_months.length }} mês(es) voltam a ficar em aberto. O PDF continua em Documentos.
        </p>
      </div>
    </template>

    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="salvando" @click="closeModal">Fechar</button>
      <button
        v-if="servico && !mostrarDesfazer && !editandoValor"
        type="button"
        class="btn-perigo"
        @click="mostrarDesfazer = true"
      >
        Desfazer prestação
      </button>
      <button v-if="servico && mostrarDesfazer" type="button" class="btn-perigo" :disabled="salvando" @click="desfazer">
        <Spinner v-if="salvando" />
        {{ salvando ? "Desfazendo..." : "Confirmar desfazer" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.servico-detalhe {
  width: 520px;
  max-width: 100%;
}

.state-msg {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.detalhes {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.35rem 1rem;
  margin: 0 0 1rem;
  font-size: 0.85rem;
}

.detalhes dt {
  font-weight: 600;
  color: var(--text-muted);
}

.detalhes dd {
  margin: 0;
}

.codigo {
  font-family: ui-monospace, monospace;
}

.link-btn {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 0.8rem;
  font-family: inherit;
  padding: 0;
  margin-left: 0.5rem;
}

.aviso-valor {
  color: #c0392b;
}

.edicao-valor {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.edicao-valor input {
  width: 7rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.titulo {
  margin: 0 0 0.35rem;
  font-size: 0.85rem;
}

.descricao {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  line-height: 1.5;
  white-space: pre-wrap;
}

.pdf {
  margin-bottom: 1rem;
}

.field-label {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
}

.field textarea {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
  box-sizing: border-box;
}

.aviso {
  margin: 0.35rem 0 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.erro {
  margin: 0.75rem 0 0;
  color: #c0392b;
  font-size: 0.82rem;
}

.save-row {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.btn-secondary,
.btn-perigo {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
}

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.btn-perigo {
  border: none;
  background: #c0392b;
  color: #fff;
}

.btn-secondary:disabled,
.btn-perigo:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
