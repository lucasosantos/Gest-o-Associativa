import { ref, watch } from "vue";
import { connectToAssociation } from "../services/database.js";
import { verifyAssociationPassword, type AssociationSummary } from "../services/config.js";
import { AssociationModel, type MembershipMode } from "../models/Association.js";
import { ParcelaModel } from "../models/Parcela.js";
import { ActivityLogModel } from "../models/ActivityLog.js";

/**
 * O app voltou a "1 arquivo `.db` por associação" (ver
 * docs/plano-implementacao.md, correção pós-MVP): cada entrada do
 * `config.json` (`AssociationSummary`) aponta para o seu próprio arquivo.
 * Esta composable guarda três coisas:
 * - `currentAssociationConfigId`: qual entrada do `config.json` está
 *   LEMBRADA (persistido em `localStorage`, pra sugerir a mesma na próxima
 *   vez) — isso é só uma preferência, não significa que o banco dela está
 *   de fato aberto agora (ex.: acabou de reiniciar o app e essa associação
 *   tem senha, então não reconecta sozinho).
 * - `isAssociationConnected`: se HOJE, nesta execução, o arquivo `.db`
 *   dessa entrada está realmente conectado (`connectToAssociation` já
 *   rodou com sucesso). É esse valor — não só o `currentAssociationConfigId`
 *   bater — que deve decidir se a tela mostra dashboard/formulário ou pede
 *   pra entrar de novo (ver `Inicio.vue`).
 * - `currentAssociationId`: o `id` da (única) linha de `associations`
 *   dentro do banco já conectado — `null` se o arquivo ainda estiver vazio
 *   (associação recém-criada, dados institucionais ainda não preenchidos)
 *   OU se não estiver conectado ainda (por isso não dá pra usar isso
 *   sozinho como sinal de conexão). Todo o filtro por `association_id`
 *   feito nos models de domínio continua usando este valor — como cada
 *   arquivo só tem mesmo uma linha agora, o filtro é sempre trivialmente
 *   verdadeiro, mas não precisou ser revertido.
 */
const CHAVE_ARMAZENAMENTO = "app:associacao-config-id";

function lerArmazenado(): string | null {
  try {
    return localStorage.getItem(CHAVE_ARMAZENAMENTO);
  } catch {
    return null;
  }
}

export const currentAssociationConfigId = ref<string | null>(lerArmazenado());
export const currentAssociationId = ref<string | null>(null);
/** Só fica `true` depois de um `selectAssociation` bem-sucedido nesta execução — ver nota acima. */
export const isAssociationConnected = ref(false);
/**
 * Modo de mensalidade da associação conectada (migration `version: 20`) —
 * só existe pra decidir, em tempo real, se a aba "Planos" aparece no menu
 * superior (ver `App.vue`) e o formulário de sócio mostra o seletor de
 * plano (ver `SocioForm.vue`). Espelha `Association.membership_mode`;
 * atualizado ao conectar (`selectAssociation`) e ao salvar os dados
 * institucionais (`InstitutionalDataEditor.vue`, via `setCurrentMembershipMode`).
 */
export const currentMembershipMode = ref<MembershipMode>("UNICO");
/**
 * Numeração automática de matrícula (migration `version: 21`) — mesmo
 * propósito de `currentMembershipMode`: só existe pra `SocioForm.vue` saber,
 * em tempo real, se esconde o campo "Matrícula" na criação de sócio. Espelha
 * `Association.auto_registration_number`; atualizado ao conectar
 * (`selectAssociation`) e ao salvar os dados institucionais
 * (`InstitutionalDataEditor.vue`, via `setCurrentAutoRegistrationNumber`).
 */
export const currentAutoRegistrationNumber = ref(false);

watch(currentAssociationConfigId, (id) => {
  try {
    if (id) localStorage.setItem(CHAVE_ARMAZENAMENTO, id);
    else localStorage.removeItem(CHAVE_ARMAZENAMENTO);
  } catch {
    // localStorage indisponível (ex.: janela privada) — segue sem persistir.
  }
});

/**
 * Confere a senha (se a associação tiver uma), conecta no arquivo `.db`
 * dela e descobre a linha de `associations` já existente ali, se houver.
 * Lança erro se a senha estiver incorreta.
 */
export async function selectAssociation(entry: AssociationSummary, password?: string): Promise<void> {
  if (entry.has_password) {
    const ok = await verifyAssociationPassword(entry.id, password ?? "");
    if (!ok) throw new Error("Senha incorreta.");
  }

  await connectToAssociation(entry.db_path);

  const associacoes = await AssociationModel.list();
  currentAssociationId.value = associacoes[0]?.id ?? null;
  currentAssociationConfigId.value = entry.id;
  currentMembershipMode.value = associacoes[0]?.membership_mode ?? "UNICO";
  currentAutoRegistrationNumber.value = Boolean(associacoes[0]?.auto_registration_number);
  isAssociationConnected.value = true;

  // Ponto mais próximo de "iniciar o app" que existe nesta arquitetura: só
  // dá pra garantir o calendário de parcelas depois que o banco desta
  // associação está conectado (ver ParcelaModel.ensureAteMesAtual — ex.:
  // banco só tem parcela até outubro, sistema abre em dezembro → cria
  // novembro e dezembro sozinho). Desde a `version: 13`, não existe mais
  // geração de cobrança por sócio: quem deve é calculado direto contra
  // `membership_payments` na leitura (ver `MembershipPaymentModel`), sem
  // nada pra "gerar" além do calendário de meses em si. Só faz sentido
  // rodar se já existir a linha de `associations` (banco não é mais um
  // arquivo vazio recém-criado).
  if (currentAssociationId.value) {
    await ParcelaModel.ensureAteMesAtual();
    await ActivityLogModel.registrar({
      module: "SISTEMA",
      description: entry.has_password ? "Associação aberta (com senha)" : "Associação aberta",
    });
  }
}

/** Usado pela aba Instituição depois de criar a primeira linha de `associations` num banco novo. */
export function setCurrentAssociationId(id: string | null): void {
  currentAssociationId.value = id;
}

/** Usado pela aba Instituição logo depois de salvar, pra refletir a troca de modo sem precisar reconectar. */
export function setCurrentMembershipMode(mode: MembershipMode): void {
  currentMembershipMode.value = mode;
}

/** Usado pela aba Instituição logo depois de salvar, pra refletir a troca de numeração sem precisar reconectar. */
export function setCurrentAutoRegistrationNumber(automatica: boolean): void {
  currentAutoRegistrationNumber.value = automatica;
}

/** Esquece a associação conectada — usado antes de mover/remover a que está ativa (ver Configuracoes.vue). */
export function clearCurrentAssociation(): void {
  currentAssociationId.value = null;
  currentAssociationConfigId.value = null;
  currentMembershipMode.value = "UNICO";
  currentAutoRegistrationNumber.value = false;
  isAssociationConnected.value = false;
}

/**
 * Usado pelos models de domínio para filtrar por `association_id` e para
 * gravar em novos registros. Lança erro se nenhuma associação foi
 * conectada e tiver dados institucionais ainda (banco vazio).
 */
export function getCurrentAssociationId(): string {
  const id = currentAssociationId.value;
  if (!id) {
    throw new Error("Cadastre os dados da associação na aba \"Instituição\" antes de continuar.");
  }
  return id;
}
