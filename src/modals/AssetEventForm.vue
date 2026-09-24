<script setup lang="ts">
// Um formulário só pra todos os eventos comuns da linha do tempo do bem
// (ver `AssetModel.registrarEvento`) — cada tipo mostra só os campos que
// usa. A descrição gravada é montada aqui a partir desses campos + a
// observação livre, pra linha do tempo ficar legível sem o usuário ter que
// redigir tudo ("Local: Sede → Secretaria — responsável: Ana → João").
import { computed, ref } from "vue";
import {
  AssetModel,
  ROTULO_CONSERVACAO,
  ROTULO_EVENTO_BEM,
  type Asset,
  type EstadoConservacao,
  type LancamentoCaixaBem,
  type NovoEventoBem,
} from "../models/Asset.js";
import { formatarData, hojeIso, reaisParaCentavos } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import CashEntryOption from "../components/CashEntryOption.vue";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ bem: Asset; tipo: NovoEventoBem["event_type"]; onSaved?: () => void }>();

const eventDate = ref(hojeIso());
const location = ref(props.bem.location ?? "");
const responsible = ref(props.bem.responsible ?? "");
/** Com quem/onde: oficina (manutenção) ou pessoa/entidade (empréstimo). */
const destino = ref("");
const previsaoDevolucao = ref("");
const condition = ref<EstadoConservacao>(props.bem.condition);
const custo = ref(0);
const observacao = ref("");
const lancamento = ref<LancamentoCaixaBem | null>(null);
const saving = ref(false);
const erro = ref("");

const rotuloObservacao = computed(
  () =>
    ({
      TRANSFERENCIA: "Motivo / observação",
      MANUTENCAO_ENVIO: "Problema / serviço a fazer *",
      MANUTENCAO_RETORNO: "Serviço realizado",
      EMPRESTIMO: "Finalidade / observação",
      DEVOLUCAO: "Observação",
      CONSERVACAO: "Motivo *",
      OCORRENCIA: "Descrição da ocorrência *",
    })[props.tipo]
);
const observacaoObrigatoria = computed(() => ["MANUTENCAO_ENVIO", "CONSERVACAO", "OCORRENCIA"].includes(props.tipo));
const mostraConservacao = computed(() => ["MANUTENCAO_RETORNO", "DEVOLUCAO", "CONSERVACAO"].includes(props.tipo));

function montarDescricao(): string {
  const partes: string[] = [];
  const bem = props.bem;
  switch (props.tipo) {
    case "TRANSFERENCIA":
      if (location.value.trim() !== (bem.location ?? "")) {
        partes.push(`Local: ${bem.location || "—"} → ${location.value.trim() || "—"}`);
      }
      if (responsible.value.trim() !== (bem.responsible ?? "")) {
        partes.push(`Responsável: ${bem.responsible || "—"} → ${responsible.value.trim() || "—"}`);
      }
      break;
    case "MANUTENCAO_ENVIO":
      if (destino.value.trim()) partes.push(`Enviado para ${destino.value.trim()}`);
      break;
    case "EMPRESTIMO":
      partes.push(`Emprestado para ${destino.value.trim()}`);
      if (previsaoDevolucao.value) partes.push(`devolução prevista para ${formatarData(previsaoDevolucao.value)}`);
      break;
  }
  if (mostraConservacao.value && condition.value !== bem.condition) {
    partes.push(`Conservação: ${ROTULO_CONSERVACAO[bem.condition]} → ${ROTULO_CONSERVACAO[condition.value]}`);
  }
  if (observacao.value.trim()) partes.push(observacao.value.trim());
  return partes.join(" — ") || ROTULO_EVENTO_BEM[props.tipo];
}

