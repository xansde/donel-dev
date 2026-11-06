// Ledger no celular (item 19 do PDA mindscape-openrig, pedido do dono de 05/11) — a PWA que o main serve
// só na interface Tailscale do PC, para o dono validar entregas no celular, uma por tela, com gesto de
// arrastar. Este arquivo tem o que o main, o preload e a tela de Preferências compartilham: os canais das
// Preferências e a forma da entrega que a PWA mostra (o adaptador sobre o ledger V1 a monta).

export const CELULAR_CHANNELS = {
  getState: 'celular:get-state',
  setEnabled: 'celular:set-enabled',
  pair: 'celular:pair',
  revoke: 'celular:revoke',
  tailnet: 'celular:tailnet',
  firewall: 'celular:firewall',
  allowFirewall: 'celular:allow-firewall',
} as const;

/** Um celular (Android ou iPhone) que a Tailscale deste PC enxerga na mesma rede (tailnet). */
export interface TailnetPhone {
  readonly name: string;
  readonly online: boolean;
}

/** O que `tailscale status` diz dos celulares; `readable: false` = não deu para perguntar à Tailscale. */
export interface CelularTailnet {
  readonly readable: boolean;
  readonly phones: readonly TailnetPhone[];
}

/** A regra de entrada do Firewall do Windows para o celular: só a porta do app, só da faixa da Tailscale. */
export type CelularFirewallRule = 'present' | 'absent' | 'unknown';

export type CelularAllowFirewallResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

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
  /** Os celulares na Tailscale deste PC (lê `tailscale status`). */
  tailnet: () => Promise<CelularTailnet>;
  /** Só quando a conexão do celular falha: a regra de entrada existe? */
  firewall: () => Promise<CelularFirewallRule>;
  /** Cria a regra, com o pedido de administrador do Windows (nunca em silêncio). */
  allowFirewall: () => Promise<CelularAllowFirewallResult>;
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

/** `prototipo`: um HTML autocontido que a carta roda isolado (iframe sandbox, por bilhete de uso único). */
export type ProvaTipo = 'imagem' | 'video' | 'prototipo' | 'comando' | 'link';

export interface ProvaCelular {
  readonly id: string;
  readonly tipo: ProvaTipo;
  readonly rotulo: string;
  /** Saída de comando (`tipo: 'comando'`): só o começo, com segredos mascarados. */
  readonly texto?: string;
  /** A saída é maior que o resumo: a inteira (mascarada) vem por `/api/prova` ao abrir. */
  readonly cortado?: true;
  /** Endereço `http(s)` (`tipo: 'link'`). Imagem e vídeo vêm por `/api/prova`. */
  readonly url?: string;
}

/** Um caminho da decisão do dono (cartas forma A): o nome vira o botão. */
export interface OpcaoCelular {
  readonly rotulo: string;
  readonly efeito: string;
  readonly risco?: string;
  readonly fecha: 'aceita' | 'rejeitada';
  readonly recomendada?: true;
}

export type VisualCelular =
  /** Uma prova da entrega (`ProvaCelular.id`). */
  | { readonly tipo: 'prova'; readonly prova: string }
  | { readonly tipo: 'antes-depois'; readonly antes: string; readonly depois: string }
  /** Quadro de checagens desenhado pela PWA. */
  | { readonly tipo: 'checagens'; readonly itens: readonly { readonly nome: string; readonly ok: boolean; readonly frase: string }[] };

/** A carta forma A: o bloco "para o dono" da entrega. Sem ela, a PWA mostra a carta antiga. */
export interface CartaCelular {
  readonly pergunta: string;
  readonly resumo: string;
  readonly opcoes: readonly OpcaoCelular[];
  readonly porque: string;
  readonly risco: string;
  readonly visual?: VisualCelular;
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
  /** Nota de quem entregou, se deixou. */
  readonly nota?: string;
  readonly risco: 'baixo' | 'alto';
  readonly provas: readonly ProvaCelular[];
  /** O quadro (nome da pasta do projeto). */
  readonly quadro: string;
  /** `DD/MM/AAAA`. */
  readonly prazo: string;
  /** Detalhes técnicos, recolhidos no verso: o id da tarefa e de quem entregou. */
  readonly ids: readonly string[];
  /** Forma A: frente decide, verso explica. Ausente = entrega sem o bloco (a carta antiga). */
  readonly carta?: CartaCelular;
  /** O que o dono escreveu na carta e as reentregas de quem fez, em ordem (o verso mostra). */
  readonly conversa: readonly FalaCelular[];
  /** Carta de Slack: a frente mostra para quem vai, o texto exato e "Enviar" / "Não enviar". */
  readonly slack?: SlackCelular;
}

/** Uma mensagem no Slack em nome do dono, como a carta mostra (sem "DM", sem "thread"). */
export interface SlackCelular {
  /** A pessoa ou o canal. */
  readonly para: string;
  /** "Conversa particular", "Canal", "Conversa em grupo". */
  readonly onde: string;
  /** "Resposta dentro de uma conversa que já existe" ou "Mensagem nova". */
  readonly conversa: string;
  /** O texto exato que sai. */
  readonly texto: string;
  /** Por que a sessão quer mandar. */
  readonly motivo: string;
}

/** Uma fala da conversa da carta. */
export interface FalaCelular {
  /** `voce` = o dono escreveu; `entrega` = quem fez entregou de novo. */
  readonly de: 'voce' | 'entrega';
  readonly texto: string;
  /** ISO. */
  readonly em: string;
  /** Só do dono: para onde foi ("Enviado a Dev · painel", "Foi ao Líder", "Ninguém aberto…"). */
  readonly recibo?: string;
}

/** O resultado de escrever na carta, com o recibo para mostrar. */
export type ComentarCelular = { readonly ok: true; readonly recibo: string } | { readonly ok: false; readonly mensagem: string };

export type DecisaoCelular = 'aceitar' | 'rejeitar';
