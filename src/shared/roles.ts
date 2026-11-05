// Papéis de sessão (item 12 of docs/planos/mindscape-openrig.pda.md, docs/refinamentos/mindscape-lugar-papel.md).
//
// A role is a file of the app, `<userData>/papeis/<id>.md`: a short header (name, color and the
// suggested engine, model, effort and permission) and the guidance as the body. The text is
// neutral on purpose — no AI is named — so the same role runs on any engine. The app hands the
// guidance to the CLI at every launch, resume and renewal (`roleDeliveryFor` in commandBuilder.ts).
//
// The role is FIXED per place (dono, 03/11): another role is another session, and the work is
// delegated. Pure: no I/O here; the store is `src/main/roles-store.ts`.

import type { EffortLevel, ModelAlias, PermissionMode } from './commandBuilder';

/** File name without `.md`: lowercase letters, digits and dashes. */
const ROLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function isRoleId(value: unknown): value is string {
  return typeof value === 'string' && ROLE_ID_PATTERN.test(value);
}

/** The seal color: the Esteira phase chips of the design system (`--phase-<color>`). */
export type RoleColor = 'discovery' | 'plano' | 'implementar' | 'validar' | 'concluir' | 'design' | 'documentar';

export const ROLE_COLORS: readonly RoleColor[] = ['implementar', 'validar', 'discovery', 'plano', 'design', 'concluir', 'documentar'];

export function roleColorVar(color: RoleColor): string {
  return `var(--phase-${color})`;
}

const MODELS: readonly ModelAlias[] = ['fable', 'opus', 'sonnet', 'haiku'];
const EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const PERMISSIONS: readonly PermissionMode[] = ['manual', 'acceptEdits', 'auto', 'plan', 'dontAsk', 'bypassPermissions'];

export interface SessionRole {
  readonly id: string;
  readonly name: string;
  readonly color: RoleColor;
  /** Suggested engine: the id of a provider; absent = the active account. */
  readonly engine?: string;
  readonly model?: ModelAlias;
  readonly effort?: EffortLevel;
  readonly permissionMode?: PermissionMode;
  /** The guidance, Markdown. */
  readonly guidance: string;
}

export const MAX_ROLE_NAME_CHARS = 40;
export const MAX_ROLE_GUIDANCE_CHARS = 20_000;

/** Header keys, in Portuguese: the owner may open the file by hand. */
const KEYS = { name: 'nome', color: 'cor', engine: 'motor', model: 'modelo', effort: 'esforco', permissionMode: 'permissao' } as const;

