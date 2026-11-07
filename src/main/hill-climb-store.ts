// Hill climbing — the store of `<userData>/hill-climb.json` and the loop's ports (the MCP tools of the Escalador,
// the owner's gestures, the Oráculo's answer). Only the main writes the file. Same guards as the ledger: the
// whole document goes temp → rename, a newer `schemaVersion` is read and never written, and a file that cannot
// be read is shown as read-only instead of coming back empty (it would be written over).
//
// The loop in code lives here: a version comes in → it is checked against the loop's shape (inventory first,
// 3 directions from scratch, then climb the best) → the council judges it blind → `recordRound` counts the
// round and closes the rodada when it should. The proposal is a high-risk card in the Oráculo; the mission runs
// only after the owner accepts that card (`syncLedger`).

import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { ConfigIoDeps } from './config-store';
import {
  applyGesture,
  blindInput,
  CLOSE_REASON_LABEL,
  currentRodada,
  emptyHillClimbDoc,
  extraRodadasLeft,
  HILL_CLIMB_RULES,
  isNewerHillClimbDoc,
  lowestScore,
  nextStep,
  parseHillClimbDoc,
  proposeMission,
  recordRound,
  settleProposal,
  cannotSubmit,
  versionProblem,
  type HillClimbDoc,
  type HillClimbMission,
  type MissionRound,
  type OwnerGesture,
  type SubmittedVersion,
} from '../shared/hillClimb/contract';
import { convene, councilStatus, FAKE_JUDGES_ENV_VAR, fakeCouncil, type CouncilStatus, type JudgeProvider } from '../shared/hillClimb/council';
import type { HillClimbGestureResult, HillClimbSnapshot } from '../shared/hillClimb/channels';
import type { HillClimbToolCall } from '../shared/hillClimb/tools';
import type { LedgerActor, LedgerDoc, LedgerForOwner, LedgerOp } from '../shared/ledger/contract';
import type { LedgerApplyResult } from '../shared/ledger/channels';
import type { OwnerMessage } from './ledger-card-writer';

/** Smoke/test/demo override: isolates the missions from the real ones. */
export const HILL_CLIMB_FILE_ENV_VAR = 'DONEL_HILL_CLIMB_FILE';

export function hillClimbFilePath(env: Record<string, string | undefined>, userDataPath: string): string {
  const override = env[HILL_CLIMB_FILE_ENV_VAR];
  return override && override.trim() ? override : join(userDataPath, 'hill-climb.json');
}

/** The council the main can call. No LLM key exists yet: only the demo/test fake gives a ready council. */
export function resolveCouncil(env: Record<string, string | undefined>): JudgeProvider[] | null {
  return env[FAKE_JUDGES_ENV_VAR] === '1' ? fakeCouncil() : null;
}

/** What the Oráculo port needs: the same `apply` every other port uses. */
export interface HillClimbLedgerPort {
  apply(actor: LedgerActor, op: LedgerOp): Promise<LedgerApplyResult>;
}

export interface HillClimbCaller {
  readonly projectPath: string;
  readonly placeId: string;
}

export interface HillClimbServiceDeps {
  readonly filePath: string;
  readonly io: ConfigIoDeps;
  /** `null` = no key: the bar says so and no version is judged. */
  readonly council: () => readonly JudgeProvider[] | null;
  readonly fakeCouncil?: boolean;
  readonly now?: () => number;
  readonly newId?: () => string;
  /** `AAAA-MM-DD` of the proposal card's due date (default: a week from now). */
  readonly dueDate?: () => string;
  readonly onChange?: (snapshot: HillClimbSnapshot) => void;
  /** Tells the Escalador's session what the owner decided (the same send driver as the Oráculo's cards). */
  readonly notify?: (message: OwnerMessage) => void;
}

