/**
 * Dataset "Plano real (com estados)" — transcrito do `<script>` do
 * mockup-v3.html (fonte de verdade de forma, ver
 * `scratchpad/decisoes-forma.md`, D-M1..D-M8). Os `x`/`y` fixos do mockup
 * foram IGNORADOS de propósito: aqui a física (`forceLayout.ts`) posiciona.
 *
 * 14 nós, 13 arestas — o plano `forma-e-leitura` no momento em que a fase
 * Design revisou o mockup (12/08/2026). Dataset DEFAULT da bancada.
 */

import type { BenchGraph } from '../benchGraph';

export const planoReal: BenchGraph = {
  nodes: [
    {
      id: 'disc',
      title: 'Discovery — Definição esteira dev',
      desc: 'Onze decisões do dono, sete planos propostos. Fechado em 07/08.',
      size: 'lg',
      state: 'ok',
    },
    {
      id: 'plano',
      title: 'Plano — Forma e leitura',
      desc: 'Quatro itens declarados: protótipo do mapa, textos laterais, painel de runs, issue do mapa.',
      size: 'lg',
      state: 'ok',
    },
    {
      id: 'gmesa',
      title: 'grafo-mesa.json',
      desc: 'Export da mesa interativa — 12 nós, 12 arestas. Vira o dado de toda renderização.',
      size: 'sm',
      state: 'ok',
    },
    {
      id: 't1',
      title: 'Task: protótipo do mapa de grafos',
      desc: 'Design pronto — esperando você aprovar a forma para a bancada começar. Você está aqui.',
      size: 'md',
      state: 'wait',
    },
    {
      id: 'a-mock',
      title: 'mockup-bancada-mapa-grafos.html',
      desc: 'Este arquivo — a forma do mapa, fixada por você.',
      size: 'sm',
      state: 'ok',
    },
    {
      id: 'a-diag',
      title: 'diagrama-arquitetura.md',
      desc: 'Fronteiras da bancada: lê só o esteira.grafo, não toca src/.',
      size: 'sm',
      state: 'ok',
    },
    {
      id: 'a-banc',
      title: 'bancada (2–3 motores)',
      desc: 'O protótipo em si: mesmo grafo nos motores candidatos, régua ao lado.',
      size: 'sm',
      state: 'future',
    },
    {
      id: 'a-esc',
      title: 'mapa-grafos-escolha.md',
      desc: 'A resposta do protótipo: matriz preenchida + o motor escolhido.',
      size: 'sm',
      state: 'future',
    },
    {
      id: 'gate1',
      title: 'Você ratifica a escolha',
      desc: 'Parada humana: o motor do mapa só é escolhido por você.',
      size: 'lg',
      state: 'future',
    },
    {
      id: 't2',
      title: 'Task: textos das barras laterais',
      desc: 'Independente das outras — texto direto no lugar do vocabulário de spec.',
      size: 'md',
      state: 'future',
    },
    {
      id: 't3',
      title: 'Task: painel de runs headless',
      desc: 'TRAVADO: depende do motor headless da rodada 012, que ainda não fechou.',
      size: 'md',
      state: 'block',
    },
    {
      id: 'dep',
      title: 'Motor headless (rodada 012)',
      desc: 'Dependência externa deste plano — em execução na rodada atual.',
      size: 'md',
      state: 'run',
    },
    {
      id: 't4',
      title: 'Task: issue do mapa de grafos',
      desc: 'Quem toca src/ — constrói a tela real sobre o motor ratificado.',
      size: 'md',
      state: 'future',
    },
    {
      id: 'a-pr',
      title: 'PR → staging',
      desc: 'Entrega da issue do mapa; merge é seu.',
      size: 'sm',
      state: 'future',
    },
  ],
  edges: [
    { from: 'disc', to: 'plano' },
    { from: 'plano', to: 'gmesa' },
    { from: 'plano', to: 't1' },
    { from: 'plano', to: 't2' },
    { from: 'plano', to: 't3' },
    { from: 't1', to: 'a-mock' },
    { from: 't1', to: 'a-diag' },
    { from: 't1', to: 'a-banc' },
    { from: 't1', to: 'a-esc' },
    { from: 'a-esc', to: 'gate1' },
    { from: 'gate1', to: 't4' },
    { from: 't4', to: 'a-pr' },
    { from: 'dep', to: 't3' },
  ],
};
