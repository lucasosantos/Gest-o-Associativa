<script setup lang="ts">
// Ficha de sócio (criação/edição): reúne dados de `people` + `members` num
// formulário só (ver docs/plano-implementacao.md, Etapa 2). Era um modal
// (`MemberForm.vue`) e virou página a pedido do usuário — sem `:id` na
// rota, cria um sócio novo; com `:id`, carrega e edita o existente.
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { MemberModel } from "../models/Member.js";
import { PersonModel, type GeneroPessoa } from "../models/Person.js";
import { MembershipPlanModel, type MembershipPlan } from "../models/MembershipPlan.js";
import { currentMembershipMode, currentAutoRegistrationNumber } from "../composables/useCurrentAssociation.js";
import { readImageAsDataUrl } from "../services/personPhoto.js";
import Spinner from "../components/Spinner.vue";

const route = useRoute();
const router = useRouter();
const memberId = computed(() => (typeof route.params.id === "string" ? route.params.id : undefined));

const loading = ref(Boolean(memberId.value));
const saving = ref(false);
const erro = ref("");

const fullName = ref("");
const birthDate = ref("");
const nationality = ref("Brasileira");
const maritalStatus = ref("");
const cpf = ref("");
const rg = ref("");
const profession = ref("");
const motherName = ref("");
const fatherName = ref("");
const gender = ref<GeneroPessoa | "">("");
const photo = ref<string | null>(null);
const carregandoFoto = ref(false);

const registrationNumber = ref("");
const associationDate = ref("");
const observations = ref("");
const duesStartDate = ref("");

const membershipPlanId = ref("");
const planos = ref<MembershipPlan[]>([]);

/**
 * Matrícula continua editável na edição de um sócio já existente (correção
 * manual de um número gerado errado, por exemplo) — a numeração automática
 * (`Association.auto_registration_number`) só dispensa o campo na CRIAÇÃO.
 */
const matriculaManual = computed(() => Boolean(memberId.value) || !currentAutoRegistrationNumber.value);

onMounted(async () => {
  // Lista completa (não só ativos): o plano atual do sócio precisa continuar
  // aparecendo no dropdown mesmo se foi desativado depois de vinculado.
  if (currentMembershipMode.value === "MULTIPLO") {
    planos.value = await MembershipPlanModel.list();
  }

  if (!memberId.value) {
    loading.value = false;
    return;
  }

  try {
    const socio = await MemberModel.get(memberId.value);
    if (!socio) {
      erro.value = "Sócio não encontrado.";
      return;
    }
    fullName.value = socio.full_name;
    cpf.value = socio.cpf ?? "";
    gender.value = socio.gender ?? "";
    photo.value = socio.photo ?? null;

    // `MemberComPessoa` só traz nome/CPF/gênero/foto — o resto da pessoa
    // precisa vir de `people`, senão salvar a edição gravava esses campos
    // em branco (e a nacionalidade voltava pra "Brasileira").
    const pessoa = await PersonModel.get(socio.person_id);
    if (pessoa) {
      birthDate.value = pessoa.birth_date ?? "";
      nationality.value = pessoa.nationality || "Brasileira";
      maritalStatus.value = pessoa.marital_status ?? "";
      rg.value = pessoa.rg ?? "";
      profession.value = pessoa.profession ?? "";
      motherName.value = pessoa.mother_name ?? "";
      fatherName.value = pessoa.father_name ?? "";
    }
    registrationNumber.value = socio.registration_number;
    associationDate.value = socio.association_date;
    observations.value = socio.observations ?? "";
    duesStartDate.value = socio.dues_start_date ?? "";
    membershipPlanId.value = socio.membership_plan_id ?? "";
  } finally {
    loading.value = false;
  }
});

async function escolherFoto() {
  const caminho = await openDialog({
    multiple: false,
    filters: [{ name: "Imagens", extensions: ["png", "jpg", "jpeg", "gif"] }],
  });
  if (!caminho || Array.isArray(caminho)) return;

  carregandoFoto.value = true;
  erro.value = "";
  try {
    photo.value = await readImageAsDataUrl(caminho);
  } catch (error) {
    erro.value = `Não foi possível carregar a foto: ${error instanceof Error ? error.message : error}`;
  } finally {
    carregandoFoto.value = false;
  }
}

