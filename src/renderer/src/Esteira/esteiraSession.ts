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
//    `esteiraPhaseCommand` nunca contém `\r`/`\n` — é o texto PRÉ-DIGITADO,
//    mostrado igual na aba e na frase de "próximo passo" manual. Quem escreve
//    no PTY é o App.tsx, pelo canal `pty:input`, sempre com texto puro.
//
//    **Batch B5 (05/08, pedido literal do dono) abre uma exceção NOMEADA e
//    FECHADA a este invariante**: `withAutoEnter` (mais abaixo) é a ÚNICA
//    função deste repo que produz texto com `\r` para uma sessão de fase —
//    e só é chamada pelo caminho de disparo da esteira (`App.tsx`
//    `handleOpenEsteiraSession`), nunca pela abertura genérica de aba. O
//    gesto explícito continua sendo o clique em "Preparar"; o que some é a
//    SEGUNDA confirmação (apertar Enter dentro do terminal depois de ver o
//    comando escrito) — substituída por uma prova de que o CLI já aceita
//    input (o mesmo sinal de boot que o pré-digitar genérico usa).
// 2. **Alvo explícito, zero palpite** (D-6): repo que o app não conhece devolve
//    RECUSA com o nome do repo, nunca um segundo melhor palpite. A evidência 2
//    da spec é uma fase que abriu no repo errado por causa de um fallback
//    silencioso comentado no código como "palpite honesto".

import { hasClaudeReadyMarker, hasIdlePromptFooter } from '../../../shared/preTypeReadiness';
import { isTrustDialogVisible } from '../../../shared/trustDialog';

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
 *
 * A2 — o sufixo `-3` NÃO é decoração: o fork `esteira-donel-3.0.0` é
 * instalado em `~/.claude/skills/esteira-<fase>-3` exatamente com esse nome
 * (`skills/esteira-donel-3.0.0/README.md`, seção "Instalar"), para conviver
 * sem colidir com o plugin `esteira:` da 2.1.0, que responde ao MESMO nome
 * sem sufixo (`/esteira-discovery <card_id>` — outro formato de argumento,
 * incompatível com `--input <path>`). Sem o sufixo aqui, o texto pré-digitado
 * invoca o plugin 2.1.0 — reincidiu em SEIS runs seguidos antes desta
 * correção, porque os dois nomes são idênticos e o CLI não tem como saber
 * qual dos dois a pessoa quis dizer.
 */
