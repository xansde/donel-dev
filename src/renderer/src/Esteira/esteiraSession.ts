import { isSafeToSendEnter, readInputBox } from '../../../shared/cliInputBox';
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
//    `esteiraPhaseCommand` nunca contém `\r`/`\n` — é o texto PRÉ-DIGITADO,
//    mostrado igual na aba e na frase de "próximo passo" manual. Quem escreve
//    no PTY é o App.tsx, pelo canal `pty:input`, sempre com texto puro.
//
//    **Batch B5 (05/08, pedido literal do dono) abre uma exceção NOMEADA e
//    FECHADA a este invariante**: `autoStartWriteSteps` (mais abaixo, até
//    11/08 chamada `withAutoEnter`) é a ÚNICA função deste repo que produz
//    o Enter (`AUTO_START_ENTER`) para uma sessão de fase — e só é chamada
//    pelo caminho de disparo da esteira (`App.tsx`
//    `handleOpenEsteiraSession`), nunca pela abertura genérica de aba. O
//    gesto explícito continua sendo o clique em "Preparar"; o que some é a
//    SEGUNDA confirmação (apertar Enter dentro do terminal depois de ver o
//    comando escrito) — substituída por uma prova de que o CLI já aceita
//    input (o mesmo sinal de boot que o pré-digitar genérico usa).
//
//    **Emenda wi-esteira4-autostart-enter (11/08)**: até esta correção o
//    Enter saía COLADO ao comando, num write só (`withAutoEnter`). Era o
//    "bug fundador" da esteira — o texto aparecia digitado mas nunca era
//    submetido, sem toast nem erro. Ver o docstring de `autoStartWriteSteps`
//    para o achado e a correção.
// 2. **Alvo explícito, zero palpite** (D-6): repo que o app não conhece devolve
//    RECUSA com o nome do repo, nunca um segundo melhor palpite. A evidência 2
//    da spec é uma fase que abriu no repo errado por causa de um fallback
//    silencioso comentado no código como "palpite honesto".
//
// Emenda de 06/08 (dogfooding): a recusa por repo passou a acontecer ANTES de
// qualquer escrita — ver `repoRefusalMessage`. A regra de correspondência que
// decide isso mora em `findProject`, exportada para que a tela possa avisar com
// a MESMA régua do disparo.

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

  const match = findProject(wanted, projects);
  return match === null ? { ok: false, reason: 'unknown-repo' } : { ok: true, cwd: match.path };
}

/**
 * A regra de correspondência repo declarado → projeto conhecido, **uma só vez**.
 *
 * Nome OU caminho inteiro, ignorando caixa e barra final. Fica exportada porque
 * a tela precisa da MESMA regra para avisar sobre um repo impossível antes do
 * gesto (`repoScope.ts`): com duas implementações, a tela diria "tudo certo"
 * sobre um card que o disparo recusa — que é o incidente de 06/08 invertido.
 */
