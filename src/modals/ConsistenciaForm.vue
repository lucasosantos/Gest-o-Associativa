<script setup lang="ts">
// Verificar consistência do financeiro (ver `ConsistenciaModel`): lista os
// problemas por grupo, o usuário marca o que corrigir e informa o motivo —
// cada correção vira uma linha em Atividades. Nada é corrigido sem marcar.
import { computed, onMounted, reactive, ref } from "vue";
import {
  ConsistenciaModel,
  INFO_PROBLEMA,
  type ProblemaConsistencia,
  type TipoProblema,
} from "../models/Consistencia.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ onSaved?: () => void }>();

const problemas = ref<ProblemaConsistencia[]>([]);
const marcados = reactive<Record<string, boolean>>({});
const motivo = ref("");
const carregando = ref(true);
const corrigindo = ref(false);
const erro = ref("");
const resultado = ref("");

const grupos = computed(() => {
  const porTipo = new Map<TipoProblema, ProblemaConsistencia[]>();
  for (const p of problemas.value) porTipo.set(p.tipo, [...(porTipo.get(p.tipo) ?? []), p]);
  return [...porTipo].map(([tipo, itens]) => ({ tipo, info: INFO_PROBLEMA[tipo], itens }));
});

const selecionados = computed(() => problemas.value.filter((p) => marcados[p.chave]));

async function verificar() {
  carregando.value = true;
  erro.value = "";
  try {
    problemas.value = await ConsistenciaModel.verificar();
    for (const chave of Object.keys(marcados)) delete marcados[chave];
  } catch (error) {
    erro.value = error instanceof Error ? error.message : String(error);
  } finally {
    carregando.value = false;
  }
}

function marcarGrupo(itens: ProblemaConsistencia[]) {
  const todos = itens.every((p) => marcados[p.chave]);
  for (const p of itens) marcados[p.chave] = !todos;
}

async function corrigir() {
  if (selecionados.value.length === 0) {
    erro.value = "Marque ao menos um item para corrigir.";
    return;
  }
  if (!motivo.value.trim()) {
    erro.value = "Informe o motivo — ele fica registrado em Atividades.";
    return;
  }
  corrigindo.value = true;
  erro.value = "";
  resultado.value = "";
  let feitos = 0;
  const falhas: string[] = [];
  // Um por vez, na ordem da lista (os grupos de cima destravam os de baixo).
  for (const problema of selecionados.value) {
    try {
      await ConsistenciaModel.corrigir(problema, motivo.value);
      feitos++;
    } catch (error) {
      falhas.push(`${problema.detalhe}: ${error instanceof Error ? error.message : error}`);
    }
  }
  corrigindo.value = false;
  resultado.value = `${feitos} item(ns) corrigido(s).`;
  if (falhas.length > 0) erro.value = `Não foi possível corrigir:\n${falhas.join("\n")}`;
  props.onSaved?.();
  await verificar();
}

onMounted(verificar);
</script>

<template>
  <div class="consistencia">
    <p class="aviso">
      Confere mensalidades, lançamentos, estornos, transferências e parcelas em busca do que ficou inconsistente
      (inclusive por versões antigas do sistema). <strong>Faça um backup antes de corrigir</strong> (Início → Backup).
      Só o que você marcar é corrigido, e cada correção fica registrada em Atividades com o motivo.
    </p>

    <p v-if="carregando" class="state-msg">Verificando...</p>
    <template v-else>
      <p v-if="resultado" class="ok">{{ resultado }}</p>
      <p v-if="problemas.length === 0" class="ok">Nenhuma inconsistência encontrada.</p>

      <section v-for="grupo in grupos" :key="grupo.tipo" class="grupo">
        <header class="grupo-cabecalho">
          <h3>{{ grupo.info.titulo }} ({{ grupo.itens.length }})</h3>
          <button type="button" class="link-btn" :disabled="corrigindo" @click="marcarGrupo(grupo.itens)">
            {{ grupo.itens.every((p) => marcados[p.chave]) ? "Desmarcar todos" : "Marcar todos" }}
          </button>
        </header>
        <p class="explicacao">{{ grupo.info.explicacao }}</p>
        <p class="explicacao"><strong>Correção:</strong> {{ grupo.info.correcao }}</p>
        <label v-for="item in grupo.itens" :key="item.chave" class="item">
          <input v-model="marcados[item.chave]" type="checkbox" :disabled="corrigindo" />
          <span>{{ item.detalhe }}</span>
        </label>
      </section>

      <div v-if="problemas.length > 0" class="field">
        <label class="field-label" for="motivo-consistencia">Motivo *</label>
        <textarea
          id="motivo-consistencia"
          v-model="motivo"
          rows="2"
          placeholder="Ex.: acerto do caixa conferido com o extrato do banco em 15/11"
          :disabled="corrigindo"
        ></textarea>
      </div>
    </template>

    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="corrigindo" @click="closeModal">Fechar</button>
      <button type="button" class="btn-secondary" :disabled="corrigindo || carregando" @click="verificar">
        Verificar de novo
      </button>
      <button
        v-if="problemas.length > 0"
        type="button"
        class="btn-primary"
        :disabled="corrigindo || selecionados.length === 0"
        @click="corrigir"
      >
        <Spinner v-if="corrigindo" />
        {{ corrigindo ? "Corrigindo..." : `Corrigir marcados (${selecionados.length})` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.consistencia {
  width: 720px;
  max-width: 100%;
}

.aviso {
  margin: 0 0 1rem;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--text-muted);
}

.state-msg {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.ok {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  color: var(--accent);
  font-weight: 600;
}

.erro {
  margin: 0.75rem 0 0;
  color: #c0392b;
  font-size: 0.8rem;
  white-space: pre-line;
}

.grupo {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem 0.9rem;
  margin-bottom: 0.85rem;
}

.grupo-cabecalho {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
}

.grupo-cabecalho h3 {
  margin: 0;
  font-size: 0.9rem;
}

.explicacao {
  margin: 0.35rem 0;
  font-size: 0.78rem;
  line-height: 1.4;
  color: var(--text-muted);
}

.item {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.3rem 0;
  font-size: 0.8rem;
  border-top: 1px solid var(--border);
  cursor: pointer;
}

.item input {
  margin-top: 0.15rem;
}

.link-btn {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 0.78rem;
  font-family: inherit;
  padding: 0;
  white-space: nowrap;
}

.field {
  margin-top: 1rem;
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
