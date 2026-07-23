import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@donel-dev/design-system';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { parseClaudeNotFound } from '../../shared';
import type { PtyExitInfo, SemaphoreStateInfo } from '../../shared';
import { isTrustDialogVisible } from '../../shared/trustDialog';
import { formatRingBufferPreview } from './ringBufferPreview';
import styles from './TerminalPane.module.css';

// T004 deu a base (xterm + PtyManager). T005 liga a aba a uma sessão claude
// de verdade (FR-006, plan.md ponto 1): resolução do executável no main
// process (CA-5 se não achar), estado "sessão encerrada" no corpo do
// terminal quando o processo `claude` sai sozinho (ações Reabrir/Fechar aba,
// ui-spec §2 "Estados da vista"). Abas múltiplas / fechar de verdade na
// barra de abas chegam em T010 — `onCloseTab` ausente = a própria aba mostra
// um estado neutro de "fechada" em vez de fingir remover a aba da barra.

const XTERM_THEME = {
  background: '#0e1116',
  foreground: '#d7dde5',
  cursor: '#4c9cf0',
  cursorAccent: '#0e1116',
  selectionBackground: '#28303b',
};

type PaneStatus =
  | { kind: 'connecting' }
  | { kind: 'running' }
  | { kind: 'ended'; info: PtyExitInfo }
  | { kind: 'claude-not-found'; expectedPath: string }
  | { kind: 'closed' };

export interface TerminalPaneProps {
  /** 'claude' (T005) = sessão claude direta no PTY; 'shell' = terminal livre (FR-008, default T004). */
  sessionType?: 'shell' | 'claude';
  cwd?: string;
  /** Argv do Launcher (T008 — CommandBuilder, FR-003). Fixo por aba: só lido no spawn/reabertura, nunca muda no meio da sessão viva (isso é FR-011, T011). */
  args?: string[];
  /** Ação real de fechar a aba na barra de abas (T010): App.tsx remove a aba do array (unmount cuida do teardown do PTY). */
  onCloseTab?: () => void;
  /**
   * T009 — semáforo de sessões (FR-010). TerminalPane é quem conhece o
   * `ptyId` de verdade (nasce da resposta de `pty.create`, nunca sobe pro
   * App.tsx) — por isso é ele quem assina `semaphore.onUpdate` e "levanta" o
   * estado pro pai (sidebar/tab bar, ui-spec §2/§3) via este callback, em vez
   * do App.tsx tentar re-derivar o ptyId por fora.
   */
  onStateChange?: (info: SemaphoreStateInfo) => void;
  /**
   * T010 — FR-006: "fechar aba com sessão ativa (processo vivo) pede
   * confirmação". App.tsx só sabe se HÁ um processo vivo através deste sinal
   * (funciona tanto para sessão claude quanto para terminal livre — o
   * semáforo, ao contrário, só existe para 'claude'). `true` só quando
   * `status.kind === 'running'`.
   */
  onAliveChange?: (alive: boolean) => void;
  /**
   * FIX (feedback E2E rodada 5) — perfil de NASCIMENTO desta sessão
   * (`PtyCreateResult.profile`, main/index.ts `activeProfileSlug`/`Name` NO
   * MOMENTO da criação — por valor, como `claudeConfigDir` já é, T014).
   * Chamado uma única vez, junto com `ptyIdRef.current = result.ptyId`
   * (mesmo instante que `onAliveChange(true)`/`setStatus('running')`
   * refletem). `undefined` só chega aqui pra sessão 'shell' (branch shell
   * do handler `pty:create` nunca preenche `profile`) — App.tsx decide o
   * que fazer com isso (`sessionAccountLabel.ts`).
   */
  onProfileResolved?: (profile: { slug: string; name: string } | undefined) => void;
}

/**
 * T011 (FR-011) — handle imperativo exposto via `ref`: quem chama decide
 * SE deve injetar (gate de estado ocioso, `canInjectLiveCommand` em
 * `shared/liveSessionInjection.ts`, aplicado em App.tsx/SessionDetails);
 * este componente só é "a boca pro stdin", igual ao próprio `term.onData`
 * (teclado real) já é — o `ptyId` continua nunca subindo pro App.tsx
 * (comentário de `onStateChange` acima), só o efeito de escrever nele.
 */
