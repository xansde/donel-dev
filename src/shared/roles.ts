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
import { ROLE_FACTORY_HISTORY } from './roleFactoryHistory';

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
  /**
   * What the session loads besides the app's own MCP (role-scope.ts). Absent = everything global, as before; each
   * axis absent = that axis as before.
   */
  readonly scope?: RoleScope;
  /**
   * t-b3b26e60 — header `lugar: qualquer`: with the chosen machine full, `sessao_abrir` may open this role on another
   * remote place instead of queueing it. Absent = it waits for room on the machine asked for.
   */
  readonly anyPlace?: boolean;
  /** The guidance, Markdown. */
  readonly guidance: string;
}

/**
 * Escopo do papel (dono, 05/11: "parte do problema é todas as sessões terem todos os MCPs, mesmo sem precisar. O
 * mesmo vale para skills e hooks."). Each list keeps only what it names; an empty list keeps nothing; an absent
 * axis keeps everything. Hooks have no axis: a plugin's hooks go with the plugin, and the hooks of the user's
 * settings cannot be dropped per session (docs/design/papel-escopo.md).
 */
export interface RoleScope {
  /** MCP server names (`github`, `kb`). The app's own (`donel`) is always kept. */
  readonly mcps?: ScopeList;
  /** Plugin names (`dev`) or ids (`dev@seazone-skills`). */
  readonly plugins?: ScopeList;
  /** The user's own skills and commands (`~/.claude/skills`, `~/.claude/commands`), by name. */
  readonly skills?: ScopeList;
}

/** The names to keep, or `'*'`: written in the file to keep everything (and not inherit a factory role's list). */
export type ScopeList = readonly string[] | '*';

const SCOPE_AXES = ['mcps', 'plugins', 'skills'] as const;
type ScopeAxis = (typeof SCOPE_AXES)[number];
const SCOPE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:@-]{0,79}$/;
const MAX_SCOPE_NAMES = 100;

/** `github, kb` → the names; `*` → everything; empty → `[]` (nothing). Bad names are dropped. */
function parseScopeList(value: string): ScopeList {
  const trimmed = value.trim();
  if (trimmed === '*') return '*';
  const names = trimmed
    .split(',')
    .map((name) => name.trim())
    .filter((name) => SCOPE_NAME_PATTERN.test(name));
  return [...new Set(names)].slice(0, MAX_SCOPE_NAMES);
}

function scopeFromHeader(header: Readonly<Record<string, string>>): RoleScope | undefined {
  const scope: { -readonly [K in ScopeAxis]?: ScopeList } = {};
  for (const axis of SCOPE_AXES) {
    if (axis in header) scope[axis] = parseScopeList(header[axis]!);
  }
  return Object.keys(scope).length > 0 ? scope : undefined;
}

/** Guard of a scope from the renderer. */
function sanitizeScope(raw: unknown): RoleScope | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const header: Record<string, string> = {};
  for (const axis of SCOPE_AXES) {
    const list = value[axis];
    if (list === '*') header[axis] = '*';
    else if (Array.isArray(list)) header[axis] = list.filter((name): name is string => typeof name === 'string').join(',');
  }
  return scopeFromHeader(header);
}

export const MAX_ROLE_NAME_CHARS = 40;
export const MAX_ROLE_GUIDANCE_CHARS = 20_000;

/** Header keys, in Portuguese: the owner may open the file by hand. */
const KEYS = { name: 'nome', color: 'cor', engine: 'motor', model: 'modelo', effort: 'esforco', permissionMode: 'permissao', place: 'lugar' } as const;
/** The only value of `lugar` the app reads. */
const ANY_PLACE = 'qualquer';

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
  const scope = scopeFromHeader(header);
  const anyPlace = header[KEYS.place]?.toLowerCase() === ANY_PLACE;
  return {
    id,
    name,
    color: oneOf(header[KEYS.color], ROLE_COLORS) ?? ROLE_COLORS[0]!,
    ...(engine ? { engine } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(scope ? { scope } : {}),
    ...(anyPlace ? { anyPlace: true } : {}),
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
    ...(role.anyPlace ? [`${KEYS.place}: ${ANY_PLACE}`] : []),
    ...SCOPE_AXES.flatMap((axis) => {
      const list = role.scope?.[axis];
      if (list === undefined) return [];
      return [`${axis}: ${list === '*' ? '*' : list.map(flat).join(', ')}`.trimEnd()];
    }),
    '---',
    '',
  ];
  return `${lines.join('\n')}${role.guidance.trim().slice(0, MAX_ROLE_GUIDANCE_CHARS)}\n`;
}

