import { describe, expect, it } from 'vitest';
import { createPrimeSequencer } from '../src/renderer/src/DevMode/primeSequencer';

// Invariante 2 (CA-3), o que sobrou do `openPhaseSession.ts` depois do batch
// B6: cada comando sai com o SEU próprio Enter — nunca dois concatenados, e
// nunca um quebra de linha partindo daqui. O resto do módulo decidia o gesto do mapa
// antigo e saiu com ele.

describe('createPrimeSequencer (CA-16 — cada comando com seu próprio Enter)', () => {
  it('libera um comando por vez: o segundo só sai na chamada seguinte', () => {
    const sequencer = createPrimeSequencer(['/esteira-liberar CARD-1', '/esteira-implementar CARD-1 ultracode']);

    expect(sequencer.done).toBe(false);
    expect(sequencer.next()).toBe('/esteira-liberar CARD-1');
    expect(sequencer.done).toBe(false);
    expect(sequencer.next()).toBe('/esteira-implementar CARD-1 ultracode');
    expect(sequencer.done).toBe(true);
    expect(sequencer.next()).toBeNull();
  });

  it('sequência vazia nasce concluída (nada a pré-digitar)', () => {
    const sequencer = createPrimeSequencer([]);
    expect(sequencer.done).toBe(true);
    expect(sequencer.next()).toBeNull();
  });

  it('nunca concatena os dois comandos num só texto', () => {
    const sequencer = createPrimeSequencer(['a', 'b']);
    const first = sequencer.next();
    expect(first).toBe('a');
    expect(first).not.toContain('b');
  });
});

// ---------------------------------------------------------------------------
// T328 (003-modo-dev, Batch D) — prompt da sessão de CONCILIAÇÃO (CA-13).
//
// Duas regras que o mockup violava e a spec manda (mockup × spec: vence a
// spec): (a) não existe skill `/esteira-conciliar` — inventar uma seria o
// mesmo erro do `--subset` já barrado no D2, e a invariante 3 proíbe criar
// código novo na Esteira; então o prompt é TEXTO, descrevendo os dois fatos.
// (b) o app nunca corrige o board — o prompt diz isso explicitamente.
// ---------------------------------------------------------------------------