export function esteiraPhaseCommand(phase: string, inputPath: string): string {
  return semQuebra(`/esteira-${phase.trim()}-3 --input "${inputPath}"`);
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
    return `Fase "${input.phase}" preparada: a sessão abriu na aba "${input.outcome.tabName}" com o comando já escrito. O app aperta o Enter sozinho, assim que o terminal aceitar entrada — nenhum gesto seu é necessário.`;
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
 * O app sabe que a aba abriu e que o CLI devolveu um id. Isso não é a SKILL
 * declarando que está trabalhando — só ela pode dizer isso (invariante que
 * sobrevive ao B5: mesmo com o Enter automático, ninguém além da skill afirma
 * que a fase está rodando). "Em andamento" fica reservado para quando existe
 * alguém declarando que está tocando a fase: a trava posta pela própria skill.
 *
 * (Histórico: antes do B5, 05/08, esta distinção também carregava "o app não
 * sabe se alguém enviou o Enter" — verdade enquanto enviar era só gesto
 * humano. `withAutoEnter` fechou essa lacuna; o texto que a citava
 * (`lockView`, estado `session-open`) foi corrigido junto.)
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
 * conserto, e esta já divergiu duas vezes — o texto original prometia
 * "apontando para o arquivo à mão" depois de o B1 fazer o app abrir a aba
 * sozinho; depois prometia "o Enter é seu" depois de o B5 fazer o app apertar
 * o próprio Enter (achado da captura `auto-start-e-redisparo-recusado`, 05/08).
 */
export function noLockDispatchHint(): string {
  return 'O app separa o contexto no inbox, trava o card e abre a aba da sessão com o comando da skill já escrito — e aperta o Enter sozinho, assim que o terminal aceitar entrada. Nenhum gesto seu é necessário.';
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

/**
 * A1 — a recusa quando a fase já concluiu sobre o MESMO assunto. `since` vem
 * já formatado (o mesmo padrão de `dispatchRefusedMessage`): a camada pura
 * decide o TEXTO, quem chama decide a formatação de data, para os dois nunca
 * divergirem em fuso ou estilo.
 */
export function phaseDoneRefusedMessage(phase: string, outcome: 'done' | 'abandoned' | 'inconclusive' | null, since: string): string {
  const outcomeWord = outcome === 'done' ? 'concluída' : outcome === 'abandoned' ? 'abandonada' : 'terminou sem conclusão';
  return `A fase "${phase}" já está ${outcomeWord} para este assunto, desde ${since}. Para rodar de novo, confirme explicitamente a reabertura.`;
}

/**
 * A8/A20 — a recusa quando o REPO (+ caminho) que esta fase tocaria já está
 * ocupado por outro assunto (irmão) — o buraco que a trava por assunto não
 * fecha (P32: "worker rodou na árvore principal enquanto outra sessão
 * comitava nela"). Nomeia o repo, a branch quando conhecida, e QUEM segura
 * (a fase de outro assunto) — "registro visível" (A20) começa na frase que a
 * pessoa lê no instante da recusa.
 */
export function resourceBusyRefusedMessage(targetRepo: string, branch: string | null, holderPhase: string, since: string): string {
  const ondeMais = branch ? ` (branch "${branch}")` : '';
  return `O repositório "${targetRepo}"${ondeMais} já está ocupado pela fase "${holderPhase}" de outro assunto, desde ${since} — para não cruzar commits na mesma árvore. Espere ela terminar ou libere a trava dela.`;
}

/**
 * B3 — a recusa quando já existe uma sessão VIVA para o MESMO assunto+fase,
 * mesmo sem trava (ex.: a trava caiu por um `releaseLock` manual, mas a
 * sessão que a segurava nunca terminou). Duas abas concorrentes tocando o
 * mesmo trabalho é o caos que a trava deveria impedir sozinha.
 */
export function sessionActiveRefusedMessage(phase: string, since: string): string {
  return `Já há uma sessão aberta para a fase "${phase}" deste assunto, desde ${since}. Encerre-a (ou espere ela terminar) antes de preparar outra.`;
}

// ---------------------------------------------------------------------------
// Batch B5 — AUTO-START: a sessão de fase aperta o próprio Enter
// ---------------------------------------------------------------------------
//
// Ver o parágrafo do invariante 1, no topo do arquivo, para o porquê deste
// bloco existir separado do resto: é uma exceção NOMEADA e FECHADA, não uma
// reinterpretação do invariante.

/**
 * A prova de que o CLI já aceita input — o MESMO sinal de boot que libera o
 * primeiro passo do pré-digitar genérico (`isReadyToPreType` em
 * `shared/preTypeReadiness.ts`, `isFirstStep: true`): o banner de boas-vindas
 * do REPL, ou a barra de status do prompt ocioso quando o banner já saiu do
 * viewport. Nunca com o diálogo de confiança de pasta na tela — um `\r`
 * disparado ali cairia dentro da pergunta "trust this folder?", que é
 * exatamente a classe de acidente que o auto-start não pode causar.
 *
 * Deliberadamente NÃO inclui o semáforo (`state === 'waiting'`): a sessão de
 * fase é sempre NOVA (nunca um `-r`/resume — `handleOpenEsteiraSession` abre
 * com `launchArgs: []`), e uma sessão nova nasce em `'working'` e só alcança
 * `'waiting'` depois do PRIMEIRO turno (achado já documentado em
 * `preTypeReadiness.ts`) — o auto-start precisa disparar ANTES de existir
 * turno nenhum, então esperar por `'waiting'` a faria nunca disparar.
 *
 * Reaproveita os detectores JÁ TESTADOS de `shared/preTypeReadiness.ts` /
 * `shared/trustDialog.ts` (o boot do CLI é um fato só, testado uma vez) —
 * mas mora AQUI, ao lado do resto das decisões do disparo, porque é este
 * módulo (não o genérico) que decide QUANDO o auto-envio se aplica.
 */
export interface AutoStartReadinessInput {
  readonly renderedLines: readonly string[];
}

export function isReadyForAutoStart(input: AutoStartReadinessInput): boolean {
  if (isTrustDialogVisible(input.renderedLines)) return false;
  return hasClaudeReadyMarker(input.renderedLines) || hasIdlePromptFooter(input.renderedLines);
}

/**
 * O texto que o auto-start ENVIA: o MESMO comando pré-digitado
 * (`esteiraPhaseCommand` — uma função só produz o texto, para a correção de
 * um não envelhecer o outro), com o Enter colado num write só. Mesmo padrão
 * já usado para injeção em sessão viva (`buildModelInjection`,
 * `shared/liveSessionInjection.ts`: `` `/model ${model}\r` ``) — texto +
 * Enter num write só é mais seguro que dois writes separados, porque não há
 * janela entre "digitou" e "enviou" para uma corrida acontecer.
 */
export function withAutoEnter(command: string): string {
  return `${command}\r`;
}
