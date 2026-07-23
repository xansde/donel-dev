// T011 — Injeção de modelo/esforço em sessão viva (FR-011, plan.md ponto 7)
//
// Funções puras (sem I/O) que decidem SE e O QUE escrever no stdin de uma
// sessão claude já rodando pra trocar modelo/esforço sem reiniciar. Mesmo
// espírito do CommandBuilder (T006): quem de fato escreve no PTY é
// TerminalPane.injectCommand (via window.donel.pty.input), chamado pelo
// App.tsx/SessionDetails só depois de checar `canInjectLiveCommand`.
//
// Achado da implementação (verificado nas strings do binário instalado,
// `claude --version` = 2.1.218, `~/.local/share/claude/versions/2.1.218`):
// TANTO `/model <name>` QUANTO `/effort <level>` existem como slash commands
// interativos reais — não só `/model` (evidência: "Usage: /model <name>.
// Available: ..." e "Set model to X (session-scoped, not persisted)" pro
// primeiro; "Usage: /effort <low|medium|high|xhigh|...|auto>" e "Set effort
// level to X" pro segundo). Por isso a "degradação" prevista no FR-011
// ("se não houver comando nativo... a UI oferece reiniciar com a flag") NÃO
// se aplica por falta de comando — ela entra só quando não há PROCESSO VIVO
// pra receber stdin (sessão 'done'/'error'/ainda conectando): aí sim a UI
// (App.tsx `handleRestartWithConfig`) fecha a aba e abre uma sessão nova com
// `--model`/`--effort` via CommandBuilder, aceitando perder o contexto (o
// próprio texto do FR-011 já prevê isso pro caminho degradado — a DoD de
// "sem perder contexto" vale pro caminho principal de injeção, não pra
// degradação).

import type { SemaphoreState } from './index';
import type { EffortLevel, ModelAlias } from './commandBuilder';

/**
 * FR-011: "o app só injeta quando o prompt está ocioso (nunca no meio de
 * digitação do usuário)". `'waiting'` é o único estado do semáforo
 * (semaphore-state-machine.ts) que corresponde a "turno concluído, prompt
 * ocioso" — `'working'` tem o CLI processando, `'permission'` tem um prompt
 * de confirmação bloqueando o stdin (escrever `/model` ali cairia dentro da
 * pergunta y/n, não no prompt de comando), `'error'`/`'done'`/`undefined`
 * não têm processo vivo. `alive` (T010 `aliveTabs`, sinal independente via
 * `onAliveChange`) é uma segunda checagem pro mesmo caso "sem processo" —
 * defesa em profundidade contra a corrida rara em que o semáforo ainda não
 * refletiu o `processExit` no instante do clique.
 */
export function canInjectLiveCommand(state: SemaphoreState | undefined, alive: boolean): boolean {
  return alive && state === 'waiting';
}

/**
 * `/model <alias>\r` — o `\r` (Enter) precisa ir junto: o texto é aplicado
 * no PTY pelo mesmo canal (`pty:input`) que o teclado real usa (TerminalPane
 * `term.onData`), então sem o Enter o comando só fica digitado, nunca
 * submetido.
 */
export function buildModelInjection(model: ModelAlias): string {
  return `/model ${model}\r`;
}

/** `/effort <level>\r` — idem `buildModelInjection` acima. */
export function buildEffortInjection(effort: EffortLevel): string {
  return `/effort ${effort}\r`;
}
