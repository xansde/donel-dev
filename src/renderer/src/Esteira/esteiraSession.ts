import type { SessionSnapshot } from '../../../shared/esteira/store/storeFormat';

// Spec 010 / batch B1 — a decisão PURA do gesto "Preparar": qual comando a
// sessão recebe escrito, em que diretório ela abre, e o que a tela diz quando
// ela não abre.
//
// Fica fora do componente pelo mesmo motivo de `esteiraView.ts`: é aqui que
// mora o vocabulário. Uma correção de frase feita no JSX não sobe até a raiz —
// foi exatamente assim que "em andamento" apareceu duas vezes para um estado
// que ninguém tinha assumido.
//
// Dois invariantes moram aqui, e os dois têm cicatriz no repo:
//
// 1. **O Enter é gesto humano** (invariante 2/CA-3 de `openPhaseSession.ts`):
//    nada que sai daqui contém `\r`/`\n`. Quem escreve no PTY é o App.tsx, pelo
//    canal `pty:input`, sempre com o texto puro.
// 2. **Alvo explícito, zero palpite** (D-6): repo que o app não conhece devolve
//    RECUSA com o nome do repo, nunca um segundo melhor palpite. A evidência 2
//    da spec é uma fase que abriu no repo errado por causa de um fallback
//    silencioso comentado no código como "palpite honesto".

/** O mínimo que este módulo precisa saber de um projeto — nome e caminho. */
export interface KnownProject {
  readonly name: string;
  readonly path: string;
}

export type SessionCwdResolution =
  | { readonly ok: true; readonly cwd: string }
  /** `no-target-repo`: o card não declara repo (legítimo — discovery investiga problema, não repositório). */
  | { readonly ok: false; readonly reason: 'no-target-repo' | 'unknown-repo' };

/** Tira quebra de linha de qualquer texto que vá para o PTY — a garantia do invariante 2 fica na origem. */
function semQuebra(value: string): string {
  return value.replace(/[\r\n]/g, '');
}

/**
 * A skill 3.0 da fase, apontada para o `run-input.json` que o disparo gravou.
 * `phase` é string livre no contrato (`[P-4]` — as fases de cada ciclo só serão
 * fechadas no horizontal pequeno), então o nome da skill é derivado dela.
 *
 * **Uma função só para os dois usos.** O mesmo texto é pré-digitado na aba E
 * mostrado como próximo passo quando a sessão não pôde abrir — se fossem dois
 * lugares, o segundo envelheceria calado.
 */
export function esteiraPhaseCommand(phase: string, inputPath: string): string {
  return semQuebra(`/esteira-${phase.trim()} --input "${inputPath}"`);
}

/**
 * Onde a sessão abre. Nome do projeto OU caminho inteiro — os dois são
 * declaração explícita de quem criou o card. O que NÃO existe é fallback: repo
 * fora da lista devolve `unknown-repo` mesmo quando há um único projeto
 * configurado, porque "só tem um, deve ser esse" é a mesma classe de palpite
 * que abriu a fase no repo errado em 03/08.
 */
export function resolveSessionCwd(targetRepo: string | null, projects: readonly KnownProject[]): SessionCwdResolution {
  const wanted = targetRepo?.trim() ?? '';
  if (wanted.length === 0) return { ok: false, reason: 'no-target-repo' };

  const normalized = wanted.toLowerCase().replace(/[\\/]+$/, '');
  const match = projects.find(
    (project) =>
      project.name.toLowerCase() === normalized ||
      project.path.toLowerCase().replace(/[\\/]+$/, '').replace(/\\/g, '/') === normalized.replace(/\\/g, '/'),
  );
  return match === undefined ? { ok: false, reason: 'unknown-repo' } : { ok: true, cwd: match.path };
}

/** Nome da aba: a fase e o card de onde ela nasceu, curto o bastante para caber. */
export function esteiraTabName(phase: string, discoveryTitle: string): string {
  const prefixo = `[${phase}] `;
  const espaco = 60 - prefixo.length;
  const titulo = discoveryTitle.trim();
  return `${prefixo}${titulo.length > espaco ? `${titulo.slice(0, espaco - 1)}…` : titulo}`;
}