/**
 * Últimas linhas do buffer JÁ RENDERIZADO pelo xterm — generoso o bastante
 * (200, bem mais que uma tela de terminal normal) pra sobreviver a um
 * diálogo interativo do CLI (ex.: "Switch model?") sem perder a linha de
 * confirmação, sem varrer o scrollback inteiro (5000 linhas, `scrollback`
 * abaixo) a cada checagem.
 */
const RENDERED_TAIL_LINES = 200;

/**
 * FIX (auditoria rodada 5, achado alta "Fix 1 não funciona") — o auto-aceite
 * deixou de ser "tiro único no primeiro match" (engolido pelo CLI antes dele
 * armar o leitor de stdin, achado real validado empiricamente pela
 * auditoria) e virou "reenvia enquanto o diálogo continuar visível, com
 * teto". `isTrustDialogVisible` (shared/trustDialog.ts) exige a assinatura
 * COMPLETA do rodapé interativo (não a primeira linha pintada) — ver
 * `armTrustAutoAccept` abaixo.
 */
const TRUST_AUTO_ACCEPT_RETRY_MS = 300;
/** Teto de tentativas — se o diálogo continuar visível após isso, desiste e deixa o hint diagnóstico (App.tsx `possiblyBlockedOnPrompt`) orientar o usuário a resolver na mão. */
const TRUST_AUTO_ACCEPT_MAX_ATTEMPTS = 8;
/**
 * FIX (auditoria rodada 5, achado media "janela sem SessionStart") — desarme
 * INCONDICIONAL por tempo, independente de o diálogo ter aparecido ou não:
 * o diálogo pré-REPL aparece nos primeiros segundos do spawn ou não aparece
 * (pasta já confiável); depois disso, manter o armamento só aumenta a
 * chance de casar texto digitado pelo usuário/ecoado pelo CLI.
 */
const TRUST_AUTO_ACCEPT_WINDOW_MS = 15_000;