function removerFoto() {
  photo.value = null;
}

function cancelar() {
  if (memberId.value) router.push({ name: "socio-detalhes", params: { id: memberId.value } });
  else router.push({ name: "socios" });
}

async function handleSubmit() {
  if (!fullName.value.trim() || (matriculaManual.value && !registrationNumber.value.trim()) || !associationDate.value) {
    erro.value = "Preencha nome, matrícula e data de associação.";
    return;
  }
  if (duesStartDate.value && duesStartDate.value < associationDate.value) {
    erro.value = "A data da mensalidade legado não pode ser anterior à data de associação.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    const dados = {
      full_name: fullName.value.trim(),
      birth_date: birthDate.value || null,
      nationality: nationality.value.trim() || "Brasileira",
      marital_status: maritalStatus.value.trim() || null,
      cpf: cpf.value.trim() || null,
      rg: rg.value.trim() || null,
      profession: profession.value.trim() || null,
      mother_name: motherName.value.trim() || null,
      father_name: fatherName.value.trim() || null,
      gender: gender.value || null,
      photo: photo.value,
      // Sem matrícula manual (criação com numeração automática ligada),
      // omite o campo e deixa `MemberModel.create` gerar o número sozinho.
      registration_number: matriculaManual.value ? registrationNumber.value.trim() : undefined,
      association_date: associationDate.value,
      observations: observations.value.trim() || null,
      membership_plan_id: currentMembershipMode.value === "MULTIPLO" ? membershipPlanId.value || null : null,
      dues_start_date: duesStartDate.value || null,
    };

    if (memberId.value) {
      await MemberModel.update(memberId.value, dados);
      router.push({ name: "socio-detalhes", params: { id: memberId.value } });
    } else {
      const criado = await MemberModel.create(dados);
      router.push({ name: "socio-detalhes", params: { id: criado.id } });
    }
  } catch (error) {
    erro.value = `Não foi possível salvar: ${error instanceof Error ? error.message : error}`;
    saving.value = false;
  }
}
</script>

