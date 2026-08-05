import { describe, expect, it } from 'vitest';
import {
  dispatchHint,
  dispatchRefusedMessage,
  esteiraPhaseCommand,
  esteiraTabName,
  lastSessionOfChain,
  lockStateOf,
  preparedMessage,
  resolveResume,
  resolveSessionCwd,
} from '../src/renderer/src/Esteira/esteiraSession';
import type { SessionSnapshot } from '../src/shared/esteira/store/storeFormat';

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

describe('lockStateOf — um estado de trava, três fatos distintos', () => {
  it('trava da skill = trabalho acontecendo', () => {
    expect(lockStateOf('skill', false)).toBe('running');
    expect(lockStateOf('skill', true)).toBe('running');
  });

  it('trava do app com sessão assumida = a aba abriu, e só isso', () => {
    expect(lockStateOf('app', true)).toBe('session-open');
  });

  it('trava do app sem sessão assumida = preparada', () => {
    expect(lockStateOf('app', false)).toBe('prepared');
  });
});

describe('dispatchHint — a razão do botão desabilitado usa a MESMA palavra do bloco', () => {
  it('sem trava, explica o que o gesto faz', () => {
    expect(dispatchHint(null)).toContain('O Enter é seu');
  });

  it('sessão aberta: nunca chama de "preparada" o que o bloco chama de sessão aberta', () => {
    // Era este o desencontro do print 06: o bloco dizia "Em andamento" e a
    // razão logo abaixo dizia "Há uma fase preparada". Duas palavras, um
    // estado — o erro conhecido nº 1 desta skill, esperando a terceira volta.
    const hint = dispatchHint('session-open');
    expect(hint).toContain('sessão aberta');
    expect(hint).not.toContain('preparada');
    expect(hint).toContain('Libere a trava');
  });

  it('em andamento e preparada têm cada uma a sua', () => {
    expect(dispatchHint('running')).toContain('em andamento');
    expect(dispatchHint('prepared')).toContain('preparada');
  });
});

describe('dispatchRefusedMessage — a recusa não inventa um estado que o card não tem', () => {
  it('recusa por sessão aberta não diz "em andamento"', () => {
    const message = dispatchRefusedMessage('session-open', 'discovery', '03/08, 12:00');
    expect(message).toContain('sessão aberta');
    expect(message).toContain('discovery');
    expect(message).toContain('03/08, 12:00');
    expect(message).not.toContain('em andamento');
  });

  it('recusa por fase preparada diz preparada', () => {
    expect(dispatchRefusedMessage('prepared', 'discovery', '03/08, 12:00')).toContain('preparada');
  });

  it('recusa por skill rodando diz em andamento', () => {
    expect(dispatchRefusedMessage('running', 'plano', '03/08, 12:00')).toContain('em andamento');
  });
});

// B1 (batch N5) — "retomar fase concluída por clique": continua a ÚLTIMA
// sessão da cadeia, `claude -r <cliSessionId>` no `cwd` DA SESSÃO — sem
// dispatch novo, sem mudar estado do card. `continuesSessionId` aponta para
// TRÁS (a sessão que esta continua, por orçamento de contexto); a última da
// cadeia é a que ninguém mais continua.
function sessao(overrides: Partial<SessionSnapshot> & { readonly id: string }): SessionSnapshot {
  return {
    cliSessionId: null,
    subject: { entity: 'work_item', id: 'wki-1' },
    phase: 'implementar',
    continuesSessionId: null,
    handoffReason: null,
    cwd: null,
    model: null,
    effort: null,
    startedAt: '2026-08-04T09:00:00.000Z',
    endedAt: '2026-08-04T09:30:00.000Z',
    inputPath: null,
    resultPath: null,
    claimed: true,
    ...overrides,
  };
}

describe('lastSessionOfChain — a sessão que "Retomar" reabre', () => {
  it('sem sessão nenhuma, não há o que retomar', () => {
    expect(lastSessionOfChain([])).toBeNull();
  });

  it('uma sessão só: ela é a última (cadeia de um elo)', () => {
    const unica = sessao({ id: 'ses-1' });
    expect(lastSessionOfChain([unica])).toBe(unica);
  });

  it('cadeia de handoff: a última é a que NINGUÉM continua — não a primeira', () => {
    const primeira = sessao({ id: 'ses-1', continuesSessionId: null });
    const segunda = sessao({ id: 'ses-2', continuesSessionId: 'ses-1' });
    const terceira = sessao({ id: 'ses-3', continuesSessionId: 'ses-2' });
    // Ordem de chegada embaralhada de propósito: a função encontra a cauda
    // pelo grafo, não pela posição no array.
    expect(lastSessionOfChain([segunda, terceira, primeira])).toBe(terceira);
  });
});

describe('resolveResume — o que falta para "Retomar" funcionar', () => {
  it('sessão sem cliSessionId (a skill nunca assumiu): recusa nomeando o motivo', () => {
    expect(resolveResume([sessao({ id: 'ses-1', cliSessionId: null, cwd: 'C:/dev/atlas' })])).toEqual({
      ok: false,
      reason: 'no-cli-session-id',
    });
  });

  it('sessão sem cwd registrado: recusa — sem cwd não há onde abrir', () => {
    expect(resolveResume([sessao({ id: 'ses-1', cliSessionId: 'cli-abc', cwd: null })])).toEqual({
      ok: false,
      reason: 'no-cwd',
    });
  });

  it('sem sessão nenhuma no histórico do assunto+fase: recusa', () => {
    expect(resolveResume([])).toEqual({ ok: false, reason: 'no-session' });
  });

  it('sessão completa (cliSessionId + cwd): resolve com os dois, prontos para `-r`', () => {
    expect(resolveResume([sessao({ id: 'ses-1', cliSessionId: 'cli-abc', cwd: 'C:/dev/atlas' })])).toEqual({
      ok: true,
      cliSessionId: 'cli-abc',
      cwd: 'C:/dev/atlas',
    });
  });

  it('cadeia de handoff: resolve com a ÚLTIMA sessão, não a primeira', () => {
    const primeira = sessao({ id: 'ses-1', cliSessionId: 'cli-primeira', cwd: 'C:/dev/atlas' });
    const segunda = sessao({ id: 'ses-2', continuesSessionId: 'ses-1', cliSessionId: 'cli-segunda', cwd: 'C:/dev/atlas' });
    expect(resolveResume([primeira, segunda])).toEqual({ ok: true, cliSessionId: 'cli-segunda', cwd: 'C:/dev/atlas' });
  });
});