export interface HillClimbService {
  load(): HillClimbSnapshot;
  /** The Oráculo changed: settle every proposal whose card the owner decided. */
  syncLedger(ledger: LedgerDoc): void;
  gesture(missionId: string, gesture: OwnerGesture): HillClimbGestureResult;
  runTool(caller: HillClimbCaller, call: HillClimbToolCall, ledger: HillClimbLedgerPort): Promise<{ ok: boolean; text: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createHillClimbService(deps: HillClimbServiceDeps): HillClimbService {
  const { filePath, io } = deps;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => `hc-${randomUUID().slice(0, 8)}`);
  const dueDate = deps.dueDate ?? (() => new Date(now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));

  function status(): CouncilStatus {
    return councilStatus(deps.council(), deps.fakeCouncil === true);
  }

  function readDoc(): { doc: HillClimbDoc; readOnly: boolean; warning: string | null } {
    const text = io.readFileText(filePath);
    if (text === null) {
      if (io.existsSync(filePath)) return { doc: emptyHillClimbDoc(), readOnly: true, warning: 'O arquivo das missões existe mas não pôde ser lido; nada será gravado por cima.' };
      return { doc: emptyHillClimbDoc(), readOnly: false, warning: null };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      return { doc: emptyHillClimbDoc(), readOnly: true, warning: 'O arquivo das missões não é JSON válido; nada será gravado por cima.' };
    }
    if (!isRecord(raw) || !isRecord(raw.missions))
      return { doc: emptyHillClimbDoc(), readOnly: true, warning: 'O arquivo das missões não tem o formato esperado; nada será gravado por cima.' };
    const doc = parseHillClimbDoc(raw);
    if (isNewerHillClimbDoc(raw)) return { doc, readOnly: true, warning: 'As missões foram gravadas por uma versão mais nova do Donel Dev; esta só lê.' };
    // A mission this version cannot read would vanish on the next write: read-only instead.
    if (Object.keys(doc.missions).length !== Object.keys(raw.missions).length)
      return { doc, readOnly: true, warning: 'Há missões que esta versão não sabe ler; nada será gravado por cima.' };
    return { doc, readOnly: false, warning: null };
  }

  function load(): HillClimbSnapshot {
    return { ...readDoc(), council: status() };
  }

  function write(doc: HillClimbDoc): boolean {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const dir = dirname(filePath);
      if (!io.existsSync(dir)) io.mkdirSync(dir);
      io.writeFileText(tmpPath, JSON.stringify(doc, null, 2));
      io.renameFile(tmpPath, filePath);
      return true;
    } catch {
      io.unlinkFile(tmpPath);
      return false;
    }
  }

  /** Re-read, change one mission, write. `null` from `change` = nothing to write. */
  function update(change: (doc: HillClimbDoc) => { doc: HillClimbDoc } | { error: string } | null): string | null {
    const current = readDoc();
    if (current.readOnly) return current.warning ?? 'As missões estão só para leitura.';
    const result = change(current.doc);
    if (result === null) return null;
    if ('error' in result) return result.error;
    if (!write(result.doc)) return 'Não consegui gravar as missões; nada mudou.';
    deps.onChange?.({ doc: result.doc, readOnly: false, warning: null, council: status() });
    return null;
  }

  function tell(mission: HillClimbMission, text: string): void {
    const line = `◆ Hill climbing «${mission.title}» (missão ${mission.id}): ${text}`;
    deps.notify?.({ projectPath: mission.projectPath, placeId: mission.placeId, text: line, leaderText: `${line} [para o Escalador ${mission.placeId}, que está fechado]` });
  }

  function withMission(doc: HillClimbDoc, mission: HillClimbMission): HillClimbDoc {
    return { ...doc, missions: { ...doc.missions, [mission.id]: mission } };
  }

