<script setup lang="ts">
// Planos de mensalidade — só aparece no menu quando a associação está no
// modo "Múltiplos planos" (`Association.membership_mode`, ver
// `InstitutionalDataEditor.vue` e o filtro de `menuItems` em `App.vue`).
// Cada sócio é vinculado a um destes planos na própria ficha
// (`SocioForm.vue`); o valor sugerido nos pagamentos de mensalidade passa a
// vir do plano vinculado (`MembershipPaymentModel.valorMensalSugerido`).
import { onMounted, ref } from "vue";
import { MembershipPlanModel, type MembershipPlan } from "../models/MembershipPlan.js";
import { formatarMoeda } from "../utils/format.js";
import { openModal } from "../composables/useModal.js";
import { setSidebarTools } from "../composables/useSidebar.js";
import { useAssociationScopedData } from "../composables/useAssociationScopedData.js";
import MembershipPlanForm from "../modals/MembershipPlanForm.vue";

const planos = ref<MembershipPlan[]>([]);
const loading = ref(true);

async function carregar() {
  loading.value = true;
  try {
    planos.value = await MembershipPlanModel.list();
  } finally {
    loading.value = false;
  }
}

function abrirNovoPlano() {
  openModal({ title: "Novo plano", component: MembershipPlanForm, props: { onSaved: carregar } });
}

function abrirEditarPlano(plano: MembershipPlan) {
  openModal({ title: "Editar plano", component: MembershipPlanForm, props: { plano, onSaved: carregar } });
}

async function alterarStatus(plano: MembershipPlan) {
  await MembershipPlanModel.setActive(plano.id, plano.is_active === 0);
  await carregar();
}

useAssociationScopedData(carregar);

onMounted(() => {
  setSidebarTools([
    { group: "Planos", items: [{ id: "novo-plano", label: "Novo plano", icon: "plus", onClick: abrirNovoPlano }] },
  ]);
});
</script>

<template>
  <section class="content">
    <div class="page-header">
      <div>
        <h2>Planos</h2>
        <p>Planos de mensalidade — cada sócio é vinculado a um deles na própria ficha.</p>
      </div>
    </div>

    <div v-if="loading" class="state-msg">Carregando...</div>
    <p v-else-if="planos.length === 0" class="state-msg">Nenhum plano cadastrado ainda.</p>

    <table v-else class="data-table">
      <thead>
        <tr>
          <th>Nome</th>
          <th>Descrição</th>
          <th>Valor mensal</th>
          <th>Situação</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="plano in planos" :key="plano.id">
          <td>{{ plano.name }}</td>
          <td>{{ plano.description ?? "—" }}</td>
          <td>{{ formatarMoeda(plano.amount) }}</td>
          <td>
            <button type="button" class="link-btn" @click="alterarStatus(plano)">
              {{ plano.is_active ? "Ativo (desativar)" : "Inativo (ativar)" }}
            </button>
          </td>
          <td>
            <button type="button" class="link-btn" @click="abrirEditarPlano(plano)">Editar</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.data-table {
  width: 100%;
  max-width: 900px;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  font-size: 0.85rem;
}

.data-table th {
  text-align: left;
  padding: 0.65rem 0.9rem;
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--border);
}

.data-table td {
  padding: 0.6rem 0.9rem;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  vertical-align: top;
}

.data-table tr:last-child td {
  border-bottom: none;
}

.link-btn {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
</style>