export function findProject(repo: string, projects: readonly KnownProject[]): KnownProject | null {
  const normalized = repo.trim().toLowerCase().replace(/[\\/]+$/, '').replace(/\\/g, '/');
  if (normalized.length === 0) return null;
  return (
    projects.find(
      (project) =>
        project.name.toLowerCase() === normalized ||
        project.path.toLowerCase().replace(/[\\/]+$/, '').replace(/\\/g, '/') === normalized,
    ) ?? null
  );
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

export interface PreparedMessageInput {
  readonly phase: string;
  readonly tabName: string;
}

/** A frase do disparo que deu certo: o que o app fez, e o que continua sendo seu. */
export function preparedMessage(input: PreparedMessageInput): string {
  return `Fase "${input.phase}" preparada: a sessão abriu na aba "${input.tabName}" com o comando já escrito. O app aperta o Enter sozinho, assim que o terminal aceitar entrada — nenhum gesto seu é necessário.`;
}

/**
 * O card que não declara repo — legítimo pela spec — prepara sem abrir aba. Não
 * há cwd a inventar, então o que o app entrega é o contexto em disco e o
 * comando para rodar onde fizer sentido.
 */
export function noRepoPreparedMessage(phase: string, inputPath: string): string {
  // `semQuebra` na frase INTEIRA, não só no comando: esta é a única mensagem da
  // tela que se copia e cola num prompt, e o caminho cru entra nela.
  return semQuebra(
    `Fase "${phase}" preparada, mas nenhuma aba abriu: este card não declara repo, e é ele que diz onde a sessão roda. O contexto está em ${inputPath} — rode ${esteiraPhaseCommand(phase, inputPath)} onde fizer sentido, ou dê uma âncora ao card.`,
  );
}

/**
 * A recusa por repo — dita **antes** de qualquer escrita.
 *
 * Até 06/08 esta frase começava com "preparada, mas a sessão não abriu": o
 * disparo gravava o `run-input.json` e travava o card, e só então descobria que
 * o repo era impossível. O card ficava preso num trabalho que nunca começou,
 * esperando um gesto de "Liberar trava" para um contexto que ninguém ia usar.
 *
 * Agora o cwd é resolvido primeiro e a recusa não deixa resíduo — por isso a
 * frase diz, com todas as letras, que nada foi gravado e nada ficou travado.
 * Uma recusa que não conta o que NÃO fez ensina o operador a procurar sujeira.
 */
export function repoRefusalMessage(phase: string, targetRepo: string | null, reason: 'no-target-repo' | 'unknown-repo'): string {
  const motivo =
    reason === 'unknown-repo'
      ? `não conheço o repo "${targetRepo ?? ''}" entre os projetos configurados, e o app não abre noutro lugar por palpite`
      : 'este card está sem repo alvo, e é ele que diz onde a sessão roda';
  const saida = reason === 'unknown-repo' ? 'Ajuste o repo alvo do card' : 'Escolha a âncora do card';
  return `Fase "${phase}" NÃO foi preparada: ${motivo}. Nada foi gravado e o card não ficou travado — ${saida} e prepare de novo.`;
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
 * O Enter que o auto-start manda — sempre um write PRÓPRIO, nunca colado ao
 * texto do comando (ver `autoStartWriteSteps` logo abaixo para o motivo).
 * Mesmo caractere usado em `buildModelInjection`/`buildEffortInjection`
 * (`shared/liveSessionInjection.ts`) — lá o `\r` pode ir colado ao comando
 * porque a sessão já está `'waiting'` (turno anterior concluído, ninguém
 * mais escrevendo); aqui a sessão está no MEIO do boot do REPL, e é
 * exatamente esse contexto que expôs o problema abaixo.
 */
export const AUTO_START_ENTER = '\r';

/**
 * O PLANO de escrita do auto-start: `[texto, Enter]` — sempre DOIS passos,
 * nunca um write único combinando os dois.
 *
 * **O que estava escrito aqui até 13/08 estava ERRADO.** A correção de 11/08
 * (PR #59) trocou o write único (`` `${command}\r` ``, então `withAutoEnter`)
 * por dois writes, com a justificativa de que o REPL trataria qualquer chunk
 * de stdin com mais de um caractere como colagem em bloco (bracketed paste),
 * engolindo o `\r` embutido. A bateria manual de 13/08 REPROVOU essa teoria
 * (`docs/relatorio-bateria-enter-2026-08-13.md`):
 *
 *  - separar os writes NÃO consertou — o comando continua aparecendo digitado
 *    e não submetido;
 *  - o bug reproduz FORA do app, com `node-pty` direto contra `claude.exe`;
 *  - o Enter do app e o Enter humano são o MESMO byte pelo MESMO caminho
 *    (`injectCommand` → `pty.input('\r')`), o que a teoria da colagem não
 *    explicaria — a digitação humana é tecla-a-tecla e falha igual;
 *  - a falha é NÃO DETERMINÍSTICA: varredura 50/150/400/1000/2000 ms não
 *    monotônica, e 0/6 repetindo o mesmo 150 ms. **Nenhum valor de
 *    `AUTO_START_ENTER_DELAY_MS` conserta isso.**
 *
 * **Os dois passos CONTINUAM** — como higiene, não como cura: um `\r` sozinho
 * é inequívoco, não custa nada e não há evidência de que atrapalhe. A causa
 * raiz exata segue em aberto (a pista mais forte é a prontidão real do CLI: a
 * marca de "pronto" é pintada ANTES de o REPL aceitar submissão).
 *
 * **O que de fato conserta** está logo abaixo, em
 * `classifyAutoStartSubmission`/`nextAutoStartEnterAction`: o app deixou de
 * tratar "escrevi no stdin" como "o CLI executou" — ele confirma no buffer
 * renderizado que a linha saiu da caixa de input, reenvia o Enter com teto, e
 * quando não consegue confirmar DIZ isso num toast, em vez de encerrar calado.
 */
export function autoStartWriteSteps(command: string): readonly [string, string] {
  return [command, AUTO_START_ENTER];
}

// ---------------------------------------------------------------------------
// wi-esteira4-enter-confirmado (13/08) — CONFIRMA E REENVIA
// ---------------------------------------------------------------------------
//
// O buraco que o próprio código já nomeava: `injectCommand` garante que o
// texto foi ESCRITO no stdin do PTY, nunca que o CLI o EXECUTOU — e o watcher
// tratava `written === true` como sucesso, encerrava, e por isso não havia
// toast nem erro. Silêncio era o sintoma.
//
// Agora o auto-start confirma no BUFFER RENDERIZADO que a linha saiu da caixa
// de input (`shared/cliInputBox.ts` tem o porquê de a caixa ser a única fonte
// confiável), reenvia o Enter com teto, e desiste falando.
//
// Duas funções, duas responsabilidades: uma lê o ESTADO, a outra decide a
// AÇÃO. Nenhuma toca timer nem relógio — recebe os ms como número, do mesmo
// jeito que o `primeSequencer` deixa o estado com quem chama.

/**
 * Espaço fora dos DOIS lados da comparação: o wrap parte a linha num ponto
 * arbitrário e `translateToString(true)` faz trimRight, comendo o espaço
 * exatamente na emenda. Comparar com espaço reprovaria um comando que está
 * inteiro na tela.
 */
function squashSpaces(value: string): string {
  return value.replace(/\s+/g, '');
}

export type AutoStartSubmissionVerdict =
  /** O comando NÃO está mais na caixa de input. Só é prova de submissão depois de o termos VISTO lá. */
  | 'gone'
  /** A caixa contém EXATAMENTE o nosso comando. Único veredito que pode autorizar um `\r`. */
  | 'still-typed'
  /** Não sei ler o estado, ou o que está na caixa é um pedaço do comando. NUNCA vira ação. */
  | 'unknown';

export interface AutoStartSubmissionInput {
  /** Cauda do buffer JÁ RENDERIZADO do xterm (`TerminalPaneHandle.getRenderedLines`). */
  readonly renderedLines: readonly string[];
  readonly command: string;
}

/**
 * TRÊS valores, nunca dois: reenviar em cima de "não achei a confirmação" é
 * exatamente o Enter danoso. A ambiguidade só tem uma saída permitida —
 * esperar, e no limite desistir dizendo.
 *
 * Repare no ECO PARCIAL: uma caixa com um PREFIXO próprio do comando é
 * `'unknown'`, não `'still-typed'` — um `\r` ali submeteria o comando
 * TRUNCADO. E repare que texto ESTRANHO na caixa (o placeholder que o CLI
 * desenha quando ela está vazia, ou alguém digitando por cima) é `'gone'`: o
 * nosso comando saiu de lá. `'gone'` nunca escreve nada, então errar para esse
 * lado custa no máximo um toast, jamais um byte.
 */
export function classifyAutoStartSubmission(input: AutoStartSubmissionInput): AutoStartSubmissionVerdict {
  const box = readInputBox(input.renderedLines);
  if (box.kind === 'menu' || box.kind === 'unreadable') return 'unknown';
  if (box.kind === 'empty') return 'gone';

  const shown = squashSpaces(box.text);
  const wanted = squashSpaces(input.command);
  if (shown === wanted) return 'still-typed';
  if (shown.length > 0 && wanted.startsWith(shown)) return 'unknown'; // eco a meio caminho
  return 'gone';
}

export { isSafeToSendEnter };

/**
 * Piso entre o write do TEXTO e o primeiro `\r` — o único pedaço do achado de
 * 11/08 que sobrevive: cada write chega como um chunk de stdin próprio. NÃO é
 * o mecanismo do conserto (a varredura 50/150/400/1000/2000 ms reprovou a
 * hipótese do delay, e mexer neste número é o caminho que o handoff fecha).
 * Migrou do `App.tsx` para cá porque agora é insumo de uma decisão pura.
 */
export const AUTO_START_ENTER_DELAY_MS = 50;

/**
 * Janela mínima entre um `\r` e a decisão de reenviar. Tem que ser maior que
 * "o CLI ainda não redesenhou depois do Enter" e menor que a paciência de quem
 * espera. Referências já calibradas neste repo: batching de saída do
 * `pty-manager` = 16 ms, debounce do transcript-watcher = 300 ms, poll de
 * prontidão = 250 ms. 1 s é 4 ticks de poll e 3× o maior debounce existente.
 */
export const AUTO_START_RESEND_GAP_MS = 1_000;

/**
 * Teto de Enters escritos, incluindo o primeiro. O 0/6 da bateria mostra que a
 * falha não é cauda rara — um reenvio só pode não bastar. Do outro lado, cada
 * tentativa estende a janela em que um modal pode aparecer entre frames. Se
 * três Enters legítimos, espaçados, com o veto limpo, deixam o comando parado,
 * a explicação já não é "o byte se perdeu" — é um estado que o leitor não
 * reconhece, e aí o quarto é mais arriscado que um toast.
 */
export const AUTO_START_MAX_ENTER_ATTEMPTS = 3;

/**
 * Teto para o comando APARECER na caixa depois de escrito. Do write até o eco
 * é trabalho local do REPL, não do modelo — 5 s são 20 ticks de poll. Se em 5 s
 * o comando não apareceu, ou o texto se perdeu (não há o que submeter) ou o
 * leitor está errado; nos dois casos mandar `\r` é ilegítimo. Estourar aqui
 * NUNCA escreve nada.
 */
export const AUTO_START_ECHO_TIMEOUT_MS = 5_000;

/**
 * Teto absoluto da confirmação, contado do write do texto: cobre o eco, as
 * três tentativas e a folga, e é a única saída de um `'unknown'` permanente
 * (menu na tela, moldura ilegível). Metade do teto de PRONTIDÃO (30 s), porque
 * lá se espera um processo nascer e aqui só um redraw.
 */
export const AUTO_START_CONFIRM_TIMEOUT_MS = 15_000;

export type AutoStartEnterAction =
  | 'wait'
  | 'send-enter'
  | 'confirmed'
  | 'give-up-no-echo'
  | 'give-up-attempts'
  | 'give-up-unconfirmed';

export interface AutoStartEnterInput {
  readonly verdict: AutoStartSubmissionVerdict;
  /** `isSafeToSendEnter` do MESMO frame — reavaliado imediatamente antes de cada escrita. */
  readonly safeToSend: boolean;
  /** Já vimos o comando dentro da caixa alguma vez nesta fase. */
  readonly sawEcho: boolean;
  /** Enters já escritos. 0 = nenhum ainda (estamos esperando o eco). */
  readonly attemptsUsed: number;
  /** ms desde o último write nesta aba (o texto, ou o Enter anterior). */
  readonly msSinceLastWrite: number;
  /** ms desde que o TEXTO foi escrito — o relógio único da fase. */
  readonly msSincePhaseStart: number;
}

/**
 * A política inteira. Três invariantes, e os testes travam os três:
 *
 *  1. `'unknown'` NUNCA vira `'send-enter'`, por mais tempo e tentativas que
 *     sobrem — é a armadilha nomeada no handoff (reenviar sobre uma linha que
 *     já submeteu manda linha vazia numa sessão que pode estar no meio de um
 *     turno; reenviar sobre um diálogo RESPONDE o diálogo).
 *  2. `safeToSend === false` NUNCA vira `'send-enter'`.
 *  3. `'gone'` só é sucesso depois do eco. Antes dele a caixa vazia é o estado
 *     NORMAL — aceitá-la seria reproduzir, em silêncio, o bug de hoje.
 *
 * O gatilho do PRIMEIRO Enter passou a ser o eco do comando na caixa, não o
 * relógio: é a prova de que o leitor de stdin do REPL está armado e consumiu o
 * que escrevemos — exatamente a hipótese aberta do handoff (a marca de
 * prontidão é pintada ANTES de o REPL aceitar submissão).
 */
export function nextAutoStartEnterAction(input: AutoStartEnterInput): AutoStartEnterAction {
  if (input.verdict === 'gone' && input.sawEcho) return 'confirmed';

  if (input.verdict === 'still-typed' && input.safeToSend) {
    const gap = input.attemptsUsed === 0 ? AUTO_START_ENTER_DELAY_MS : AUTO_START_RESEND_GAP_MS;
    if (input.msSinceLastWrite >= gap) {
      return input.attemptsUsed >= AUTO_START_MAX_ENTER_ATTEMPTS ? 'give-up-attempts' : 'send-enter';
    }
  }

  if (input.attemptsUsed === 0 && input.msSincePhaseStart >= AUTO_START_ECHO_TIMEOUT_MS) return 'give-up-no-echo';
  if (input.attemptsUsed > 0 && input.msSincePhaseStart >= AUTO_START_CONFIRM_TIMEOUT_MS) return 'give-up-unconfirmed';
  return 'wait';
}

/** Teto de PRONTIDÃO estourado: nada foi escrito, nem o texto. Continua verdadeiro, palavra por palavra. */
export const AUTO_START_NOT_READY_MESSAGE =
  'A sessão não ficou pronta a tempo — o comando não foi enviado. Rode-o você mesmo na aba.';

/**
 * Três desistências, três frases — porque o que a pessoa precisa fazer é
 * diferente em cada uma. Em especial: no caso `unconfirmed` o app NÃO manda
 * apertar Enter, porque não sabe o que está na tela; mandar seria terceirizar
 * ao humano o acidente que o app acabou de se recusar a cometer.
 */
export function autoStartGiveUpMessage(reason: 'no-echo' | 'attempts' | 'unconfirmed'): string {
  if (reason === 'no-echo') {
    return 'Escrevi o comando na aba, mas ele não apareceu no prompt da sessão — nenhum Enter foi enviado. Abra a aba e rode o comando você mesmo.';
  }
  if (reason === 'attempts') {
    return `Mandei o Enter ${AUTO_START_MAX_ENTER_ATTEMPTS} vezes e o comando continua digitado no prompt da aba. Abra a aba e aperte Enter.`;
  }
  return 'Não consegui confirmar se o comando foi enviado — pode haver algo na tela do terminal esperando resposta. Abra a aba e confira antes de apertar Enter.';
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
