<script setup lang="ts">
// Cadastra uma associação nova no config.json (nome, senha opcional e
// local do arquivo .db — ver src/services/config.ts). Os demais dados
// (endereço, contato...) são preenchidos depois, na aba "Instituição" da
// tela Início, já com essa associação selecionada.
//
// O arquivo .db dessa associação só fica utilizável depois de reiniciar o
// app: `tauri-plugin-sql` registra as migrations de cada banco por URL uma
// única vez, no início do processo (ver src-tauri/src/lib.rs) — uma
// associação criada em tempo de execução ainda não tem esse registro.
import { ref } from "vue";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { createAssociation, restartApp, type AssociationSummary } from "../services/config.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ onCreated?: (associacao: AssociationSummary) => void }>();

const name = ref("");
const password = ref("");
const dbPath = ref("");
const saving = ref(false);
const reiniciando = ref(false);
const erro = ref("");
const criada = ref<AssociationSummary | null>(null);

async function escolherLocal() {
  const picked = await saveDialog({
    title: "Selecione onde salvar o banco desta associação",
    defaultPath: dbPath.value || "lc3database.db",
    filters: [{ name: "Banco de dados SQLite", extensions: ["db"] }],
  });
  if (picked) dbPath.value = picked;
}

async function handleSubmit() {
  if (!name.value.trim()) {
    erro.value = "Informe o nome da associação.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    criada.value = await createAssociation(name.value.trim(), password.value.trim() || null, dbPath.value.trim() || null);
  } catch (error) {
    erro.value = `Não foi possível salvar: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}

async function handleRestart() {
  reiniciando.value = true;
  await restartApp();
}

function handleFecharSemReiniciar() {
  if (criada.value) props.onCreated?.(criada.value);
  closeModal();
}
</script>

<template>
  <form v-if="!criada" class="association-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="name">Nome da associação *</label>
      <input id="name" v-model="name" type="text" :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="password">Senha de acesso (opcional)</label>
      <input id="password" v-model="password" type="password" placeholder="Deixe em branco para não exigir senha" :disabled="saving" />
    </div>

    <div class="field">
      <label class="field-label" for="db-path">Local do arquivo do banco</label>
      <div class="path-row">
        <input id="db-path" v-model="dbPath" type="text" placeholder="Sugerido automaticamente se deixar em branco" :disabled="saving" />
        <button type="button" class="btn-secondary" :disabled="saving" @click="escolherLocal">Procurar...</button>
      </div>
    </div>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Salvando..." : "Salvar" }}
      </button>
    </div>
  </form>

  <div v-else class="association-form">
    <p class="sucesso">Associação "{{ criada.name }}" cadastrada.</p>
    <p class="hint">
      É preciso reiniciar o aplicativo antes de conseguir abrir essa associação — o arquivo do banco dela só é
      preparado (migrado) quando o programa inicia.
    </p>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="reiniciando" @click="handleFecharSemReiniciar">
        Reiniciar depois
      </button>
      <button type="button" class="btn-primary" :disabled="reiniciando" @click="handleRestart">
        <Spinner v-if="reiniciando" />
        {{ reiniciando ? "Reiniciando..." : "Reiniciar agora" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.association-form {
  min-width: 400px;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.sucesso {
  margin: 0 0 0.5rem;
  color: var(--text);
  font-weight: 600;
  font-size: 0.9rem;
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

.field input {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.field input:disabled {
  opacity: 0.6;
}

.path-row {
  display: flex;
  gap: 0.5rem;
}

.path-row input {
  flex: 1;
}

.hint {
  margin: 0 0 0.5rem;
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.5;
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
