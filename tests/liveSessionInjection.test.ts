// T011 — Injeção de modelo/esforço em sessão viva (FR-011), TDD.
//
// `canInjectLiveCommand`/`buildModelInjection`/`buildEffortInjection` são
// puras (sem I/O) — quem de fato escreve no stdin do PTY é
// TerminalPane.injectCommand (via window.donel.pty.input), chamado pelo
// App.tsx só quando esta função devolver `true`. Ver comentário de topo de
// src/shared/liveSessionInjection.ts pra evidência de que `/model` e
// `/effort` existem os dois como slash commands reais na versão instalada
// do CLI (2.1.218) — a "degradação" do FR-011 só entra por falta de
// PROCESSO VIVO, não por falta de comando nativo.
import { describe, expect, it } from 'vitest';
import {
  buildEffortInjection,
  buildModelInjection,
  canInjectLiveCommand,
} from '../src/shared/liveSessionInjection';

describe('canInjectLiveCommand', () => {
  it('permite quando o semáforo está "waiting" (prompt ocioso) e o processo está vivo', () => {
    expect(canInjectLiveCommand('waiting', true)).toBe(true);
  });

  (['working', 'permission', 'error', 'done'] as const).forEach((state) => {
    it(`bloqueia quando o semáforo está "${state}" mesmo com o processo vivo`, () => {
      expect(canInjectLiveCommand(state, true)).toBe(false);
    });
  });

  it('bloqueia quando o estado é undefined (aba recém-criada, ainda sem primeiro evento de hook)', () => {
    expect(canInjectLiveCommand(undefined, true)).toBe(false);
  });

  it('bloqueia "waiting" sem processo vivo (sessão encerrada entre o último hook e o clique — corrida rara, defesa em profundidade)', () => {
    expect(canInjectLiveCommand('waiting', false)).toBe(false);
  });
});

describe('buildModelInjection', () => {
  (['fable', 'opus', 'sonnet', 'haiku'] as const).forEach((alias) => {
    it(`monta "/model ${alias}\\r" pro alias ${alias}`, () => {
      expect(buildModelInjection(alias)).toBe(`/model ${alias}\r`);
    });
  });
});

describe('buildEffortInjection', () => {
  (['low', 'medium', 'high', 'xhigh', 'max'] as const).forEach((level) => {
    it(`monta "/effort ${level}\\r" pro nível ${level}`, () => {
      expect(buildEffortInjection(level)).toBe(`/effort ${level}\r`);
    });
  });
});