/**
 * O pedido que a tela entrega ao App: tudo já decidido, nada a deduzir. O App
 * só faz o encanamento (criar a aba, escrever o comando, amarrar a sessão) —
 * mesma divisão de `decidePhaseOpen`/`App.tsx` do Modo Dev.
 */
export interface EsteiraSessionRequest {
  /** A sessão que o disparo registrou no store — é ela que será assumida e encerrada. */
  readonly sessionId: string;
  readonly phase: string;
  readonly cwd: string;
  readonly tabName: string;
  /** Pré-digitado, nunca enviado: o Enter é do humano. */
  readonly command: string;
}

export type SessionOpenOutcome =
  | { readonly opened: true; readonly tabName: string }
  | { readonly opened: false; readonly reason: 'no-target-repo' | 'unknown-repo' };

export interface PreparedMessageInput {
  readonly phase: string;
  readonly targetRepo: string | null;
  readonly inputPath: string;
  readonly outcome: SessionOpenOutcome;
}

/**
 * A frase que o card mostra logo depois do "Preparar". Nos três casos ela diz a
 * mesma coisa por caminhos diferentes: **o que o app fez e o que falta**. O
 * disparo que não abriu sessão não vira silêncio nem erro genérico — vira o
 * motivo, com o caminho do contexto que já está em disco.
 */
export function preparedMessage(input: PreparedMessageInput): string {
  if (input.outcome.opened) {
    return `Fase "${input.phase}" preparada: a sessão abriu na aba "${input.outcome.tabName}" com o comando já escrito. O Enter é seu — o app nunca envia por você.`;
  }

  if (input.outcome.reason === 'unknown-repo') {
    return `Fase "${input.phase}" preparada, mas a sessão não abriu: não conheço o repo "${input.targetRepo ?? ''}" entre os projetos configurados, e o app não abre noutro lugar por palpite. O contexto está em ${input.inputPath}.`;
  }

  return `Fase "${input.phase}" preparada, mas a sessão não abriu: este card está sem repo alvo, e é ele que diz onde a sessão roda. O contexto está em ${input.inputPath}.`;
}

/**
 * Em que pé está a trava do card — **um estado, um fato**. A distinção nasceu do
 * print 07 do roteiro `disparo-abre-sessao`: o bloco dizia "Em andamento"
 * enquanto o print 10, da mesma rodada, mostrava o comando parado no prompt.
 *
 * O app sabe que a aba abriu e que o CLI devolveu um id. Ele **não** sabe se
 * alguém apertou o Enter — e não pode saber, porque enviar é gesto humano
 * (invariante 2). "Em andamento" fica reservado para quando existe alguém
 * declarando que está tocando a fase: a trava posta pela própria skill.
 */
export type LockState =
  /** A skill declarou a trava: há trabalho acontecendo, dito por quem o faz. */
  | 'running'
  /** O app abriu a aba e o CLI assumiu a sessão. A aba existe; o resto é com você. */
  | 'session-open'
  /** O contexto está em disco e o card travado; nenhuma sessão assumiu. */
  | 'prepared';

export function lockStateOf(holderKind: 'skill' | 'app', claimed: boolean): LockState {
  if (holderKind === 'skill') return 'running';
  return claimed ? 'session-open' : 'prepared';
}

/**
 * Como cada estado da trava se chama — a palavra nasce aqui, e só aqui.
 *
 * Exportado porque quem monta a frase do bloco "Disparar fase" precisa do card
 * inteiro (para nomear o ASSUNTO da trava, achado do B3) e por isso mora em
 * `esteiraView`. O que ele NÃO pode fazer é reescrever a palavra: quando havia
 * duas tabelas, "sessão aberta" virava "preparada" na segunda.
 */
export const LOCK_WORD: Readonly<Record<LockState, string>> = {
  running: 'em andamento',
  'session-open': 'com a sessão aberta',
  prepared: 'preparada',
};