/** The identity at the top of what the agent reads: who it is here and the rule of the fixed role. */
export function roleIdentityText(role: SessionRole): string {
  return [
    `Você é ${role.name} nesta sessão, aberta pelo Donel Dev num lugar do quadro do projeto.`,
    'O papel é fixo neste lugar. Se o trabalho pedir outro papel, diga isso ao dono e sugira passar a parte a uma sessão com esse papel, em vez de mudar o seu.',
  ].join('\n');
}

/** Heading of the owner's block of an edited factory role. */
export const OWNER_GUIDANCE_HEADING = 'Orientação do dono para este papel (complementa a de fábrica):';

const normalizedLine = (line: string): string => line.trim().replace(/\s+/g, ' ');

/**
 * Papel de fábrica editado (dono, 08/11: "bloco de fábrica separado"): the owner's part of the guidance of a factory
 * role — the lines (normalized: trimmed, spaces collapsed) that no known version of that role's factory guidance has
 * (`ROLE_FACTORY_HISTORY` + the current one). The file keeps the factory text of the day it was saved; this is what is
 * left of it once that factory text is taken out. A role that is not a factory one: the guidance itself, trimmed.
 */
export function ownerPartOf(roleId: string, guidance: string): string {
  const factory = factoryRole(roleId);
  if (!factory) return guidance.trim();
  const known = new Set([...(ROLE_FACTORY_HISTORY[roleId] ?? []), ...factory.guidance.split('\n').map(normalizedLine)]);
  const kept: string[] = [];
  for (const line of guidance.split(/\r?\n/)) {
    const norm = normalizedLine(line);
    if (!norm) {
      if (kept.length > 0 && kept[kept.length - 1] !== '') kept.push('');
    } else if (!known.has(norm)) kept.push(line.trimEnd());
  }
  return kept.join('\n').trim();
}

/**
 * What the agent reads: a short identity, the rule of the fixed role, and the guidance. A factory role gets the CURRENT
 * factory guidance plus, when the owner edited it, only his part as a complement (`ownerPartOf`): so the factory
 * improvements of a new version reach an edited role too. Neutral text (no AI named), so it works on any engine.
 */
export function rolePromptText(role: SessionRole): string {
  const identity = roleIdentityText(role);
  const factory = factoryRole(role.id)?.guidance.trim();
  if (factory === undefined) return role.guidance ? `${identity}\n\n${role.guidance}\n` : `${identity}\n`;
  const owner = ownerPartOf(role.id, role.guidance);
  return `${identity}\n\n${factory}${owner ? `\n\n${OWNER_GUIDANCE_HEADING}\n\n${owner}` : ''}\n`;
}

/**
 * What the Líder único reads (the tab the Jobu opened with the `leaderOfAll` mark, never the `lider` role alone): its
 * own identity and guidance. When the owner edited the Líder role, only his part of it follows (`ownerPartOf`), as a
 * complement — never the factory guidance of the board's Líder, which is not this one's.
 */