function oneOf<T extends string>(value: string | undefined, options: readonly T[]): T | undefined {
  return value && (options as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Reads a role file. No header, no name or a bad id → `null` (the file is skipped, never
 * guessed). An unknown color falls back to the first one; an unknown suggestion is dropped.
 */
export function parseRoleFile(id: string, text: string): SessionRole | null {
  if (!isRoleId(id)) return null;
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return null;
  const header: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    header[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  const name = (header[KEYS.name] ?? '').slice(0, MAX_ROLE_NAME_CHARS).trim();
  if (!name) return null;
  const engine = header[KEYS.engine]?.trim();
  const model = oneOf(header[KEYS.model], MODELS);
  const effort = oneOf(header[KEYS.effort], EFFORTS);
  const permissionMode = oneOf(header[KEYS.permissionMode], PERMISSIONS);
  return {
    id,
    name,
    color: oneOf(header[KEYS.color], ROLE_COLORS) ?? ROLE_COLORS[0]!,
    ...(engine ? { engine } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    guidance: match[2]!.trim().slice(0, MAX_ROLE_GUIDANCE_CHARS),
  };
}

/** The file of a role (header + guidance). A value with a line break is flattened: the header is one line per key. */
export function serializeRole(role: SessionRole): string {
  const flat = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();
  const lines = [
    '---',
    `${KEYS.name}: ${flat(role.name).slice(0, MAX_ROLE_NAME_CHARS)}`,
    `${KEYS.color}: ${role.color}`,
    ...(role.engine ? [`${KEYS.engine}: ${flat(role.engine)}`] : []),
    ...(role.model ? [`${KEYS.model}: ${role.model}`] : []),
    ...(role.effort ? [`${KEYS.effort}: ${role.effort}`] : []),
    ...(role.permissionMode ? [`${KEYS.permissionMode}: ${role.permissionMode}`] : []),
    '---',
    '',
  ];
  return `${lines.join('\n')}${role.guidance.trim().slice(0, MAX_ROLE_GUIDANCE_CHARS)}\n`;
}

/**
 * What the agent reads: a short identity, the rule of the fixed role, and the guidance.
 * Neutral text (no AI named), so it works on any engine.
 */
export function rolePromptText(role: SessionRole): string {
  const identity = [
    `Você é ${role.name} nesta sessão, aberta pelo Donel Dev num lugar do quadro do projeto.`,
    'O papel é fixo neste lugar. Se o trabalho pedir outro papel, diga isso ao dono e sugira passar a parte a uma sessão com esse papel, em vez de mudar o seu.',
  ].join('\n');
  return role.guidance ? `${identity}\n\n${role.guidance}\n` : `${identity}\n`;
}

/** A role id from a name the owner typed ("Revisor de UI" → "revisor-de-ui"), not in `taken`. */
export function roleIdFromName(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'papel';
  const start = /^[a-z0-9]/.test(base) ? base : `p-${base}`;
  if (!taken.has(start)) return start;
  for (let n = 2; ; n += 1) {
    const id = `${start}-${n}`;
    if (!taken.has(id)) return id;
  }
}

// ---------------------------------------------------------------------------
// Item 12b — the three roles of the factory. Generic on purpose, pt-BR, no AI named. A file with the
// same id in `<userData>/papeis/` replaces one (that is how the owner edits it); with no file, the
// factory text is what runs.
// ---------------------------------------------------------------------------

/** The role that coordinates a team of sessions (the conversation with the Jobu opens a session with it). */
export const LEADER_ROLE_ID = 'lider';

/** Every factory role talks to the other sessions of the board through the app, never through the agent's own messaging. */
const TEAM_LINE =
  '- Para falar com outra sessão do Donel Dev, use a ferramenta `sessao_enviar` do servidor `donel` (só pelas ligações do quadro), nunca um recurso de mensagens do próprio agente: o app entrega direto no chat dela, sem pedir aprovação.';

export const FACTORY_ROLES: readonly SessionRole[] = [
  {
    id: 'dev',
    name: 'Dev',
    color: 'implementar',
    guidance: [
      'Você faz a mudança pedida, do começo ao fim, e pede revisão.',
      '',
      '- Antes de mexer, entenda o efeito que o dono quer e onde ele aparece. Se o pedido estiver ambíguo, pergunte uma vez, com uma recomendação.',
      '- Faça a menor mudança que entrega esse efeito. Siga o jeito do projeto (CLAUDE.md, AGENTS.md, README, testes existentes).',
      '- Rode a verificação que o projeto usa (tipos, testes, build) antes de dizer que terminou, e diga o que rodou.',
      '- Ao terminar, peça revisão: diga o que mudou, por que, como conferir e o que ficou de fora. Você não aprova o próprio trabalho.',
      TEAM_LINE,
    ].join('\n'),
  },
  {
    id: 'revisor',
    name: 'Revisor',
    color: 'validar',
    guidance: [
      'Você confere se o efeito prometido aconteceu de verdade. Você não é o autor do que revisa.',
      '',
      '- Compare o resultado com o contrato real: o pedido do dono, a spec, o critério de aceite. Não com o que o autor diz que fez.',
      '- Prove pelo produto quando puder: rode, teste, leia a saída. Leitura do código sozinha é a prova mais fraca.',
      '- Não corrija o que encontrar. Devolva achados: o que esperava, o que viu, como reproduzir e a gravidade.',
      '- Termine com um veredito claro: aprovado, aprovado com ressalvas ou devolvido.',
      TEAM_LINE,
    ].join('\n'),
  },
  {
    id: 'pesquisa',
    name: 'Pesquisa',
    color: 'discovery',
    guidance: [
      'Você lê e resume. Não altera código nem arquivos do projeto.',
      '',
      '- Responda à pergunta que foi feita. Se ela estiver larga demais, proponha um recorte antes de começar.',
      '- Leia as fontes (código, documentos, páginas) e cite de onde veio cada afirmação.',
      '- Separe o que você leu do que você supõe; diga quando não encontrou.',
      '- Entregue um resumo curto primeiro (a resposta e a recomendação) e os detalhes depois.',
      TEAM_LINE,
    ].join('\n'),
  },
  {
    id: LEADER_ROLE_ID,
    name: 'Líder',
    color: 'plano',
    guidance: [
      'Você coordena os times de sessões de todos os quadros (Mindscapes) e conversa com o dono pelo Jobu. Você reparte o trabalho; quem executa são as sessões com papel.',
      '',
      '- Você é o Líder único: não pertence a nenhum quadro. Nas ferramentas de quadro, de sessão e de tarefa do `donel`, diga qual em `quadro` (o nome ou a pasta do projeto); sem ele, a ferramenta lista os quadros.',
      '- Comece por `sessao_quem_sou` (os quadros e quem você alcança em cada um), e depois `sessao_listar` e `quadro_ler` do quadro em questão: veja quem já está lá, com que papel e em que estado.',
      '- Você fica acima do topo de cada quadro: alcança quem nenhuma seta do dono (ou de abertura) aponta e quem está abaixo dele por essas setas, em qualquer quadro. Com isso você manda mensagem, cria tarefa (com `dono` num desses lugares) e fecha sessões. As sessões que você abre nascem no topo, ligadas a você; você ouve o "terminou" delas e o de quem você mandou trabalho.',
      '- Quebre o pedido do dono em partes independentes. Para cada parte, use quem já existe (seta sua para ela) ou abra uma sessão com o papel adequado (`papeis_listar`, `sessao_abrir`), com um pedido completo e autossuficiente: o que fazer, onde, como saber que terminou.',
      '- Mande trabalho e respostas só pelas ligações, com `sessao_enviar`. Você recebe um aviso "◆ … terminou" a cada turno que uma delas encerra; leia mais com `sessao_ver_tela` quando precisar.',
      '- Você nunca responde por outra sessão nem aprova o trabalho dela: o Dev pede revisão ao Revisor, e o Revisor devolve achados ao Dev, por você ou por uma seta entre eles.',
      '- Leve ao dono só o que o time não resolve: uma decisão que é dele, um bloqueio ou o resultado final. Curto, com uma recomendação.',
      '- Mostre o plano no quadro (`quadro_aplicar`: lugares, setas, post-its) em vez de um texto longo; o dono pensa desenhando. Não mexa no que o dono fez.',
      TEAM_LINE,
    ].join('\n'),
  },
];

/** The factory role of `id`, if any. */
export function factoryRole(id: string): SessionRole | undefined {
  return FACTORY_ROLES.find((role) => role.id === id);
}

/** Guard of a role that comes from the renderer: the same rules as the file (written and read back). */
export function sanitizeRole(raw: unknown): SessionRole | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (!isRoleId(value.id) || typeof value.name !== 'string' || typeof value.guidance !== 'string') return null;
  const text = (key: string): string | undefined => (typeof value[key] === 'string' ? (value[key] as string) : undefined);
  const engine = text('engine')?.trim();
  const model = oneOf(text('model'), MODELS);
  const effort = oneOf(text('effort'), EFFORTS);
  const permissionMode = oneOf(text('permissionMode'), PERMISSIONS);
  return parseRoleFile(
    value.id,
    serializeRole({
      id: value.id,
      name: value.name,
      color: oneOf(text('color'), ROLE_COLORS) ?? ROLE_COLORS[0]!,
      ...(engine ? { engine } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      guidance: value.guidance,
    }),
  );
}

// ---------------------------------------------------------------------------
// IPC of `window.donel.roles` — the main is the only writer of `<userData>/papeis/`.
// ---------------------------------------------------------------------------

export const ROLES_CHANNELS = {
  list: 'roles:list',
  save: 'roles:save',
} as const;

export type RoleSaveResult = { ok: true; roles: SessionRole[] } | { ok: false; reason: 'invalid' | 'write-failed' };

export interface DonelRolesApi {
  /** Every role, sorted by name. A file that cannot be read is skipped. */
  list(): Promise<SessionRole[]>;
  /** Creates or overwrites `<id>.md`; answers with the new list. */
  save(role: SessionRole): Promise<RoleSaveResult>;
}
