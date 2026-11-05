// Ledger no celular (item 19 do PDA mindscape-openrig, pedido do dono de 05/11) — a PWA que o main serve
// só na interface Tailscale do PC, para o dono validar entregas no celular, uma por tela, com gesto de
// arrastar. Este arquivo tem o que o main, o preload e a tela de Preferências compartilham: os canais das
// Preferências e a forma da entrega que a PWA mostra (a mesma que o adaptador do ledger devolve).

export const CELULAR_CHANNELS = {
  getState: 'celular:get-state',
  setEnabled: 'celular:set-enabled',
  pair: 'celular:pair',
  revoke: 'celular:revoke',
} as const;

/** Um celular pareado, como as Preferências mostram (o token nunca sai do main). */
export interface CelularDevice {
  readonly id: string;
  readonly name: string;
  /** ISO. */
  readonly pairedAt: string;
  /** ISO; `null` = nunca abriu depois de parear. */
  readonly lastSeenAt: string | null;
}

export type CelularStatus =
  /** Desligado nas Preferências. */
  | 'off'
  /** No ar, só na Tailscale. */
  | 'listening'
  /** Ligado, mas este PC não tem endereço Tailscale agora. */
  | 'no-tailscale'
  /** Ligado, mas o servidor não subiu (porta ocupada, por exemplo). */
  | 'error';

export interface CelularState {
  readonly enabled: boolean;
  readonly status: CelularStatus;
  /** `http://<ip-tailscale>:<porta>` quando no ar. */
  readonly url: string | null;
  readonly error: string | null;
  readonly devices: readonly CelularDevice[];
  /** O ledger real ainda não chegou: o celular mostra entregas de demonstração. */
  readonly demo: boolean;
}

/** Um convite de pareamento: link com código de uso único e o QR dele (SVG). */
export interface CelularPairing {
  readonly url: string;
  /** SVG do QR, para `<img src="data:image/svg+xml,...">`. */
  readonly qrSvg: string;
  /** ISO. */
  readonly expiresAt: string;
}

export type CelularPairResult = { readonly ok: true; readonly pairing: CelularPairing } | { readonly ok: false; readonly reason: string };

export interface DonelCelularApi {
  getState: () => Promise<CelularState>;
  setEnabled: (enabled: boolean) => Promise<CelularState>;
  pair: () => Promise<CelularPairResult>;
  revoke: (deviceId: string) => Promise<CelularState>;
}

// ---------------------------------------------------------------------------
// A entrega como o celular mostra

/** O naipe da carta, pelo tipo do trabalho. */
export type Naipe = 'martelos' | 'escudos' | 'chaves' | 'livros' | 'estrelas' | 'coroas';

/** Tipo de trabalho do ledger → naipe. Tipo desconhecido vira construção. */
export function naipeDoTipo(tipo: string | null | undefined): Naipe {
  switch ((tipo ?? '').toLowerCase()) {
    case 'correcao':
    case 'correção':
    case 'fix':
      return 'escudos';
    case 'seguranca':
    case 'segurança':
    case 'acesso':
      return 'chaves';
    case 'pesquisa':
    case 'docs':
    case 'documentacao':
    case 'documentação':
      return 'livros';
    case 'revisao':
    case 'revisão':
      return 'estrelas';
    case 'decisao':
    case 'decisão':
      return 'coroas';
    default:
      return 'martelos';
  }
}

export type ProvaTipo = 'imagem' | 'video' | 'comando' | 'link';

export interface ProvaCelular {
  readonly id: string;
  readonly tipo: ProvaTipo;
  readonly rotulo: string;
  /** Saída de comando (`tipo: 'comando'`). */
  readonly texto?: string;
  /** Endereço `http(s)` (`tipo: 'link'`). Imagem e vídeo vêm por `/api/prova`. */
  readonly url?: string;
}

export interface EntregaCelular {
  readonly id: string;
  /** `esperando-voce` = entregue, aguardando o aceite humano; `amostra-revisor` = aceite do Revisor na amostra do dia (D2). */
  readonly origem: 'esperando-voce' | 'amostra-revisor';
  readonly naipe: Naipe;
  readonly titulo: string;
  /** A frase literal de quem pediu. */
  readonly pedido: string;
  /** O critério de pronto. */
  readonly criterio: string;
  readonly quemEntregou: string;
  /** ISO. */
  readonly entregueEm: string;
  /** Na amostra: quem aceitou (o Revisor). */
  readonly aceitoPor?: string;
  readonly provas: readonly ProvaCelular[];
}

export type DecisaoCelular = 'aceitar' | 'rejeitar';
