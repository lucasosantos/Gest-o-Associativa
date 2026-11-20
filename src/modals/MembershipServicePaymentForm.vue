<script setup lang="ts">
// Pagar mensalidades com prestação de serviço (ver `MembershipServiceModel`):
// quantos meses o serviço vale, a partir de qual mês em aberto, o texto
// explicando o serviço e, opcional, o relatório em PDF. Sem dinheiro — nada
// entra no caixa.
import { computed, onMounted, ref } from "vue";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { MembershipServiceModel } from "../models/MembershipService.js";
import { MembershipPaymentModel } from "../models/MembershipPayment.js";
import { closeModal } from "../composables/useModal.js";
import { centavosParaReais, formatarCompetencia, formatarMoeda, hojeIso, reaisParaCentavos } from "../utils/format.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ memberId: string; fullName: string; onSaved?: () => void }>();

const disponiveis = ref<string[]>([]);
/** Valor de uma mensalidade em reais (campo editável; vem do valor mensal da associação/plano, se houver). */
const valorMensal = ref(0);
const valorMensalCentavos = computed(() => reaisParaCentavos(valorMensal.value || 0));
const competenciaInicial = ref("");
const quantidadeMeses = ref(1);
const dataServico = ref(hojeIso());
const descricao = ref("");
const aprovadoPor = ref("");
const pdfPath = ref("");
const loading = ref(true);
const saving = ref(false);
const erro = ref("");

const meses = computed(() =>
  MembershipServiceModel.mesesAQuitar(disponiveis.value, competenciaInicial.value, quantidadeMeses.value || 0)
);
const faltam = computed(() => Math.max(0, (quantidadeMeses.value || 0) - meses.value.length));
const nomeArquivo = computed(() => pdfPath.value.split(/[\\/]/).pop() ?? "");