<template>
  <section class="content">
    <div class="breadcrumb">
      <button type="button" class="link-btn" @click="router.push({ name: 'socios' })">Sócios</button>
      <span class="sep">/</span>
      <span class="current">{{ memberId ? "Editar sócio" : "Novo sócio" }}</span>
    </div>

    <div class="page-header">
      <h2>{{ memberId ? "Editar sócio" : "Novo sócio" }}</h2>
    </div>

    <div v-if="loading" class="state-msg">Carregando...</div>

    <form v-else class="member-form" @submit.prevent="handleSubmit">
      <p v-if="erro" class="erro">{{ erro }}</p>

      <div class="photo-row">
        <img v-if="photo" :src="photo" alt="Foto do sócio" class="photo-preview" />
        <div v-else class="photo-placeholder">Sem foto</div>
        <div class="photo-actions">
          <button type="button" class="btn-secondary" :disabled="saving || carregandoFoto" @click="escolherFoto">
            {{ carregandoFoto ? "Carregando..." : "Escolher foto" }}
          </button>
          <button v-if="photo" type="button" class="btn-secondary" :disabled="saving" @click="removerFoto">
            Remover
          </button>
        </div>
      </div>

      <div class="field-grid">
        <div class="field full">
          <label class="field-label" for="full-name">Nome completo *</label>
          <input id="full-name" v-model="fullName" type="text" :disabled="saving" required />
        </div>

        <div class="field">
          <label class="field-label" for="registration-number">Matrícula{{ matriculaManual ? " *" : "" }}</label>
          <input
            id="registration-number"
            v-model="registrationNumber"
            type="text"
            :disabled="saving || !matriculaManual"
            :required="matriculaManual"
            :placeholder="matriculaManual ? '' : 'Gerada automaticamente ao salvar'"
          />
        </div>

        <div class="field">
          <label class="field-label" for="association-date">Data de associação *</label>
          <input id="association-date" v-model="associationDate" type="date" :disabled="saving" required />
        </div>

        <div class="field full">
          <label class="field-label" for="dues-start-date">Mensalidade legado (considerar a partir de)</label>
          <input
            id="dues-start-date"
            v-model="duesStartDate"
            type="date"
            :min="associationDate || undefined"
            :disabled="saving"
          />
          <p class="field-hint">
            Deixe em branco pra contar desde a data de associação (comportamento padrão). Preencha só se esta
            associação já recebeu e já usou mensalidades anteriores a esta data por fora do sistema: meses
            anteriores a ela deixam de contar como dívida e não impedem o sócio de aparecer como apto a votar.
          </p>
        </div>

        <div v-if="currentMembershipMode === 'MULTIPLO'" class="field">
          <label class="field-label" for="membership-plan">Plano de mensalidade</label>
          <select id="membership-plan" v-model="membershipPlanId" :disabled="saving">
            <option value="">Nenhum</option>
            <option v-for="plano in planos" :key="plano.id" :value="plano.id">
              {{ plano.name }}{{ plano.is_active ? "" : " (inativo)" }}
            </option>
          </select>
          <p v-if="!membershipPlanId" class="field-hint">
            Sem plano, o valor sugerido na mensalidade deste sócio fica zerado — defina um na aba Planos.
          </p>
        </div>

        <div class="field">
          <label class="field-label" for="birth-date">Data de nascimento</label>
          <input id="birth-date" v-model="birthDate" type="date" :disabled="saving" />
        </div>

        <div class="field">
          <label class="field-label" for="cpf">CPF</label>
          <input id="cpf" v-model="cpf" type="text" placeholder="000.000.000-00" :disabled="saving" />
        </div>

        <div class="field">
          <label class="field-label" for="rg">RG</label>
          <input id="rg" v-model="rg" type="text" :disabled="saving" />
        </div>

        <div class="field">
          <label class="field-label" for="marital-status">Estado civil</label>
          <input id="marital-status" v-model="maritalStatus" type="text" :disabled="saving" />
        </div>

        <div class="field">
          <label class="field-label" for="gender">Gênero</label>
          <select id="gender" v-model="gender" :disabled="saving">
            <option value="">Não informado</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="nationality">Nacionalidade</label>
          <input id="nationality" v-model="nationality" type="text" :disabled="saving" />
        </div>

        <div class="field">
          <label class="field-label" for="profession">Profissão</label>
          <input id="profession" v-model="profession" type="text" :disabled="saving" />
        </div>

        <div class="field">
          <label class="field-label" for="mother-name">Filiação 1 (mãe)</label>
          <input id="mother-name" v-model="motherName" type="text" :disabled="saving" />
        </div>

        <div class="field">
          <label class="field-label" for="father-name">Filiação 2 (pai)</label>
          <input id="father-name" v-model="fatherName" type="text" :disabled="saving" />
        </div>

        <div class="field full">
          <label class="field-label" for="observations">Observações</label>
          <textarea id="observations" v-model="observations" rows="2" :disabled="saving"></textarea>
        </div>
      </div>

      <div class="save-row">
        <button type="button" class="btn-secondary" :disabled="saving" @click="cancelar">Cancelar</button>
        <button type="submit" class="btn-primary" :disabled="saving">
          <Spinner v-if="saving" />
          {{ saving ? "Salvando..." : "Salvar" }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.link-btn {
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 0.78rem;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.link-btn:hover {
  color: var(--accent);
}

.member-form {
  max-width: 720px;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.photo-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.1rem;
}

.photo-preview,
.photo-placeholder {
  width: 84px;
  height: 84px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}

.photo-preview {
  border: 1px solid var(--border);
}

.photo-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border);
  color: var(--text-muted);
  font-size: 0.72rem;
  text-align: center;
  background: var(--surface);
}

.photo-actions {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  align-items: flex-start;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem 1rem;
}

.field.full {
  grid-column: 1 / -1;
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
  resize: vertical;
}

.field input:disabled,
.field select:disabled,
.field textarea:disabled {
  opacity: 0.6;
}

.field-hint {
  margin: 0.35rem 0 0;
  font-size: 0.76rem;
  color: var(--text-muted);
}

.save-row {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.5rem;
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