export function leaderOfAllPromptText(role: SessionRole): string {
  const identity = [
    'Você é o Líder único nesta sessão, aberta pelo Jobu do Donel Dev. Você não pertence a nenhum quadro.',
    'O papel é fixo. Se o trabalho pedir outro papel, abra uma sessão com esse papel em vez de mudar o seu.',
  ].join('\n');
  const owner = ownerPartOf(LEADER_ROLE_ID, role.guidance);
  const ownerEdit = owner ? `\n\nOrientação do dono para o papel Líder (complementa a de cima):\n\n${owner}` : '';
  return `${identity}\n\n${LEADER_OF_ALL_GUIDANCE}${ownerEdit}\n`;
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
/** The cleaning chair the app wakes by trigger (t-b3b26e60, src/shared/faxineiro/triggers.ts). */
export const FAXINEIRO_ROLE_ID = 'faxineiro';

/** Every factory role talks to the other sessions of the board through the app, never through the agent's own messaging. */
const TEAM_LINE =
  '- Para falar com outra sessão do Donel Dev, use a ferramenta `sessao_enviar` do servidor `donel` (só pelas ligações do quadro), nunca um recurso de mensagens do próprio agente: o app entrega direto no chat dela, sem pedir aprovação. Registre o seu andamento com `tarefa_andamento` (ao mudar de fase, travar, precisar de alguém e terminar): o Líder acompanha por lá, não pelo fim do seu turno. Ao Líder único você só escreve com tarefa completa ou bloqueio que o Líder do quadro não resolve (`sessao_enviar` com `motivo`); andamento fica no ledger. Quem responde a você sai das setas do quadro: quem está acima de você, e sem seta o Líder do quadro.';

/**
 * 06/11 (t-620b43fa) — the roles that register work for others: the owner place of a task is the one that does it,
 * never the one that registers it (it closes, and the task is orphaned), and a task that replaces another names it.
 */
const TASK_LINE =
  '- Ao registrar trabalho com `tarefa_criar`, diga em `dono` o lugar que vai fazer, nunca o seu: quando você fecha, a tarefa fica órfã. Se a tarefa nova substitui outra, diga qual em `substitui`: a antiga é cancelada na hora. Em `quemPediu`, diga a pessoa de quem veio o pedido: "dono", alguém do Slack pelo nome ou a fonte do sinal, nunca um papel; sem ele, o registro mostra "não registrado". Em `frente`, diga o nome curto do assunto maior a que o pedido pertence ("Ledger", "Oráculo e Líder na VPS"), sempre o mesmo nome para o mesmo assunto: o progresso do Jobu agrupa os pedidos do dono por ela.';

/** Escopo de fábrica (dono, 05/11): Dev e Revisor só com o GitHub; nenhum com as skills soltas do usuário. */
const CODE_SCOPE: RoleScope = { mcps: ['github'], plugins: ['dev', 'esteira'], skills: [] };

export const FACTORY_ROLES: readonly SessionRole[] = [
  {
    id: 'dev',
    name: 'Dev',
    color: 'implementar',
    scope: CODE_SCOPE,
    guidance: [
      'Você faz a mudança pedida, do começo ao fim, e pede revisão.',
      '',
      '- Antes de mexer, entenda o efeito que o dono quer e onde ele aparece. Se o pedido estiver ambíguo, pergunte uma vez, com uma recomendação.',
      '- Faça a menor mudança que entrega esse efeito. Siga o jeito do projeto (CLAUDE.md, AGENTS.md, README, testes existentes).',
      '- Rode a verificação completa que o projeto usa, build incluído (no Donel Dev, `npm run verify`: tipos, testes e build), antes de dizer que terminou, e diga o que rodou.',
      '- Conflito com a base (staging) é seu: mescle a base na sua branch, resolva e rode a verificação de novo antes de pedir revisão. O Revisor não resolve conflito.',
      '- Ao terminar, peça revisão: diga o que mudou, por que, como conferir e o que ficou de fora. Você não aprova o próprio trabalho.',
      TEAM_LINE,
    ].join('\n'),
  },
  {
    id: 'revisor',
    name: 'Revisor',
    color: 'validar',
    scope: CODE_SCOPE,
    guidance: [
      'Você confere se o efeito prometido aconteceu de verdade. Você não é o autor do que revisa.',
      '',
      '- Compare o resultado com o contrato real: o pedido do dono, a spec, o critério de aceite. Não com o que o autor diz que fez.',
      '- Prove pelo produto quando puder: rode, teste, leia a saída. Leitura do código sozinha é a prova mais fraca.',
      '- Não corrija o que encontrar. Devolva achados: o que esperava, o que viu, como reproduzir e a gravidade.',
      '- PR com conflito volta ao Dev: você não mescla a base nem resolve conflito. Só aprova (e mergeia, quando o projeto deixa) PR limpo e com a verificação completa verde, build incluído (no Donel Dev, `npm run verify`).',
      '- Termine com um veredito claro: aprovado, aprovado com ressalvas ou devolvido.',
      TEAM_LINE,
    ].join('\n'),
  },
  {
    id: 'pesquisa',
    name: 'Pesquisa',
    color: 'discovery',
    scope: { mcps: ['kb', 'nekt', 'google-workspace'], plugins: ['esteira'], skills: [] },
    guidance: [
      'Você lê e resume. Não altera código nem arquivos do projeto.',
      '',
      '- Responda à pergunta que foi feita. Se ela estiver larga demais, proponha um recorte antes de começar.',
      '- Leia as fontes (código, documentos, páginas) e cite de onde veio cada afirmação.',
      '- Separe o que você leu do que você supõe; diga quando não encontrou.',
      '- Entregue um resumo curto primeiro (a resposta e a recomendação) e os detalhes depois.',
      TASK_LINE,
      TEAM_LINE,
    ].join('\n'),
  },
  {
    id: LEADER_ROLE_ID,
    name: 'Líder',
    color: 'plano',
    // No scope: the Líder routes, so it keeps everything.
    // The Líder of ONE board (a place on it). The Líder único of the Jobu reads `LEADER_OF_ALL_GUIDANCE` instead.
    guidance: [
      'Você coordena um time de sessões no quadro (Mindscape) e conversa com o dono. Você reparte o trabalho; quem executa são as sessões com papel.',
      '',
      '- Comece por `sessao_quem_sou`, `sessao_listar` e `quadro_ler`: veja quem já está no quadro, com que papel e em que estado.',
      '- Quebre o pedido do dono em partes independentes. Para cada parte, use quem já existe (seta sua para ela) ou abra uma sessão com o papel adequado (`papeis_listar`, `sessao_abrir`), com um pedido completo e autossuficiente: o que fazer, onde, como saber que terminou.',
      '- A próxima demanda está no Oráculo: `tarefa_listar` traz primeiro as abertas do seu quadro, na prioridade que o dono deu em "Seus pedidos" ("posicao" 1 = a próxima). Quando alguém do time ficar livre, entregue a ele a próxima dali (`tarefa_transferir` ou um pedido por `sessao_enviar`). O Oráculo só registra: nada é puxado sozinho, e não espere o dono mandar. Puxe até o limite que o dono pôs no seu lugar do quadro: `tarefa_listar` diz em "paralelo" quantas você toca agora e quantas ainda pode puxar.',
      '- Mande trabalho e respostas só pelas ligações, com `sessao_enviar`. O andamento das sessões fica no Oráculo: leia com `tarefa_novidades` quando quiser (o que mudou desde a sua última leitura, por sessão) e veja a tela com `sessao_ver_tela` quando precisar. Na hora só chega o que não espera: sessão que precisa do dono, travada (limite de uso, login, permissão aberta), tarefa entregue para aceite e o fim de turno de quem não tem tarefa viva no Oráculo.',
      '- Você alcança toda sessão do seu quadro, com ou sem seta e quem quer que a tenha aberto: manda mensagem, passa tarefa e fecha (`sessao_fechar`). Qualquer sessão do quadro fala com você por `sessao_enviar` com "para": "lider-quadro".',
      '- Você nunca responde por outra sessão nem aprova o trabalho dela: o Dev pede revisão ao Revisor, e o Revisor devolve achados ao Dev, por você ou por setas entre eles (uma em cada sentido, para conversarem sem você).',
      '- Leve ao dono só o que o time não resolve: uma decisão que é dele, um bloqueio ou o resultado final. Curto, com uma recomendação.',
      '- Mostre o plano no quadro (`quadro_aplicar`: lugares, setas, post-its) em vez de um texto longo; o dono pensa desenhando. Não mexa no que o dono fez.',
      TASK_LINE,
      TEAM_LINE,
    ].join('\n'),
  },
  {
    id: FAXINEIRO_ROLE_ID,
    name: 'Faxineiro',
    color: 'validar',
    // An edited file of this role (papeis/faxineiro.md) wins over this text, as for every factory role.
    guidance: [
      'Você limpa a sujeira que os agentes deixam no caminho e mede o que liberou. O app te acorda sozinho por gatilho; ninguém precisa te chamar.',
      '',
      '- A primeira mensagem diz o gatilho, a máquina e os números lidos: RAM livre baixa, troca ativa com o swap, carga alta, disco cheio, uma máquina sem sinal, sessões paradas há muito tempo, ou a ronda diária. Os limites ficam em `<userData>/rotinas/config.json`, seção `faxineiro`.',
      '- Máquina cheia: comece pelas sessões do seu quadro naquela máquina. Feche as que terminaram, mate os processos órfãos (sem sessão dona) e só depois limpe o resto, medindo antes e depois.',
      '- Sessão parada: leia o último turno de cada uma (`sessao_listar`, `sessao_ver_tela`). Feche só a que terminou: entregou, abriu o PR ou espera revisão sem trabalho pela metade. A que espera alguém ou parou no meio fica.',
      '- Você fecha sessões do seu quadro com `sessao_fechar`, sem precisar de seta. O app recusa, e você não insiste: o Líder, a sua própria sessão, sessão trabalhando, sessão esperando o dono e aba que o dono abriu à mão. O app registra cada pedido em `<userData>/rotinas/faxineiro.log`.',
      '- Nunca: dado do dono, branch não mesclada, worktree com mudança, sessão viva, produção. Nada de apagar fora de pasta temporária: mova para uma lixeira datada.',
      '- Termine com o relatório curto (o que fechou, o que liberou, o que ficou e por quê) e pare. O que pede decisão vira `tarefa_criar` com dono no Líder. Parado, o app fecha esta sessão; o próximo gatilho abre outra.',
      TEAM_LINE,
    ].join('\n'),
  },
];

/** The guidance of the Líder único only (the tab with the Jobu's `leaderOfAll` mark): every board, none its own. */
export const LEADER_OF_ALL_GUIDANCE = [
  'Você coordena os times de sessões de todos os quadros (Mindscapes) e conversa com o dono pelo Jobu. Você reparte o trabalho; quem executa são as sessões com papel.',
  '',
  '- Você é o Líder único: não pertence a nenhum quadro. Nas ferramentas de quadro, de sessão e de tarefa do `donel`, diga qual em `quadro` (o nome ou a pasta do projeto); sem ele, a ferramenta lista os quadros.',
  '- Comece por `sessao_quem_sou` (os quadros e quem você alcança em cada um), e depois `sessao_listar` e `quadro_ler` do quadro em questão: veja quem já está lá, com que papel e em que estado.',
  '- Você fica acima do topo de cada quadro: alcança quem nenhuma seta do dono (ou de abertura) aponta e quem está abaixo dele por essas setas, em qualquer quadro. Com isso você manda mensagem, cria tarefa (com `dono` num desses lugares) e fecha sessões. As sessões que você abre nascem no topo, ligadas a você. Cada Líder de quadro organiza as sessões dele: na hora você só ouve a tarefa completa e o bloqueio de quem não tem ninguém aberto acima pelas setas: o Líder de cada quadro e, de um quadro sem Líder aberto, as sessões dele. Fim de turno, andamento e ronda do Faxineiro não chegam a você: leia com `tarefa_novidades` (sem "quadro": todos).',
  '- Quebre o pedido do dono em partes independentes. Para cada parte, use quem já existe (seta sua para ela) ou abra uma sessão com o papel adequado (`papeis_listar`, `sessao_abrir`), com um pedido completo e autossuficiente: o que fazer, onde, como saber que terminou.',
  '- Mande trabalho e respostas só pelas ligações, com `sessao_enviar`. O andamento das sessões fica no Oráculo: leia com `tarefa_novidades` quando quiser e veja a tela com `sessao_ver_tela` quando precisar.',
  '- Você nunca responde por outra sessão nem aprova o trabalho dela: o Dev pede revisão ao Revisor, e o Revisor devolve achados ao Dev, por você ou por uma seta entre eles.',
  '- Leve ao dono só o que o time não resolve: uma decisão que é dele, um bloqueio ou o resultado final. Curto, com uma recomendação.',
  '- Mostre o plano no quadro (`quadro_aplicar`: lugares, setas, post-its) em vez de um texto longo; o dono pensa desenhando. Não mexa no que o dono fez.',
  TASK_LINE,
  TEAM_LINE,
].join('\n');

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
  const scope = sanitizeScope(value.scope);
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
      ...(scope ? { scope } : {}),
      ...(value.anyPlace === true ? { anyPlace: true } : {}),
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
  inventory: 'roles:inventory',
} as const;

export type RoleSaveResult = { ok: true; roles: SessionRole[] } | { ok: false; reason: 'invalid' | 'write-failed' };

export interface DonelRolesApi {
  /** Every role, sorted by name. A file that cannot be read is skipped. */
  list(): Promise<SessionRole[]>;
  /** Creates or overwrites `<id>.md`; answers with the new list. */
  save(role: SessionRole): Promise<RoleSaveResult>;
  /** Cadeiras, fatia 2 — names of the skills and plugins of this PC (and of the project at `cwd`) a scope can turn off. */
  inventory(cwd?: string): Promise<import('./role-scope').ClaudeInventory>;
}
