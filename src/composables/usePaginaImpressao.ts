import { onUnmounted } from "vue";
import { getPrintConfig, type PrintConfig } from "../services/config.js";

/** Qual configuração de papel uma tela de impressão usa. */
export type TipoImpressao = "PADRAO" | "RECIBO";

type Papel = PrintConfig["default_paper"] | PrintConfig["receipt_paper"];

interface PapelFolha {
  rotulo: string;
  /** `@page size` (sempre retrato). */
  size: string;
  margem: string;
}

/**
 * Bobina de impressora térmica: não existe papel de altura contínua no
 * `@page`, então a altura é medida na hora de imprimir (ver `imprimir`).
 * `areaUtil` = faixa que a cabeça térmica de fato imprime (58 mm → 48 mm,
 * 80 mm → 72 mm, o padrão dessas impressoras); o resto é margem lateral.
 */
interface PapelBobina {
  rotulo: string;
  larguraMm: number;
  areaUtilMm: number;
  /** Tamanho base da letra no recibo (os demais tamanhos derivam dele). */
  fonte: string;
}

const PAPEIS: Record<Papel, PapelFolha | PapelBobina> = {
  A4: { rotulo: "A4 (210 × 297 mm)", size: "210mm 297mm", margem: "12mm" },
  A5: { rotulo: "A5 — meia folha A4 (148 × 210 mm)", size: "148mm 210mm", margem: "8mm" },
  CARTA: { rotulo: "Carta (216 × 279 mm)", size: "216mm 279mm", margem: "12mm" },
  OFICIO: { rotulo: "Ofício (216 × 330 mm)", size: "216mm 330mm", margem: "12mm" },
  TERMICA_58: { rotulo: "Impressora térmica — bobina 58 mm", larguraMm: 58, areaUtilMm: 48, fonte: "8pt" },
  TERMICA_80: { rotulo: "Impressora térmica — bobina 80 mm", larguraMm: 80, areaUtilMm: 72, fonte: "9.5pt" },
};

function ehBobina(papel: PapelFolha | PapelBobina): papel is PapelBobina {
  return "larguraMm" in papel;
}

/** 1 px CSS = 1/96 polegada. */
const MM_POR_PX = 25.4 / 96;
/** Folga no fim da bobina, pra última linha não encostar no corte. */
const FOLGA_BOBINA_MM = 6;

export const ROTULO_PAPEL: Record<Papel, string> = Object.fromEntries(
  Object.entries(PAPEIS).map(([codigo, papel]) => [codigo, papel.rotulo])
) as Record<Papel, string>;

const ID_ESTILO = "estilo-pagina-impressao";

/**
 * Aplica o tamanho de papel configurado (Configurações → Impressão) à tela
 * de impressão que chamar isto: injeta um `@page` global enquanto a tela
 * estiver montada e remove ao sair — `@page` não funciona dentro de
 * `<style scoped>`, por isso é injetado no `<head>`. Também marca
 * `<html data-papel="...">` pra tela ajustar o layout a papéis menores
 * (ex.: recibo em bobina térmica, ver `.documento-recibo` em `App.vue`).
 * Devolve `imprimir()`, que espera o papel estar aplicado antes de abrir a
 * impressão do sistema — use no lugar de `window.print()` direto.
 * `opcoes.margem` troca a margem padrão do papel só pra esta tela.
 *
 * Bobina térmica: o recibo é desenhado na largura da bobina já na tela (a
 * pré-visualização é o que sai no papel), e `imprimir()` mede a altura do
 * `.documento-recibo` pra criar uma página exatamente desse tamanho — sem
 * isso a impressora puxaria uma folha inteira de papel em branco.
 */
export function usePaginaImpressao(
  tipo: TipoImpressao,
  opcoes: { margem?: string } = {}
): { imprimir: () => Promise<void> } {
  const aplicado = aplicar(tipo, opcoes.margem);
  onUnmounted(remover);

  return {
    async imprimir() {
      const papel = await aplicado;
      if (ehBobina(papel)) ajustarAlturaBobina(papel);
      window.print();
    },
  };
}

/** `margem`: sobrepõe a margem padrão do papel (só folha, não bobina) — ex.: ficha do sócio, mais arejada. */
async function aplicar(tipo: TipoImpressao, margem?: string): Promise<PapelFolha | PapelBobina> {
  let codigo: Papel = "A4";
  try {
    const config = await getPrintConfig();
    codigo = tipo === "RECIBO" ? config.receipt_paper : config.default_paper;
  } catch (error) {
    // Sem config (ex.: rodando só o Vite, fora do Tauri) — segue em A4.
    console.error("Não foi possível ler o papel de impressão:", error);
  }
  const papel = PAPEIS[codigo] ?? PAPEIS.A4;

  let estilo = document.getElementById(ID_ESTILO);
  if (!estilo) {
    estilo = document.createElement("style");
    estilo.id = ID_ESTILO;
    document.head.appendChild(estilo);
  }
  const raiz = document.documentElement;
  raiz.dataset.papel = codigo;
  if (ehBobina(papel)) {
    raiz.style.setProperty("--bobina-largura", `${papel.larguraMm}mm`);
    raiz.style.setProperty("--bobina-margem", `${(papel.larguraMm - papel.areaUtilMm) / 2}mm`);
    raiz.style.setProperty("--bobina-fonte", papel.fonte);
    // Altura provisória — `ajustarAlturaBobina` troca pela medida real antes de imprimir.
    estilo.textContent = `@page { size: ${papel.larguraMm}mm 200mm; margin: 0; }`;
  } else {
    estilo.textContent = `@page { size: ${papel.size}; margin: ${margem ?? papel.margem}; }`;
  }
  return papel;
}

/** Página do tamanho exato do recibo: largura da bobina × altura medida do `.documento-recibo`. */
function ajustarAlturaBobina(papel: PapelBobina) {
  const recibo = document.querySelector<HTMLElement>(".documento-recibo");
  const estilo = document.getElementById(ID_ESTILO);
  if (!recibo || !estilo) return;
  const alturaMm = Math.ceil(recibo.getBoundingClientRect().height * MM_POR_PX) + FOLGA_BOBINA_MM;
  estilo.textContent = `@page { size: ${papel.larguraMm}mm ${alturaMm}mm; margin: 0; }`;
}

function remover() {
  document.getElementById(ID_ESTILO)?.remove();
  const raiz = document.documentElement;
  delete raiz.dataset.papel;
  raiz.style.removeProperty("--bobina-largura");
  raiz.style.removeProperty("--bobina-margem");
  raiz.style.removeProperty("--bobina-fonte");
}
