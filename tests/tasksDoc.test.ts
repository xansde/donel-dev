import { describe, expect, it } from 'vitest';
import { parseTasksDoc, taskScope } from '../src/shared/tasksDoc';

// C3 (batch N5, spec 010) — "o card do item mostra O QUE RODA JUNTO": escopo
// compacto (ex.: "27 tasks · T1102-T1131") + subitens expandidos com o
// título humano de cada task. O parser aqui lê o MESMO formato que
// `specs/*/tasks.md` deste repo já usa na prática (achado da investigação:
// `- [x] **T1301** — Confirmar...`, `- [x] **T1303** [P] Teste: ...`) — não é
// um formato inventado.

describe('parseTasksDoc — o checklist real de um tasks.md', () => {
  it('lê id, estado (feito/aberto) e título de cada linha', () => {
    const markdown = `
- [x] **T1301** — Confirmar (a) que os batches da 010 fecharam em staging.
- [ ] **T1302** — Spike de compatibilidade do piloto.
`;
    expect(parseTasksDoc(markdown)).toEqual([
      { id: 'T1301', done: true, title: 'Confirmar (a) que os batches da 010 fecharam em staging.' },
      { id: 'T1302', done: false, title: 'Spike de compatibilidade do piloto.' },
    ]);
  });

  it('aceita `[X]` maiúsculo como feito', () => {
    expect(parseTasksDoc('- [X] **T1** — Uma task.')[0]!.done).toBe(true);
  });

  it('o marcador `[P]` (pode rodar em paralelo) não vira parte do título', () => {
    const markdown = '- [x] **T1303** [P] Teste: `tests/providersConfig.test.ts` — cobre as seis invariantes.';
    const [task] = parseTasksDoc(markdown);
    expect(task!.title).not.toContain('[P]');
    expect(task!.title).toContain('tests/providersConfig.test.ts');
  });

  it('título sem travessão logo após o id: o texto inteiro depois do id é o título', () => {
    const markdown = '- [x] **T1304** Criar `src/shared/providers.ts` — ProviderId, UpsertProviderInput.';
    expect(parseTasksDoc(markdown)[0]!.title).toBe('Criar `src/shared/providers.ts` — ProviderId, UpsertProviderInput.');
  });

  it('negrito dentro do título (ex.: nome da task em destaque) não vaza `**` pro texto', () => {
    const markdown = '- [x] **T1302** — **Spike de compatibilidade do piloto** (risco R1).';
    expect(parseTasksDoc(markdown)[0]!.title).toBe('Spike de compatibilidade do piloto (risco R1).');
  });

  it('linha sem checkbox não é uma task — texto de prosa em volta não vira entrada fantasma', () => {
    const markdown = `
# Tasks — 011 Contas & Provedores

**26 tasks — \`T1301\`–\`T1326\`**, em ordem de dependência.

- [x] **T1301** — Confirmar o gate.
`;
    expect(parseTasksDoc(markdown)).toHaveLength(1);
  });

  it('documento vazio: lista vazia, nunca lança', () => {
    expect(parseTasksDoc('')).toEqual([]);
  });

  it('id sem o formato letra+número não quebra o parser — a linha é ignorada', () => {
    expect(parseTasksDoc('- [x] **sem-id-valido** — Algo.')).toEqual([]);
  });
});

describe('taskScope — o escopo compacto de "o que roda junto"', () => {
  it('sem task nenhuma: null — nada a resumir', () => {
    expect(taskScope([])).toBeNull();
  });

  it('mesmo prefixo, ids não contíguos: total + faixa min-max, no formato do exemplo', () => {
    // 26 sequenciais (T1102..T1127) + um renumerado mais adiante (T1131) —
    // 27 no total, span T1102-T1131: a faixa é MIN-MAX, não "contagem de
    // números", porque renumeração/gap é normal num tasks.md real.
    const numeros = [...Array.from({ length: 26 }, (_, index) => 1102 + index), 1131];
    const tasks = numeros.map((n, index) => ({ id: `T${n}`, done: false, title: `Task ${index}` }));
    expect(tasks).toHaveLength(27);
    const scope = taskScope(tasks)!;
    expect(scope.total).toBe(27);
    expect(scope.rangeLabel).toBe('T1102-T1131');
    expect(scope.compact).toBe('27 tasks · T1102-T1131');
  });

  it('uma task só: a faixa é só o próprio id, sem hífen', () => {
    const scope = taskScope([{ id: 'T5', done: false, title: 'Única' }])!;
    expect(scope.rangeLabel).toBe('T5');
    expect(scope.compact).toBe('1 task · T5');
  });

  it('prefixos diferentes (documento misto): não inventa faixa numérica — nomeia o primeiro id e reticências', () => {
    const tasks = [
      { id: 'T1', done: false, title: 'x' },
      { id: 'A2', done: false, title: 'y' },
    ];
    const scope = taskScope(tasks)!;
    expect(scope.total).toBe(2);
    expect(scope.rangeLabel).toBe('T1…');
  });

  it('id fora do formato letra+número: cai pro total simples, sem faixa inventada', () => {
    const scope = taskScope([{ id: 'sem-formato', done: false, title: 'x' }])!;
    expect(scope.total).toBe(1);
    expect(scope.rangeLabel).toBe('sem-formato');
    expect(scope.compact).toBe('1 task');
  });
});