export interface TerminalPaneHandle {
  /** Escreve `command` no stdin do PTY desta aba. Devolve `false` (no-op) sem processo vivo — quem chama decide o que fazer com isso (ex.: degradação FR-011 "reiniciar com a flag"). */
  injectCommand: (command: string) => boolean;
  /**
   * T013 (correção herdada) — últimas ~200 linhas do buffer JÁ RENDERIZADO
   * do xterm (`term.buffer.active`). Duas alternativas foram tentadas e
   * DESCARTADAS rodando contra o CLI real (não fixture) antes desta —
   * detalhes em shared/liveSessionInjection.ts: (1) o ring buffer do main
   * process (`window.donel.pty.getPreview`) só fecha linha em `\n`/`\r\n`
   * real; (2) acumular o BYTE STREAM bruto (ANSI stripado) também falhou —
   * o achado foi que um redraw incremental (interface tipo Ink) pode
   * compor o texto final combinando um write NOVO com conteúdo que já
   * estava na grade do terminal, então "Set model to Sonnet 5" nunca
   * aparece como substring contígua no stream bruto, só no resultado JÁ
   * EMULADO pelo parser do xterm. Por isso a fonte tem que ser o buffer
   * renderizado — e pra não perder um frame TRANSIENTE (a confirmação
   * também some rápido, sobrescrita pelo próximo redraw), quem chama isso
   * faz via `onRenderedUpdate` (evento, não poll) logo abaixo, nunca
   * `setInterval`. `[]` sem terminal montado.
   */
  getRenderedLines: () => string[];
  /**
   * T013 (correção herdada) — notifica `listener` toda vez que um chunk de
   * output do PTY terminou de ser processado pelo parser do xterm (usa o
   * callback de conclusão do `term.write`, não um `setInterval` — só assim
   * garante ver um frame TRANSIENTE antes do próximo redraw sobrescrever
   * por cima; ver comentário de `getRenderedLines`). Retorna função de
   * unsubscribe.
   */
  onRenderedUpdate: (listener: () => void) => () => void;
}

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane(
  { sessionType = 'shell', cwd, args, onCloseTab, onStateChange, onAliveChange, onProfileResolved },
  ref
): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const unsubscribeDataRef = useRef<(() => void) | null>(null);
  const unsubscribeExitRef = useRef<(() => void) | null>(null);
  const unsubscribeSemaphoreRef = useRef<(() => void) | null>(null);
  // FIX (feedback E2E rodada 5) — "armado" só enquanto a sessão desta aba
  // ainda não recebeu NENHUM evento de hook/semáforo (ver `armTrustAutoAccept`
  // abaixo e a assinatura de `semaphore.onUpdate`, que desarma no primeiro
  // evento) NEM estourou o teto de tentativas/janela de tempo. Reset a cada
  // `spawnSession()` nova (mount inicial ou "Reabrir"), nunca lido fora deste
  // componente.
  const trustAutoAcceptArmedRef = useRef(false);
  // FIX (auditoria rodada 5) — handle do `setInterval` de retentativa do
  // auto-aceite (`armTrustAutoAccept`) e do `setTimeout` de desarme
  // incondicional por janela de tempo; `null` = nenhum dos dois em voo.
  // Limpos por `disarmTrustAutoAccept` (chamada em TODO ponto de saída:
  // sucesso, teto de tentativas, evento de semáforo, janela de tempo,
  // teardown).
  const trustAutoAcceptIntervalRef = useRef<number | null>(null);
  const trustAutoAcceptDeadlineTimerRef = useRef<number | null>(null);
  // FIX — geração do mount atual (substitui o antigo `disposedRef` booleano).
  // Incrementado tanto no INÍCIO do efeito de mount quanto no INÍCIO do
  // cleanup — cada `spawnSession()` captura o valor vigente no momento da
  // chamada (`requestEpoch`) e, quando a promise de `pty.create` resolve,
  // compara contra o valor ATUAL do ref: diferente = essa chamada pertence a
  // uma geração já descartada (StrictMode double-invoke em dev, ou unmount
  // real) e o PTY recém-criado é morto sem nunca virar "vivo" pro componente;
  // igual = ainda é a geração corrente, segue o fluxo normal. Um booleano
  // único não distingue "geração 1 descartada" de "geração 2, a atual" depois
  // que as duas já dispararam — as duas ficavam com a mesma flag `true`/
  // `false`, causando ou os dois pty's sendo mortos (bug original) ou os dois
  // sendo mantidos vivos (1 deles órfão, nunca gerenciado — 2 processos
  // `claude.exe` reais por aba em vez de 1). Contador resolve isso porque
  // cada geração tem um valor PRÓPRIO, nunca reutilizado.
  const mountEpochRef = useRef(0);
  // T013 (correção herdada) — assinantes de `onRenderedUpdate`, notificados a
  // cada chunk de PTY já processado pelo parser do xterm (ver comentário do
  // handle acima pro porquê de ser evento, não poll).
  const renderListenersRef = useRef(new Set<() => void>());
  const [status, setStatus] = useState<PaneStatus>({ kind: 'connecting' });

  // Ref pra sempre chamar a versão mais recente do callback sem precisar
  // re-assinar `semaphore.onUpdate` a cada render (o pai passa uma arrow
  // function nova a cada vez — o mesmo problema que `cwd`/`args` já evitam
  // ao serem lidos só no spawn inicial, ver eslint-disable mais abaixo).
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onAliveChangeRef = useRef(onAliveChange);
  onAliveChangeRef.current = onAliveChange;
  const onProfileResolvedRef = useRef(onProfileResolved);
  onProfileResolvedRef.current = onProfileResolved;

  // FIX (auditoria rodada 5, achado alta "Fix 1 não funciona") — ponto ÚNICO
  // de saída do auto-aceite: desarma a flag E limpa os DOIS timers (retry +
  // janela), idempotente (seguro chamar de novo com tudo já limpo). Chamado
  // em todo caminho de término: diálogo resolvido, teto de tentativas
  // estourado, primeiro evento de semáforo, janela de tempo esgotada, e
  // teardown do componente (nunca deixa um `setInterval` sobrevivendo à
  // aba).
  const disarmTrustAutoAccept = useCallback((): void => {
    trustAutoAcceptArmedRef.current = false;
    if (trustAutoAcceptIntervalRef.current !== null) {
      window.clearInterval(trustAutoAcceptIntervalRef.current);
      trustAutoAcceptIntervalRef.current = null;
    }
    if (trustAutoAcceptDeadlineTimerRef.current !== null) {
      window.clearTimeout(trustAutoAcceptDeadlineTimerRef.current);
      trustAutoAcceptDeadlineTimerRef.current = null;
    }
  }, []);

  // FIX (auditoria rodada 5, achado alta "Fix 1 não funciona") — CAUSA RAIZ
  // do bug original: o `\r` era enviado UMA ÚNICA VEZ no primeiro instante em
  // que o marcador aparecia no buffer, ANTES do CLI terminar de desenhar o
  // diálogo e armar o leitor de stdin — validado empiricamente pela
  // auditoria (o smoke `boot-tab-trust.spec.ts` falhou com o diálogo ainda
  // preso na tela). Substituído por um `setInterval` PRÓPRIO deste
  // componente (não depende de mais chunks `onData` chegarem depois do
  // diálogo pintado — não há garantia nenhuma disso): a cada tick, se
  // `isTrustDialogVisible` (assinatura COMPLETA do rodapé, não a primeira
  // linha) continuar batendo, reenvia `\r`; se sumiu depois de ao menos um
  // envio, foi aceito — desarma; se nunca apareceu, só espera; teto de
  // `TRUST_AUTO_ACCEPT_MAX_ATTEMPTS` evita loop indefinido num diálogo que
  // por algum motivo nunca fecha. `TRUST_AUTO_ACCEPT_WINDOW_MS` (achado
  // media "janela sem SessionStart") desarma incondicionalmente por tempo,
  // pra nunca ficar armado além da janela em que o diálogo pré-REPL
  // plausivelmente aparece.
  const armTrustAutoAccept = useCallback(
    (term: XTerm): void => {
      disarmTrustAutoAccept(); // defensivo: nunca deixa um timer anterior vazar pra este armamento novo.
      trustAutoAcceptArmedRef.current = true;
      let attempts = 0;
      trustAutoAcceptIntervalRef.current = window.setInterval(() => {
        if (!trustAutoAcceptArmedRef.current || !ptyIdRef.current) return;
        const buffer = term.buffer.active;
        const start = Math.max(0, buffer.length - RENDERED_TAIL_LINES);
        const lines: string[] = [];
        for (let i = start; i < buffer.length; i += 1) {
          const line = buffer.getLine(i);
          if (line) lines.push(line.translateToString(true));
        }
        if (isTrustDialogVisible(lines)) {
          attempts += 1;
          window.donel.pty.input(ptyIdRef.current, '\r');
          if (attempts >= TRUST_AUTO_ACCEPT_MAX_ATTEMPTS) disarmTrustAutoAccept();
          return;
        }
        if (attempts > 0) disarmTrustAutoAccept(); // diálogo sumiu depois de ao menos 1 envio — aceito, sucesso.
      }, TRUST_AUTO_ACCEPT_RETRY_MS);
      trustAutoAcceptDeadlineTimerRef.current = window.setTimeout(() => {
        disarmTrustAutoAccept();
      }, TRUST_AUTO_ACCEPT_WINDOW_MS);
    },
    [disarmTrustAutoAccept],
  );

  // T010 — reporta pro pai sempre que a "vivacidade" do processo muda (não
  // a cada render, só quando `status.kind` de fato transiciona) — é o sinal
  // que o App.tsx usa pra decidir se o "Fechar aba" da barra de abas precisa
  // de confirmação (FR-006). Roda para 'shell' e 'claude' igualmente.
  useEffect(() => {
    onAliveChangeRef.current?.(status.kind === 'running');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.kind]);

  // T011 (FR-011) — `injectCommand` lê `ptyIdRef` no momento da CHAMADA (não
  // captura o valor no momento em que o handle foi criado), por isso não
  // precisa de dependências: mesmo padrão de `term.onData` (linha ~161
  // abaixo), que também lê `ptyIdRef.current` "ao vivo" a cada tecla.
  useImperativeHandle(
    ref,
    () => ({
      injectCommand: (command: string): boolean => {
        if (!ptyIdRef.current) return false;
        window.donel.pty.input(ptyIdRef.current, command);
        return true;
      },
      getRenderedLines: (): string[] => {
        const term = termRef.current;
        if (!term) return [];
        const buffer = term.buffer.active;
        const start = Math.max(0, buffer.length - RENDERED_TAIL_LINES);
        const lines: string[] = [];
        for (let i = start; i < buffer.length; i += 1) {
          const line = buffer.getLine(i);
          if (line) lines.push(line.translateToString(true));
        }
        return lines;
      },
      onRenderedUpdate: (listener: () => void): (() => void) => {
        renderListenersRef.current.add(listener);
        return () => {
          renderListenersRef.current.delete(listener);
        };
      },
    }),
    []
  );

  const teardownPty = useCallback(() => {
    unsubscribeDataRef.current?.();
    unsubscribeExitRef.current?.();
    unsubscribeSemaphoreRef.current?.();
    unsubscribeDataRef.current = null;
    unsubscribeExitRef.current = null;
    unsubscribeSemaphoreRef.current = null;
    disarmTrustAutoAccept(); // FIX (auditoria rodada 5) — nunca deixa o retry do auto-aceite sobrevivendo a esta aba.
    if (ptyIdRef.current) {
      window.donel.pty.kill(ptyIdRef.current);
      ptyIdRef.current = null;
    }
  }, [disarmTrustAutoAccept]);

  const spawnSession = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    setStatus({ kind: 'connecting' });
    // Snapshot da geração vigente NO MOMENTO da chamada — não lido de novo
    // depois (ver comentário de `mountEpochRef` acima).
    const requestEpoch = mountEpochRef.current;
    // FIX (feedback E2E rodada 5) — só a aba boot/home nasce SEM `cwd`
    // (App.tsx `INITIAL_TABS`/`handleQuickNewClaudeSession` sem projeto
    // selecionado), o que faz PtyManager.create spawnar em `os.homedir()`
    // (pty-manager.ts). Abas com `cwd` de projeto ficam DE FORA de
    // propósito — ver `armTrustAutoAccept` abaixo pro porquê.
    const isBootSession = sessionType === 'claude' && cwd === undefined;

    void window.donel.pty
      .create({ cols: term.cols, rows: term.rows, cwd, sessionType, args })
      .then((result) => {
        if (requestEpoch !== mountEpochRef.current) {
          // Geração já descartada (StrictMode double-invoke em dev, ou a aba
          // foi desmontada de verdade antes da promise resolver) — mata o
          // PTY recém-criado sem nunca setar status:'running' nem assinar
          // onData/onExit/semaphore (ninguém vai ler essas assinaturas).
          window.donel.pty.kill(result.ptyId);
          return;
        }
        ptyIdRef.current = result.ptyId;
        setStatus({ kind: 'running' });
        // FIX (feedback E2E rodada 5) — perfil de nascimento desta sessão
        // (undefined pra 'shell', ver comentário do prop). Levantado uma
        // única vez, no mesmo instante que `onAliveChange(true)` reflete
        // (efeito de `status.kind` acima) — App.tsx grava por tab.id, nunca
        // reconsultado depois (mesmo espírito "por valor" de `claudeConfigDir`).
        onProfileResolvedRef.current?.(result.profile);
        // FIX (auditoria rodada 5) — arma o retry do auto-aceite só pra esta
        // geração desta aba; desarma sozinho quando o diálogo sumir do
        // buffer, no teto de tentativas, na janela de tempo OU no primeiro
        // evento de hook (assinatura de `semaphore.onUpdate` abaixo) — o que
        // vier primeiro (ver `armTrustAutoAccept`/`disarmTrustAutoAccept`).
        if (isBootSession) armTrustAutoAccept(term);

        // FIX (feedback E2E rodada 1, agravante do bug StrictMode) — replay
        // do ring buffer ANTES de assinar `onData` (ver comentário de topo
        // de ringBufferPreview.ts pro porquê do race: `ptyManager.create()`
        // spawna e começa a alimentar o ring buffer sincronamente no main,
        // antes do roundtrip do IPC chegar até aqui). `void` — best-effort,
        // nunca bloqueia a aba: se `pty:preview` falhar, cai pro comportamento
        // de antes (só o onData daqui pra frente), sem preview nenhum.
        void window.donel.pty
          .getPreview(result.ptyId)
          .catch((): string[] => [])
          .then((lines) => {
            // A geração pode ter sido invalidada ENQUANTO o preview estava
            // em voo (StrictMode / unmount real) — mesma checagem de
            // `requestEpoch` do `.then()` de fora; sem ela escreveria num
            // xterm já `dispose()`d.
            if (requestEpoch !== mountEpochRef.current) return;

            // FIX (feedback E2E rodada 5, CAUSA RAIZ) — a aba boot/home
            // (`isBootSession` acima) roda o CLI em `os.homedir()`, onde o
            // trust de pasta NUNCA é persistido pelo binário (string do
            // próprio `claude`, não algo que este app controle) — o
            // diálogo pré-REPL ("Quick safety check") aparece TODA vez.
            // Enquanto ele está na tela, nenhum hook do semáforo dispara
            // (não houve prompt ainda: hooks-settings.ts só cobre
            // UserPromptSubmit/PreToolUse/PostToolUse/Stop/Notification/
            // SessionEnd), então `semaphoreState` da aba nunca sai de
            // `undefined` e `canInjectLiveCommand` (liveSessionInjection.ts)
            // fica preso pra sempre — a menos que alguém aperte Enter no
            // terminal na mão (o que os smokes existentes fazem
            // manualmente, ver terminal.spec.ts). O auto-aceite de verdade
            // é o `setInterval` de `armTrustAutoAccept` (acima), que já
            // começou a rodar ANTES deste `.then()` resolver — ele lê
            // `term.buffer.active` no seu próprio ritmo, independente de
            // `onData`/`term.write` disparar de novo (achado da auditoria:
            // depender só de chunks futuros de `onData` é o que quebrava o
            // fix anterior, já que o diálogo pode ser a ÚLTIMA coisa que o
            // CLI escreve antes de ficar esperando o Enter).
            //
            // FIX (feedback E2E rodada 1, agravante do bug StrictMode) — o
            // replay do ring buffer aqui só cuida de MOSTRAR pro usuário o
            // que já rodou antes de `onData` ser assinado (ver comentário de
            // topo de ringBufferPreview.ts) — não precisa mais orquestrar
            // auto-aceite nenhum, o `setInterval` acima já cobre esse caso
            // (inclusive se o diálogo inteiro só existir neste replay).
            const preview = formatRingBufferPreview(lines);
            if (preview) term.write(preview);

            unsubscribeDataRef.current = window.donel.pty.onData(result.ptyId, (data) => {
              // T013 (correção herdada) — o 2º argumento de `write` é o
              // callback de CONCLUSÃO do parser (documentado no xterm.js):
              // só dispara `onRenderedUpdate` depois que ESTE chunk já
              // virou estado real do buffer (`term.buffer.active`), nunca
              // antes — é o que garante ver um frame de confirmação
              // transiente ANTES do próximo redraw sobrescrever por cima
              // (ver comentário do handle acima).
              term.write(data, () => {
                renderListenersRef.current.forEach((listener) => listener());
              });
            });
          });

        unsubscribeExitRef.current = window.donel.pty.onExit(result.ptyId, (info) => {
          ptyIdRef.current = null;
          disarmTrustAutoAccept(); // FIX (auditoria rodada 5) — processo morreu; nenhum retry faz sentido continuar (tick seguinte já era no-op via guard de `ptyIdRef`, isto só evita esperar até a janela de tempo).
          setStatus({ kind: 'ended', info });
        });
        // Sessão de terminal livre (FR-008) nunca é registrada no semáforo
        // pelo main process — sem sessionType 'claude', simplesmente não
        // chega update nenhum aqui (nada a filtrar deste lado).
        unsubscribeSemaphoreRef.current = window.donel.semaphore.onUpdate(result.ptyId, (info) => {
          // FIX (feedback E2E rodada 5) — primeiro evento de hook = sessão
          // já em uso normal (usuário/CLI seguiu adiante sozinho); desarma
          // o auto-aceite pra nunca mais tocar o stdin sozinho depois disso
          // (mitiga falso positivo de "trust this folder" citado numa
          // resposta real).
          disarmTrustAutoAccept();
          onStateChangeRef.current?.(info);
        });
      })
      .catch((error: unknown) => {
        if (requestEpoch !== mountEpochRef.current) return;
        const expectedPath = parseClaudeNotFound(error);
        if (expectedPath) {
          setStatus({ kind: 'claude-not-found', expectedPath });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        term.write(`\r\n\x1b[31mFalha ao iniciar o terminal: ${message}\x1b[0m\r\n`);
        setStatus({ kind: 'ended', info: { exitCode: -1 } });
      });
  }, [cwd, sessionType, args, armTrustAutoAccept, disarmTrustAutoAccept]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    // FIX — React 18 <StrictMode> (main.tsx) double-invoca este efeito em dev
    // (mount -> cleanup -> mount) pra achar efeitos impuros. Cada mount é uma
    // geração NOVA (ver comentário de `mountEpochRef` acima) — sem isso, o
    // segundo mount herdava o sinal "descartado" do cleanup do primeiro (ou,
    // com um reset ingênuo pra um único boolean, os dois mounts ficavam
    // indistinguíveis um do outro depois de resolver). A aba ficava presa em
    // 'connecting' pra sempre (terminal vazio, digitação sem efeito, toolbar
    // mostrando "Sessão sem processo vivo") — ou, com o reset ingênuo, dois
    // processos `claude.exe` reais nasciam por aba e só um ficava gerenciado
    // (o outro, órfão, seguia vivo escrevendo no mesmo xterm).
    mountEpochRef.current += 1;

    const term = new XTerm({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12.5,
      theme: XTERM_THEME,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();
    termRef.current = term;

    term.onData((data) => {
      if (ptyIdRef.current) window.donel.pty.input(ptyIdRef.current, data);
    });

    spawnSession();

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ptyIdRef.current) window.donel.pty.resize(ptyIdRef.current, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    return () => {
      // Fecha esta geração — qualquer `pty.create` ainda pendente desta
      // geração vai ser reconhecido como stale quando resolver (ver
      // `mountEpochRef`/`spawnSession` acima), mesmo que um próximo mount
      // (StrictMode) ainda não tenha rodado pra abrir a geração seguinte.
      mountEpochRef.current += 1;
      resizeObserver.disconnect();
      teardownPty();
      term.dispose();
      termRef.current = null;
    };
    // `spawnSession`/`teardownPty` são estáveis por sessão (mount único); recriar a
    // sessão em si é feito via `handleReopen`, não por dependência de efeito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReopen = useCallback(() => {
    // Nova tentativa = nova geração (mesmo raciocínio do mount effect acima)
    // — invalida qualquer `pty.create` velho ainda pendente desta aba.
    mountEpochRef.current += 1;
    termRef.current?.clear();
    spawnSession();
  }, [spawnSession]);

  const handleCloseTab = useCallback(() => {
    teardownPty();
    if (onCloseTab) {
      onCloseTab();
      return;
    }
    setStatus({ kind: 'closed' });
  }, [onCloseTab, teardownPty]);

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.container} data-testid="terminal-pane" />

      {status.kind === 'claude-not-found' ? (
        <div className={styles.overlay} data-testid="claude-not-found-banner">
          <div className={styles.banner}>
            <p className={styles.bannerTitle}>⚠ Claude Code não encontrado</p>
            <p className={styles.bannerText}>
              Não achamos o <code>claude</code> no PATH nem em{' '}
              <code className={styles.bannerPath}>{status.expectedPath}</code>.
            </p>
            <p className={styles.bannerHint}>Instale o Claude Code CLI ou adicione-o ao PATH e tente novamente.</p>
            <div className={styles.overlayActions}>
              <Button variant="primary" onClick={handleReopen}>
                Tentar novamente
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {status.kind === 'ended' ? (
        <div className={styles.overlay} data-testid="session-ended-overlay">
          <div className={styles.banner}>
            <p className={styles.bannerTitle}>Sessão encerrada</p>
            <p className={styles.bannerText}>
              O processo saiu{status.info.exitCode !== undefined ? ` (código ${status.info.exitCode})` : ''}.
            </p>
            <div className={styles.overlayActions}>
              <Button variant="primary" onClick={handleReopen}>
                Reabrir
              </Button>
              <Button variant="secondary" onClick={handleCloseTab}>
                Fechar aba
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {status.kind === 'closed' ? (
        <div className={styles.overlay} data-testid="tab-closed-placeholder">
          <div className={styles.banner}>
            <p className={styles.bannerText}>Aba fechada.</p>
            <div className={styles.overlayActions}>
              <Button variant="primary" onClick={handleReopen}>
                Nova sessão
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});
