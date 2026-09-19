<script setup lang="ts">
// Edita nome, local do arquivo e senha de uma associação já cadastrada
// (ver Configuracoes.vue). Trocar o local do arquivo exige reiniciar o
// app antes de a associação voltar a ficar utilizável — mesma limitação
// de cadastrar uma associação nova (ver AssociationForm.vue): o caminho
// novo ainda não foi registrado para migrations neste processo.
import { ref } from "vue";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  updateAssociation,
  setAssociationPassword,
  restartApp,
  type AssociationSummary,
} from "../services/config.js";
import { closeDatabase } from "../services/database.js";
import { currentAssociationConfigId, clearCurrentAssociation } from "../composables/useCurrentAssociation.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ association: AssociationSummary; onSaved?: () => void }>();

const name = ref(props.association.name);
const dbPath = ref(props.association.db_path);
const novaSenha = ref("");
const saving = ref(false);
const erro = ref("");
const precisaReiniciar = ref(false);

async function escolherLocal() {
  const picked = await saveDialog({
    title: "Selecione o novo local do banco desta associação",
    defaultPath: dbPath.value,
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
    const caminhoMudou = dbPath.value.trim() !== props.association.db_path;
    const associacaoEstaAtiva = currentAssociationConfigId.value === props.association.id;

    if (caminhoMudou && associacaoEstaAtiva) {
      // Fecha a conexão antes de mover o arquivo por baixo dela.
      await closeDatabase();
      clearCurrentAssociation();
    }

    await updateAssociation(props.association.id, name.value.trim(), caminhoMudou ? dbPath.value.trim() : null);

    if (novaSenha.value.trim()) {
      await setAssociationPassword(props.association.id, novaSenha.value.trim());
    }

    if (caminhoMudou) {
      precisaReiniciar.value = true;
    } else {
      props.onSaved?.();
      closeModal();
    }
  } catch (error) {
    erro.value = `Não foi possível salvar: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}

async function handleRemoverSenha() {
  saving.value = true;
  erro.value = "";
  try {
    await setAssociationPassword(props.association.id, null);
    props.onSaved?.();
    closeModal();
  } catch (error) {
    erro.value = `Não foi possível remover a senha: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form v-if="!precisaReiniciar" class="settings-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="name">Nome *</label>
      <input id="name" v-model="name" type="text" :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="db-path">Local do arquivo do banco</label>
      <div class="path-row">
        <input id="db-path" v-model="dbPath" type="text" :disabled="saving" />
        <button type="button" class="btn-secondary" :disabled="saving" @click="escolherLocal">Procurar...</button>
      </div>
      <p class="hint">Mudar o local exige reiniciar o app antes de a associação voltar a abrir.</p>
    </div>

    <div class="field">
      <label class="field-label" for="password">
        {{ association.has_password ? "Trocar senha" : "Definir senha" }} (opcional)
      </label>
      <input id="password" v-model="novaSenha" type="password" placeholder="Deixe em branco para não alterar" :disabled="saving" />
      <button v-if="association.has_password" type="button" class="link-btn" :disabled="saving" @click="handleRemoverSenha">
        Remover senha atual
      </button>
    </div>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Salvando..." : "Salvar" }}
      </button>
    </div>
  </form>

  <div v-else class="settings-form">
    <p class="sucesso">Local do banco atualizado.</p>
    <p class="hint">É preciso reiniciar o aplicativo antes de conseguir abrir essa associação de novo.</p>

    <div class="save-row">
      <button type="button" class="btn-secondary" @click="closeModal">Reiniciar depois</button>
      <button type="button" class="btn-primary" @click="restartApp">Reiniciar agora</button>
    </div>
  </div>
</template>

<style scoped>
.settings-form {
  min-width: 420px;
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
  margin: 0.35rem 0 0;
  color: var(--text-muted);
  font-size: 0.75rem;
  line-height: 1.4;
}

.link-btn {
  margin-top: 0.4rem;
  border: none;
  background: none;
  color: #c0392b;
  font-size: 0.78rem;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
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
