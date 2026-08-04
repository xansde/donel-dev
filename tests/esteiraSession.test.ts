import { describe, expect, it } from 'vitest';
import {
  esteiraPhaseCommand,
  esteiraTabName,
  preparedMessage,
  resolveSessionCwd,
} from '../src/renderer/src/Esteira/esteiraSession';

// Spec 010 / batch B1 — a decisao PURA do que o "Preparar" abre. Ela existe
// separada do componente por dois motivos, os dois com historia neste repo:
//
// 1. **O Enter e gesto humano** (invariante 2 do `openPhaseSession.ts`): o
//    comando pre-digitado nunca pode carregar `\r`/`\n`. Testar isso na funcao
//    que PRODUZ o texto vale mais do que testar na tela onde ele aparece.
// 2. **Zero palpite de repo** (D-6, evidencia 2 da spec): a fase abriu no repo
//    errado porque havia um fallback silencioso "honesto" para o projeto em
//    foco. Aqui, repo que nao esta na lista devolve recusa — nunca um segundo
//    melhor palpite.

describe('esteiraPhaseCommand — o comando que a sessao recebe escrito', () => {
  it('chama a skill da fase e aponta para o contexto que o app deixou', () => {
    expect(esteiraPhaseCommand('discovery', 'C:/inbox/run-1.json')).toBe('/esteira-discovery --input "C:/inbox/run-1.json"');
  });

  it('serve qualquer nome de fase — `run.phase` e string livre no contrato (P-4)', () => {
    expect(esteiraPhaseCommand('plano', 'C:/inbox/run-2.json')).toContain('/esteira-plano');
  });

  it('NUNCA carrega quebra de linha — o Enter e gesto humano (invariante 2/CA-3)', () => {
    const command = esteiraPhaseCommand(' discovery \n', 'C:/inbox/run\r-1.json');
    expect(command).not.toContain('\r');
    expect(command).not.toContain('\n');
  });
});

describe('resolveSessionCwd — o alvo e explicito, sem segundo melhor palpite (D-6)', () => {
  const projects = [
    { name: 'atlas', path: 'C:/dev/atlas' },
    { name: 'beacon', path: 'C:/dev/beacon' },
  ];

  it('acha o repo declarado pelo nome', () => {
    expect(resolveSessionCwd('beacon', projects)).toEqual({ ok: true, cwd: 'C:/dev/beacon' });
  });

  it('aceita o caminho inteiro, quando e ele que o card declara', () => {
    expect(resolveSessionCwd('C:/dev/atlas', projects)).toEqual({ ok: true, cwd: 'C:/dev/atlas' });
  });

  it('repo que o app nao conhece NAO cai em outro — nem quando so ha um projeto', () => {
    expect(resolveSessionCwd('vega', [{ name: 'atlas', path: 'C:/dev/atlas' }])).toEqual({ ok: false, reason: 'unknown-repo' });
  });

  it('card sem repo alvo diz isso, em vez de escolher um', () => {
    expect(resolveSessionCwd(null, projects)).toEqual({ ok: false, reason: 'no-target-repo' });
    expect(resolveSessionCwd('   ', projects)).toEqual({ ok: false, reason: 'no-target-repo' });
  });
});

describe('preparedMessage — a frase depois do "Preparar"', () => {
  const base = { phase: 'discovery', targetRepo: 'atlas', inputPath: 'C:/inbox/run-1.json' };

  it('sessao aberta: diz onde ela abriu e que o Enter continua sendo seu', () => {
    const message = preparedMessage({ ...base, outcome: { opened: true, tabName: '[atlas] discovery' } });
    expect(message).toContain('[atlas] discovery');
    expect(message.toLowerCase()).toContain('enter');
  });

  it('repo desconhecido: nomeia o repo e diz que o app nao abre noutro lugar por palpite', () => {
    const message = preparedMessage({ ...base, targetRepo: 'vega', outcome: { opened: false, reason: 'unknown-repo' } });
    expect(message).toContain('vega');
    expect(message).toContain('palpite');
    // O trabalho preparado nao se perde: o caminho do contexto continua na frase.
    expect(message).toContain('C:/inbox/run-1.json');
  });

  it('card sem repo alvo: a fase fica preparada e a tela diz por que a sessao nao abriu', () => {
    const message = preparedMessage({ ...base, targetRepo: null, outcome: { opened: false, reason: 'no-target-repo' } });
    expect(message).toContain('sem repo alvo');
    expect(message).toContain('C:/inbox/run-1.json');
  });
});

describe('esteiraTabName — a aba diz de quem ela e', () => {
  it('leva a fase e o card no nome', () => {
    expect(esteiraTabName('discovery', 'Fila de importação trava sem sinal')).toContain('discovery');
    expect(esteiraTabName('discovery', 'Fila de importação trava sem sinal')).toContain('Fila de importação');
  });

  it('titulo longo nao vira um nome de aba ilegivel', () => {
    expect(esteiraTabName('plano', 'x'.repeat(120)).length).toBeLessThanOrEqual(60);
  });
});
