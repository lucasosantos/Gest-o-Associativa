import { SystemSettingModel } from "./SystemSetting.js";
import { comAtividade } from "./ActivityLog.js";

/**
 * Aparência da carteirinha de sócio, por associação — guardada em
 * `system_settings` (chave `carteirinha.layout`, sem migration nova), então
 * acompanha o banco da associação (e o backup), não a máquina.
 */
export interface CarteirinhaLayout {
  /** Imagem de fundo (data URL, ver `readImageAsDataUrl`); `null` = fundo padrão (faixa na `corPrincipal`). */
  imagemFundo: string | null;
  /**
   * Cor do texto da faixa de cima (nome da associação e título) quando há
   * imagem de fundo — depende de a imagem ser escura ou clara ali.
   */
  textoTopo: "CLARO" | "ESCURO";
  /** Logo da associação (data URL), única coisa no verso; `null` = o verso mostra o nome da associação. */
  logo: string | null;
  /**
   * Imagem da assinatura do presidente (PNG, de preferência com fundo
   * transparente — data URL), impressa sobre a linha de assinatura do verso.
   * `null` = linha em branco, pra assinar à caneta.
   */
  assinatura: string | null;
  /** Frase do verso, abaixo da assinatura (aviso, benefícios...). Vazia = não aparece. */
  textoVerso: string;
  /** Rodapé do verso com endereço principal e contato da associação. */
  mostrarRodape: boolean;
  /** Cor do fundo padrão (faixa de cima, filete do rodapé) e dos rótulos — `#rrggbb`. */
  corPrincipal: string;
  /** Fundo das caixas de dados (nome, matrícula...) no fundo padrão — `#rrggbb`. */
  corCampos: string;
}

const CHAVE = "carteirinha.layout";

/** Cores padrão = o verde do `--accent`/`--accent-soft` do tema claro (App.vue). */
export const CORES_PADRAO = { corPrincipal: "#2f6f5e", corCampos: "#e4efec" } as const;

/** Cabe em 2 linhas pequenas no verso; o campo da tela corta nesse tamanho. */
export const TEXTO_VERSO_MAXIMO = 140;
export const TEXTO_VERSO_PADRAO = "Documento pessoal e intransferível. Em caso de perda, devolva à associação.";

export const LAYOUT_PADRAO: CarteirinhaLayout = {
  imagemFundo: null,
  textoTopo: "CLARO",
  logo: null,
  assinatura: null,
  textoVerso: TEXTO_VERSO_PADRAO,
  mostrarRodape: true,
  ...CORES_PADRAO,
};

/** Só aceita `#rrggbb` (o que o `<input type="color">` produz) — evita CSS arbitrário vindo do banco. */
function corValida(valor: unknown, padrao: string): string {
  return typeof valor === "string" && /^#[0-9a-f]{6}$/i.test(valor) ? valor.toLowerCase() : padrao;
}

export class CarteirinhaLayoutModel {
  static async get(): Promise<CarteirinhaLayout> {
    const registro = await SystemSettingModel.get(CHAVE);
    if (!registro) return { ...LAYOUT_PADRAO };
    try {
      const valor = JSON.parse(registro.value_json) as Partial<CarteirinhaLayout>;
      return {
        imagemFundo: typeof valor.imagemFundo === "string" ? valor.imagemFundo : null,
        textoTopo: valor.textoTopo === "ESCURO" ? "ESCURO" : "CLARO",
        logo: typeof valor.logo === "string" ? valor.logo : null,
        assinatura: typeof valor.assinatura === "string" ? valor.assinatura : null,
        // Ausente (layout salvo antes desta opção) = padrão; string vazia = o usuário apagou de propósito.
        textoVerso:
          typeof valor.textoVerso === "string" ? valor.textoVerso.slice(0, TEXTO_VERSO_MAXIMO) : TEXTO_VERSO_PADRAO,
        mostrarRodape: valor.mostrarRodape !== false,
        corPrincipal: corValida(valor.corPrincipal, CORES_PADRAO.corPrincipal),
        corCampos: corValida(valor.corCampos, CORES_PADRAO.corCampos),
      };
    } catch {
      return { ...LAYOUT_PADRAO };
    }
  }

  static async salvar(layout: CarteirinhaLayout, anterior: CarteirinhaLayout): Promise<void> {
    await comAtividade(
      () => SystemSettingModel.set(CHAVE, layout),
      () => ({
        module: "SOCIOS",
        description: descreverMudanca(layout, anterior),
      })
    );
  }
}

function descreverMudanca(novo: CarteirinhaLayout, anterior: CarteirinhaLayout): string {
  if (novo.textoVerso !== anterior.textoVerso) {
    return novo.textoVerso
      ? `Frase do verso da carteirinha de sócio alterada — "${novo.textoVerso}"`
      : "Frase do verso da carteirinha de sócio removida";
  }
  if (novo.mostrarRodape !== anterior.mostrarRodape) {
    return novo.mostrarRodape
      ? "Endereço e contato da associação incluídos no verso da carteirinha"
      : "Endereço e contato da associação retirados do verso da carteirinha";
  }
  if (novo.assinatura !== anterior.assinatura) {
    return novo.assinatura
      ? "Assinatura do presidente na carteirinha de sócio alterada"
      : "Assinatura do presidente na carteirinha de sócio removida (linha em branco)";
  }
  if (novo.logo !== anterior.logo) {
    return novo.logo
      ? "Logo do verso da carteirinha de sócio alterada"
      : "Logo do verso da carteirinha de sócio removida (verso mostra o nome da associação)";
  }
  if (novo.imagemFundo !== anterior.imagemFundo) {
    return novo.imagemFundo
      ? "Imagem de fundo da carteirinha de sócio alterada"
      : "Imagem de fundo da carteirinha de sócio removida (volta ao fundo padrão)";
  }
  if (novo.textoTopo !== anterior.textoTopo) {
    return `Cor do texto do topo da carteirinha alterada para ${novo.textoTopo === "CLARO" ? "clara" : "escura"}`;
  }
  if (novo.corPrincipal === CORES_PADRAO.corPrincipal && novo.corCampos === CORES_PADRAO.corCampos) {
    return "Cores da carteirinha de sócio restauradas para o padrão";
  }
  return `Cores da carteirinha de sócio alteradas — principal ${novo.corPrincipal}, campos ${novo.corCampos}`;
}
