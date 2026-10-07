/**
 * Dataset "Sintético (fps)" — gerador DETERMINÍSTICO (mesma seed sempre
 * produz o mesmo grafo) de ~300 nós para estressar as 3 abas: ~8 fases,
 * ~60 tasks, o resto arquivos-satélite. Sem `Math.random()` — um LCG
 * (linear congruential generator) com seed fixa garante reprodutibilidade
 * entre rodadas da bancada.
 */

import type { BenchGraph, BenchNode, BenchState } from '../benchGraph';

const SEED = 20260812;

// LCG nos parâmetros do Numerical Recipes — determinístico, sem dependência
// externa. Devolve float em [0, 1).
function makeLcg(seed: number) {
  let state = seed >>> 0;
  return function next(): number {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const PHASE_COUNT = 8;
const TASK_COUNT = 60;
const TOTAL_NODE_COUNT = 300;

const STATES: readonly BenchState[] = ['ok', 'run', 'wait', 'block', 'future'];
// Peso aproximado de um plano em andamento: mais nós já concluídos ou
// futuros do que travados/rodando/esperando ao mesmo tempo.
const STATE_WEIGHTS: readonly number[] = [0.35, 0.08, 0.07, 0.05, 0.45];

function pickState(rand: () => number): BenchState {
  const roll = rand();
  let acc = 0;
  for (let i = 0; i < STATES.length; i += 1) {
    acc += STATE_WEIGHTS[i];
    if (roll < acc) return STATES[i];
  }
  return STATES[STATES.length - 1];
}

/**
 * Gera o dataset sintético. Chamada sem argumento usa a seed fixa do
 * módulo (o caso normal da bancada); aceita seed explícita só para teste.
 */
export function generateSynthetic(seed: number = SEED): BenchGraph {
  const rand = makeLcg(seed);

  const nodes: BenchNode[] = [];
  const edges: { from: string; to: string }[] = [];

  const phaseIds: string[] = [];
  for (let p = 0; p < PHASE_COUNT; p += 1) {
    const id = `phase-${p}`;
    phaseIds.push(id);
    nodes.push({
      id,
      title: `Fase ${p + 1}`,
      desc: `Fase sintética ${p + 1} de ${PHASE_COUNT}.`,
      size: 'lg',
      state: pickState(rand),
    });
    if (p > 0) {
      edges.push({ from: phaseIds[p - 1], to: id });
    }
  }

  const taskIds: string[] = [];
  const tasksPerPhase = Math.floor(TASK_COUNT / PHASE_COUNT);
  let taskIndex = 0;
  for (let p = 0; p < PHASE_COUNT; p += 1) {
    const countThisPhase =
      p === PHASE_COUNT - 1 ? TASK_COUNT - taskIndex : tasksPerPhase;
    for (let t = 0; t < countThisPhase; t += 1) {
      const id = `task-${taskIndex}`;
      taskIds.push(id);
      nodes.push({
        id,
        title: `Task ${taskIndex + 1}`,
        desc: `Task sintética da fase ${p + 1}.`,
        size: 'md',
        state: pickState(rand),
      });
      edges.push({ from: phaseIds[p], to: id });
      taskIndex += 1;
    }
  }

  // Cruzamentos: dependências extra entre tasks de fases diferentes
  // (sempre pra frente — fase menor para fase maior — pra não desenhar
  // ciclo de verdade, só convergência).
  const crossingCount = Math.floor(taskIds.length * 0.25);
  for (let i = 0; i < crossingCount; i += 1) {
    const fromIndex = Math.floor(rand() * (taskIds.length - 1));
    const toIndex = fromIndex + 1 + Math.floor(rand() * (taskIds.length - fromIndex - 1));
    if (toIndex > fromIndex && toIndex < taskIds.length) {
      edges.push({ from: taskIds[fromIndex], to: taskIds[toIndex] });
    }
  }

  const fileNodeCount = TOTAL_NODE_COUNT - nodes.length;
  let fileIndex = 0;
  while (fileIndex < fileNodeCount) {
    const ownerTaskIndex = Math.floor(rand() * taskIds.length);
    const id = `file-${fileIndex}`;
    nodes.push({
      id,
      title: `arquivo-${fileIndex}.md`,
      desc: null,
      size: 'sm',
      state: pickState(rand),
    });
    edges.push({ from: taskIds[ownerTaskIndex], to: id });
    fileIndex += 1;
  }

  return { nodes, edges };
}

export const syntheticGraph: BenchGraph = generateSynthetic();
