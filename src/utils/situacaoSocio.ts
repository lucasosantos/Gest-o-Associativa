import type { StatusSocio } from "../models/Member.js";

/** Situações do sócio, na ordem em que aparecem nos seletores. */
export const SITUACOES_SOCIO: StatusSocio[] = ["ATIVO", "PENDENTE", "INATIVO", "SUSPENSO", "DESLIGADO", "FALECIDO"];

export const ROTULO_SITUACAO_SOCIO: Record<StatusSocio, string> = {
  PENDENTE: "Pendente",
  ATIVO: "Ativo",
  INATIVO: "Inativo",
  SUSPENSO: "Suspenso",
  DESLIGADO: "Desligado",
  FALECIDO: "Falecido",
};