onMounted(async () => {
  try {
    const [lista, valor] = await Promise.all([
      MembershipServiceModel.mesesDisponiveis(props.memberId),
      MembershipPaymentModel.valorMensalSugerido(props.memberId),
    ]);
    disponiveis.value = lista;
    valorMensal.value = centavosParaReais(valor);
    competenciaInicial.value = lista[0] ?? "";
  } catch (error) {
    erro.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
});

async function escolherPdf() {
  const escolhido = await openDialog({
    title: "Relatório da prestação de serviço (PDF)",
    multiple: false,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (typeof escolhido === "string") pdfPath.value = escolhido;
}

async function handleSubmit() {
  if (!Number.isInteger(quantidadeMeses.value) || quantidadeMeses.value < 1) {
    erro.value = "Informe quantos meses o serviço vale (1 ou mais).";
    return;
  }
  if (valorMensalCentavos.value <= 0) {
    erro.value = "Informe o valor da mensalidade — o serviço vale meses × esse valor.";
    return;
  }
  if (faltam.value > 0) {
    erro.value = "Não há meses em aberto suficientes a partir do mês escolhido.";
    return;
  }
  if (!descricao.value.trim()) {
    erro.value = "Explique como foi a prestação de serviço.";
    return;
  }
  saving.value = true;
  erro.value = "";
  try {
    await MembershipServiceModel.criar(props.memberId, {
      service_date: dataServico.value,
      start_month: competenciaInicial.value,
      months_count: quantidadeMeses.value,
      monthly_amount: valorMensalCentavos.value,
      description: descricao.value,
      approved_by: aprovadoPor.value,
      pdf_path: pdfPath.value || null,
    });
    props.onSaved?.();
    closeModal();
  } catch (error) {
    erro.value = `Não foi possível registrar: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="loading" class="state-msg">Carregando...</div>

  <form v-else class="servico-form" @submit.prevent="handleSubmit">
    <p class="context">
      {{ fullName }} — quita mensalidades com um serviço prestado à associação. <strong>Não entra dinheiro no caixa</strong>;
      fica o registro do serviço (e o relatório, se anexado).
    </p>

    <p v-if="erro" class="erro">{{ erro }}</p>

    <p v-if="disponiveis.length === 0" class="state-msg">Este sócio não tem mensalidade em aberto para quitar.</p>

    <template v-else>
      <div class="field-row">
        <div class="field">
          <label class="field-label" for="servico-meses">Quantos meses o serviço vale *</label>
          <input id="servico-meses" v-model.number="quantidadeMeses" type="number" min="1" max="60" :disabled="saving" required />
        </div>
        <div class="field">
          <label class="field-label" for="servico-valor">Valor da mensalidade (R$) *</label>
          <input
            id="servico-valor"
            v-model.number="valorMensal"
            type="number"
            step="0.01"
            min="0.01"
            :disabled="saving"
            required
          />
        </div>
        <div class="field">
          <label class="field-label" for="servico-inicio">A partir de *</label>
          <select id="servico-inicio" v-model="competenciaInicial" :disabled="saving">
            <option v-for="mes in disponiveis" :key="mes" :value="mes">{{ formatarCompetencia(mes) }}</option>
          </select>
        </div>
      </div>

      <p class="field-hint">
        Vai quitar: {{ meses.map((c) => formatarCompetencia(c)).join(", ") || "—" }}
        <template v-if="faltam > 0"> — <strong class="aviso">faltam {{ faltam }} mês(es) em aberto</strong></template>
        <template v-if="valorMensalCentavos > 0 && meses.length > 0">
          · valor do serviço: {{ meses.length }} × {{ formatarMoeda(valorMensalCentavos) }} =
          <strong>{{ formatarMoeda(valorMensalCentavos * meses.length) }}</strong> (não entra no caixa)
        </template>
      </p>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="servico-data">Data do serviço *</label>
          <input id="servico-data" v-model="dataServico" type="date" :disabled="saving" required />
        </div>
        <div class="field">
          <label class="field-label" for="servico-aprovado">Aprovado por</label>
          <input id="servico-aprovado" v-model="aprovadoPor" type="text" placeholder="Ex.: diretoria, presidente" :disabled="saving" />
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="servico-descricao">Como foi a prestação de serviço *</label>
        <textarea
          id="servico-descricao"
          v-model="descricao"
          rows="5"
          placeholder="Ex.: pintura do salão comunitário nos dias 10 e 11/11, com material da associação; serviço conferido pela diretoria."
          :disabled="saving"
        ></textarea>
      </div>

      <div class="field">
        <label class="field-label">Relatório em PDF (opcional)</label>
        <div class="file-picker">
          <button type="button" class="btn-secondary" :disabled="saving" @click="escolherPdf">Escolher PDF</button>
          <span class="file-name">{{ nomeArquivo || "Nenhum arquivo escolhido" }}</span>
          <button v-if="pdfPath" type="button" class="link-btn" :disabled="saving" @click="pdfPath = ''">Remover</button>
        </div>
        <p class="field-hint">Fica guardado em Documentos e na aba Documentos do sócio.</p>
      </div>

      <div class="save-row">
        <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
        <button type="submit" class="btn-primary" :disabled="saving || faltam > 0 || meses.length === 0">
          <Spinner v-if="saving" />
          {{ saving ? "Registrando..." : `Quitar ${meses.length} mês(es)` }}
        </button>
      </div>
    </template>
  </form>
</template>

<style scoped>
.servico-form {
  width: 520px;
  max-width: 100%;
}

.context {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.5;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.aviso {
  color: #c0392b;
}

.state-msg {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.field {
  margin-bottom: 0.9rem;
  flex: 1;
}

.field-row {
  display: flex;
  gap: 1rem;
}

.field-label {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
}

.field input,
.field select,
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

.field-hint {
  margin: -0.4rem 0 0.9rem;
  font-size: 0.78rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.file-picker {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.file-name {
  font-size: 0.8rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-btn {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 0.8rem;
  font-family: inherit;
  padding: 0;
}

.save-row {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
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

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
</style>