  return {
    load,

    syncLedger(ledger) {
      const started: HillClimbMission[] = [];
      update((doc) => {
        let next = doc;
        for (const mission of Object.values(doc.missions)) {
          if (mission.state !== 'proposta') continue;
          const card = ledger.tasks[mission.ledgerTaskId];
          if (card?.state !== 'aceita' && card?.state !== 'rejeitada') continue;
          const settled = settleProposal(mission, card.state, now());
          if (settled.state === 'rodando') started.push(settled);
          next = withMission(next, settled);
        }
        return next === doc ? null : { doc: next };
      });
      for (const mission of started)
        tell(
          mission,
          `o dono aceitou rodar. A rodada 1 tem ${HILL_CLIMB_RULES.firstRounds} rounds e começa pelo inventário do que já existe: mande a primeira versão com hillclimb_versao, com "inventario" e "direcao" (a 1ª de ${HILL_CLIMB_RULES.firstDirections} direções feitas do zero).`,
        );
    },

    gesture(missionId, gesture) {
      let changed: HillClimbMission | null = null;
      const error = update((doc) => {
        const mission = doc.missions[missionId];
        if (!mission) return { error: 'Essa missão não existe mais.' };
        const result = applyGesture(mission, gesture, now());
        if (!result.ok) return { error: result.reason };
        changed = result.mission;
        return { doc: withMission(doc, result.mission) };
      });
      if (error) return { ok: false, reason: error };
      if (changed) tell(changed, gestureMessage(changed, gesture));
      return { ok: true };
    },

    async runTool(caller, call, ledger) {
      if (call.tool === 'hillclimb_ver') {
        const { doc } = readDoc();
        if (call.missao) {
          const mission = doc.missions[call.missao];
          if (!mission || mission.projectPath !== caller.projectPath) return { ok: false, text: `Não existe missão "${call.missao}" neste quadro.` };
          return { ok: true, text: JSON.stringify(missionView(mission, true), null, 2) };
        }
        const mine = Object.values(doc.missions).filter((mission) => mission.projectPath === caller.projectPath && mission.placeId === caller.placeId);
        return { ok: true, text: JSON.stringify({ conselho: councilView(status()), missoes: mine.map((mission) => missionView(mission, false)) }, null, 2) };
      }

      if (call.tool === 'hillclimb_propor') {
        const current = readDoc();
        if (current.readOnly) return { ok: false, text: current.warning ?? 'As missões estão só para leitura.' };
        const id = newId();
        const actor: LedgerActor = { kind: 'lugar', placeId: caller.placeId };
        const created = await ledger.apply(actor, {
          op: 'criar',
          projectPath: caller.projectPath,
          title: `Hill climbing: ${call.titulo}`,
          request: call.pedido,
          doneWhen: `O dono aceita (ou recusa) rodar a missão "${call.titulo}".`,
          due: dueDate(),
          ownerPlaceId: caller.placeId,
          risk: 'alto',
        });
        if (!created.ok) return { ok: false, text: `O Oráculo recusou a carta: ${created.reason}` };
        const taskId = created.task.id;
        const taken = await ledger.apply(actor, { op: 'assumir', id: taskId });
        if (!taken.ok) return { ok: false, text: `O Oráculo recusou a carta: ${taken.reason}` };
        const delivered = await ledger.apply(actor, {
          op: 'entregar',
          id: taskId,
          proofs: [{ kind: 'texto', text: proposalText(call) }],
          forOwner: proposalCard(call.criterios.length, call.medida !== undefined),
        });
        if (!delivered.ok) return { ok: false, text: `O Oráculo recusou a carta: ${delivered.reason}` };
        const mission = proposeMission({
          id,
          projectPath: caller.projectPath,
          placeId: caller.placeId,
          title: call.titulo,
          target: call.alvo,
          reader: call.leitor,
          criteria: call.criterios,
          ...(call.medida ? { measure: call.medida } : {}),
          estimatedCost: estimatedCost(),
          ledgerTaskId: taskId,
          now: now(),
        });
        const error = update((doc) => ({ doc: withMission(doc, mission) }));
        if (error) return { ok: false, text: `A carta ${taskId} foi para o Oráculo, mas a missão não foi gravada: ${error}` };
        return {
          ok: true,
          text: `Missão ${id} proposta. Carta ${taskId} no Oráculo, esperando o dono. Não mande versão antes do aceite (hillclimb_ver mostra o estado).`,
        };
      }

      // hillclimb_versao — one round of the loop.
      const { doc, readOnly, warning } = readDoc();
      if (readOnly) return { ok: false, text: warning ?? 'As missões estão só para leitura.' };
      const mission = doc.missions[call.missao];
      if (!mission || mission.projectPath !== caller.projectPath) return { ok: false, text: `Não existe missão "${call.missao}" neste quadro.` };
      if (mission.placeId !== caller.placeId) return { ok: false, text: 'Só o Escalador que propôs a missão manda versões dela.' };
      const refusal = cannotSubmit(mission);
      if (refusal) return { ok: false, text: refusal };
      if (mission.measure && call.medido === undefined) return { ok: false, text: `Esta missão é medida: mande "medido" (${mission.measure.label}).` };
      const submitted: SubmittedVersion = {
        version: call.versao,
        ...(call.direcao ? { direction: call.direcao } : {}),
        ...(call.inventario ? { inventory: call.inventario } : {}),
        ...(call.nota ? { note: call.nota } : {}),
        ...(call.medido !== undefined ? { measured: call.medido } : {}),
      };
      // Before the judges: a version that does not fit the loop never spends a call.
      const misfit = versionProblem(mission, submitted);
      if (misfit) return { ok: false, text: misfit };
      const judges = deps.council();
      const council = councilStatus(judges, deps.fakeCouncil === true);
      if (!council.ready || !judges) return { ok: false, text: council.ready ? 'O conselho não está pronto.' : council.reason };
      let verdicts;
      try {
        verdicts = await convene(judges, blindInput(mission, call.versao));
      } catch (error) {
        return { ok: false, text: `O conselho falhou; o round não contou: ${error instanceof Error ? error.message : String(error)}` };
      }
      let recorded: HillClimbMission | null = null;
      const error = update((latest) => {
        const fresh = latest.missions[mission.id];
        if (!fresh) return { error: 'A missão sumiu enquanto os juízes liam.' };
        const result = recordRound(fresh, submitted, verdicts, now());
        if (!result.ok) return { error: result.reason };
        recorded = result.mission;
        return { doc: withMission(latest, result.mission) };
      });
      if (error || !recorded) return { ok: false, text: error ?? 'O round não foi gravado.' };
      return { ok: true, text: roundAnswer(recorded) };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Texts

function estimatedCost(): string {
  const { firstRounds, extraRounds, maxExtraRodadas, judges } = HILL_CLIMB_RULES;
  const rounds = firstRounds + extraRounds * maxExtraRodadas;
  return `até ${rounds} rounds (${firstRounds} + ${maxExtraRodadas} × ${extraRounds}), ${judges} chamadas de juiz por round: no máximo ${rounds * judges} chamadas`;
}

function proposalText(call: Extract<HillClimbToolCall, { tool: 'hillclimb_propor' }>): string {
  const lines = [
    `Alvo: ${call.alvo}`,
    `Quem vai ler ou usar: ${call.leitor}`,
    `Critérios: ${call.criterios.join('; ')}`,
    `Corte: ${HILL_CLIMB_RULES.cut} ou mais em todos os critérios, por todos os ${HILL_CLIMB_RULES.judges} juízes. Às cegas: os juízes veem os critérios, a versão e quem vai ler; nunca o alvo.`,
    `Rodada 1: começa pelo inventário do que já existe e abre ${HILL_CLIMB_RULES.firstDirections} direções do zero; depois, cada round sobe a melhor.`,
  ];
  if (call.medida) lines.push(`Medida: ${call.medida.label}, ${call.medida.direction === 'menor' ? 'no máximo' : 'no mínimo'} ${call.medida.target}.`);
  lines.push(
    `Gasto: ${estimatedCost()}.`,
    `Fecha a rodada antes se ${HILL_CLIMB_RULES.stallRounds} rounds seguidos não subirem a menor nota ("estacionou"): aí chega uma carta de decisão para você.`,
  );
  return lines.join('\n');
}

function proposalCard(criteria: number, measured: boolean): LedgerForOwner {
  const { firstRounds, extraRounds, maxExtraRodadas, judges, cut } = HILL_CLIMB_RULES;
  return {
    question: 'Rodar esta missão de hill climbing?',
    summary: `${criteria} critério(s)${measured ? ' e uma medida' : ''}, ${judges} juízes às cegas, corte ${cut} em tudo. Primeira rodada de ${firstRounds} rounds: inventário e ${HILL_CLIMB_RULES.firstDirections} direções do zero. Até ${maxExtraRodadas} extras de ${extraRounds}, cada uma só com o seu gesto.`,
    options: [
      { label: 'Rodar', effect: 'A primeira rodada começa; ao fechar, chega uma carta de decisão e você escolhe se segue.', closes: 'aceita', recommended: true },
      { label: 'Não rodar', effect: 'A missão é encerrada sem gastar nenhuma chamada de juiz.', closes: 'rejeitada' },
    ],
    why: 'O alvo e os critérios estão nas provas; o teto de rounds limita o gasto.',
    risk: 'Cada round chama os três juízes pela chave de LLM e consome cota dela.',
  };
}

function gestureMessage(mission: HillClimbMission, gesture: OwnerGesture): string {
  if (gesture.kind === 'aceitar') return 'o dono parou e aceitou a melhor versão. A missão terminou; não mande mais versões.';
  const rodada = currentRodada(mission);
  const step = nextStep(mission);
  const climb = step.kind === 'subir' && step.direction ? `suba a melhor direção, «${step.direction}»` : 'siga de onde parou';
  const rounds = `A rodada ${(rodada?.index ?? 0) + 1} tem ${rodada?.maxRounds ?? HILL_CLIMB_RULES.extraRounds} rounds`;
  if (gesture.kind === 'mais-uma') return `o dono pediu mais uma rodada. ${rounds}: ${climb}.`;
  return `o dono redirecionou: "${gesture.text.trim()}". ${rounds}: ${climb}, por esse rumo.`;
}

function councilView(council: CouncilStatus): Record<string, unknown> {
  return council.ready ? { pronto: true, juizes: council.judges.map((judge) => judge.label), falso: council.fake } : { pronto: false, motivo: council.reason };
}

function roundView(mission: HillClimbMission, round: MissionRound): Record<string, unknown> {
  return {
    round: round.index,
    rodada: round.rodada + 1,
    direcao: round.direction,
    menorNota: lowestScore(round, mission.criteria),
    ...(round.measured !== undefined ? { medido: round.measured } : {}),
    notas: round.verdicts.map((verdict) => ({ juiz: verdict.judge, notas: verdict.scores, comentario: verdict.comment })),
  };
}

function missionView(mission: HillClimbMission, full: boolean): Record<string, unknown> {
  const rodada = currentRodada(mission);
  const base = { id: mission.id, titulo: mission.title, estado: mission.state, rodada: rodada ? rodada.index + 1 : 0, rounds: mission.rounds.length };
  if (!full) return base;
  return {
    ...base,
    alvo: mission.target,
    leitor: mission.reader,
    criterios: mission.criteria,
    ...(mission.inventory ? { inventario: mission.inventory } : {}),
    ...(mission.measure ? { medida: mission.measure } : {}),
    rodadas: mission.rodadas.map((item) => ({
      rodada: item.index + 1,
      roundsMax: item.maxRounds,
      ...(item.redirect ? { novoRumo: item.redirect } : {}),
      ...(item.closed ? { fechou: CLOSE_REASON_LABEL[item.closed.reason] } : {}),
    })),
    historico: mission.rounds.map((round) => roundView(mission, round)),
  };
}

function roundAnswer(mission: HillClimbMission): string {
  const round = mission.rounds[mission.rounds.length - 1]!;
  const rodada = mission.rodadas[round.rodada]!;
  const view: Record<string, unknown> = { ...roundView(mission, round), roundsNaRodada: `${mission.rounds.filter((r) => r.rodada === round.rodada).length}/${rodada.maxRounds}` };
  if (rodada.redirect) view.novoRumo = rodada.redirect;
  if (rodada.closed) {
    view.rodadaFechou = CLOSE_REASON_LABEL[rodada.closed.reason];
    view.proximoPasso = `PARE. O dono recebe a carta de decisão e escolhe: parar e aceitar${extraRodadasLeft(mission) > 0 ? ', mais uma rodada ou redirecionar (com uma referência)' : ''}. Consulte hillclimb_ver depois.`;
  } else {
    const step = nextStep(mission);
    view.proximoPasso =
      step.kind === 'abrir'
        ? `Abra a direção ${step.nth} de ${HILL_CLIMB_RULES.firstDirections}, do zero, com um nome novo em "direcao".`
        : `Suba a melhor direção, «${step.kind === 'subir' ? step.direction : ''}»: mande a próxima versão sem "direcao".`;
  }
  return JSON.stringify(view, null, 2);
}