async function handleSubmit() {
  erro.value = "";
  if (!eventDate.value) {
    erro.value = "Informe a data.";
    return;
  }
  if (observacaoObrigatoria.value && !observacao.value.trim()) {
    erro.value = `Preencha o campo "${rotuloObservacao.value.replace(" *", "")}".`;
    return;
  }
  if (props.tipo === "EMPRESTIMO" && !destino.value.trim()) {
    erro.value = "Informe para quem o bem foi emprestado.";
    return;
  }
  if (
    props.tipo === "TRANSFERENCIA" &&
    location.value.trim() === (props.bem.location ?? "") &&
    responsible.value.trim() === (props.bem.responsible ?? "")
  ) {
    erro.value = "Altere o local e/ou o responsável.";
    return;
  }
  if (props.tipo === "CONSERVACAO" && condition.value === props.bem.condition) {
    erro.value = "Escolha um estado de conservação diferente do atual.";
    return;
  }

  saving.value = true;
  try {
    await AssetModel.registrarEvento(props.bem.id, {
      event_type: props.tipo,
      event_date: eventDate.value,
      description: montarDescricao(),
      location: props.tipo === "TRANSFERENCIA" ? location.value.trim() || null : undefined,
      responsible: props.tipo === "TRANSFERENCIA" ? responsible.value.trim() || null : undefined,
      condition: mostraConservacao.value ? condition.value : null,
      amount: props.tipo === "MANUTENCAO_RETORNO" && custo.value > 0 ? reaisParaCentavos(custo.value) : null,
      lancamento: props.tipo === "MANUTENCAO_RETORNO" && custo.value > 0 ? lancamento.value : null,
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
  <form class="event-form" @submit.prevent="handleSubmit">
    <p class="bem-info">{{ bem.name }} · nº {{ bem.asset_number }}</p>
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="event-date">Data *</label>
      <input id="event-date" v-model="eventDate" type="date" :min="bem.acquisition_date" :disabled="saving" required />
    </div>

    <template v-if="tipo === 'TRANSFERENCIA'">
      <div class="field">
        <label class="field-label" for="location">Novo local</label>
        <input id="location" v-model="location" type="text" :disabled="saving" />
      </div>
      <div class="field">
        <label class="field-label" for="responsible">Novo responsável</label>
        <input id="responsible" v-model="responsible" type="text" :disabled="saving" />
      </div>
    </template>

    <div v-if="tipo === 'MANUTENCAO_ENVIO' || tipo === 'EMPRESTIMO'" class="field">
      <label class="field-label" for="destino">
        {{ tipo === "EMPRESTIMO" ? "Emprestado para *" : "Oficina / técnico" }}
      </label>
      <input id="destino" v-model="destino" type="text" :disabled="saving" />
    </div>

    <div v-if="tipo === 'EMPRESTIMO'" class="field">
      <label class="field-label" for="previsao">Previsão de devolução</label>
      <input id="previsao" v-model="previsaoDevolucao" type="date" :min="eventDate" :disabled="saving" />
    </div>

    <div v-if="mostraConservacao" class="field">
      <label class="field-label" for="condition">
        {{ tipo === "CONSERVACAO" ? "Novo estado de conservação *" : "Estado de conservação" }}
      </label>
      <select id="condition" v-model="condition" :disabled="saving">
        <option v-for="(rotulo, valor) in ROTULO_CONSERVACAO" :key="valor" :value="valor">{{ rotulo }}</option>
      </select>
    </div>

    <div v-if="tipo === 'MANUTENCAO_RETORNO'" class="field">
      <label class="field-label" for="custo">Custo da manutenção (R$)</label>
      <input id="custo" v-model.number="custo" type="number" step="0.01" min="0" :disabled="saving" />
    </div>

    <CashEntryOption
      v-if="tipo === 'MANUTENCAO_RETORNO' && custo > 0"
      v-model="lancamento"
      label="Lançar o custo como despesa no caixa"
      :disabled="saving"
    />

    <div class="field">
      <label class="field-label" for="observacao">{{ rotuloObservacao }}</label>
      <textarea id="observacao" v-model="observacao" rows="3" :disabled="saving"></textarea>
    </div>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Registrando..." : "Registrar" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.event-form {
  width: 420px;
  max-width: 100%;
}

.bem-info {
  margin: 0 0 0.9rem;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.field {
  margin-bottom: 0.9rem;
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