/**
 * O que o bloco "Disparar fase" explica quando NÃO há trava — a frase de "o que
 * o clique faz". Uma origem só para os dois chamadores (`dispatchHint` daqui, o
 * de `esteiraView`): duas redações da mesma promessa divergem no primeiro
 * conserto, e esta já divergiu — o texto antigo prometia "apontando para o
 * arquivo à mão" depois de o B1 fazer o app abrir a aba sozinho.
 */
export function noLockDispatchHint(): string {
  return 'O app separa o contexto no inbox, trava o card e abre a aba da sessão com o comando da skill já escrito. O Enter é seu.';
}

/**
 * O que o bloco "Disparar fase" explica antes do clique, para quem só tem o
 * ESTADO da trava em mãos. Fica aqui, e não no JSX, pela regra do repo: texto de
 * estado nasce na camada pura — foi assim que a correção de um rótulo deixou de
 * subir até a raiz e o bug voltou noutro lugar. Recebe o ESTADO, não um
 * booleano: com `locked: boolean` esta frase dizia "preparada" para um card cujo
 * bloco dizia "Em andamento".
 */
export function dispatchHint(lock: LockState | null): string {
  if (lock === null) return noLockDispatchHint();
  return `Há uma fase ${LOCK_WORD[lock]} neste card. Libere a trava acima antes de preparar outra.`;
}

/** A recusa do disparo quando o card já está travado — mesmo vocabulário do bloco. */
export function dispatchRefusedMessage(lock: LockState, phase: string, since: string): string {
  return `Já há uma fase ${LOCK_WORD[lock]} (${phase}), desde ${since}.`;
}

// ---------------------------------------------------------------------------
// B1 (batch N5, spec 010) — "retomar fase concluída por clique".
//
// Diferente do "Preparar" (que dispara uma fase NOVA, grava run-input.json e
// trava o card), retomar não dispara nada: reabre a conversa que já rodou —
// `claude -r <cliSessionId>` no MESMO cwd — sem tocar no store. Quem muda
// estado é fato declarado por skill; o gesto de abrir não é um deles. Por
// isso esta função não sabe nada de `dispatch`/lock — só decide QUAL sessão.
// ---------------------------------------------------------------------------

/**
 * A ÚLTIMA sessão da cadeia — a que "Retomar" reabre.
 *
 * `SessionSnapshot.continuesSessionId` aponta para TRÁS (a sessão que esta
 * continua, quando o CLI trocou de sessão por orçamento de contexto —
 * `[P-6]`). A cauda da cadeia é a única sessão que ninguém mais continua;
 * retomar a primeira reabriria uma conversa que o CLI já superou.
 */
export function lastSessionOfChain(sessions: readonly SessionSnapshot[]): SessionSnapshot | null {
  if (sessions.length === 0) return null;
  const continuadas = new Set(
    sessions.map((session) => session.continuesSessionId).filter((id): id is string => id !== null),
  );
  return sessions.find((session) => !continuadas.has(session.id)) ?? sessions[sessions.length - 1]!;
}

export type ResumeResolution =
  | { readonly ok: true; readonly cliSessionId: string; readonly cwd: string }
  | { readonly ok: false; readonly reason: 'no-session' | 'no-cli-session-id' | 'no-cwd' };

/**
 * O que falta (ou não) para "Retomar" funcionar, a partir das sessões JÁ
 * FILTRADAS por assunto+fase (`esteiraView.phaseSessions`). Sem `cliSessionId`
 * é uma fase que rodou sem o app abrir aba nenhuma (seed, ou skill fora do
 * disparo) — não há sessão de CLI para reabrir. Sem `cwd` é um registro
 * incompleto — sem ele não há onde a aba nova abriria.
 */
export function resolveResume(sessions: readonly SessionSnapshot[]): ResumeResolution {
  const last = lastSessionOfChain(sessions);
  if (last === null) return { ok: false, reason: 'no-session' };
  if (last.cliSessionId === null) return { ok: false, reason: 'no-cli-session-id' };
  if (last.cwd === null) return { ok: false, reason: 'no-cwd' };
  return { ok: true, cliSessionId: last.cliSessionId, cwd: last.cwd };
}
