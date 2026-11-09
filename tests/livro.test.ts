import { describe, expect, it } from 'vitest';
import { applyLedgerOp, emptyLedgerDoc, type LedgerActor, type LedgerDoc, type LedgerOp } from '../src/shared/ledger/contract';
import { appendEntry, canonicalJson, entryHash, LIVRO_VERSION, readJournal, serializeJournal, type EntryInput, type JournalLine } from '../src/shared/livro/formato';
import { compareLedgers, importV4Journal } from '../src/shared/livro/importar-v4';
import { projectJournal } from '../src/shared/livro/projecao';

// O livro (plano ledger-bom, F1 + F2): o diário de lançamentos é o dado persistido; o estado é só derivado dele.
// Guarda o que quebraria sem o dono perceber: perder um lançamento na ida e volta, adulteração invisível, o mesmo
// pedido gravado duas vezes, e a projeção divergir das regras de hoje (applyLedgerOp).

const lider: LedgerActor = { kind: 'lugar', placeId: 'place:lider', roleId: 'lider' };
const dev: LedgerActor = { kind: 'lugar', placeId: 'place:dev', roleId: 'dev' };
const revisor: LedgerActor = { kind: 'lugar', placeId: 'place:revisor', roleId: 'revisor' };
const T0 = Date.UTC(2026, 10, 8, 12);

const criar = { projectPath: '/p', request: 'Faça o livro', doneWhen: 'Testes verdes', due: '2026-11-10', ownerPlaceId: 'place:dev', risk: 'baixo' as const };
const flow: EntryInput[] = [
  { id: 'l-1', em: T0, quem: lider, tipo: 'criar', tarefa: 't-1', dados: criar, chave: 'k-criar' },
  { id: 'l-2', em: T0 + 1, quem: dev, tipo: 'assumir', tarefa: 't-1', dados: {}, chave: 'k-assumir' },
  { id: 'l-3', em: T0 + 2, quem: dev, tipo: 'entregar', tarefa: 't-1', dados: { proofs: [{ kind: 'texto', text: 'npm test: 1 passed' }], note: 'pronto' }, chave: 'k-entregar' },
  { id: 'l-4', em: T0 + 3, quem: revisor, tipo: 'aceitar', tarefa: 't-1', dados: {}, chave: 'k-aceitar' },
];

function journal(inputs: readonly EntryInput[]): JournalLine[] {
  return inputs.reduce<JournalLine[]>((lines, input) => {
    const result = appendEntry(lines, input);
    if (!result.ok) throw new Error(result.reason);
    return result.lines;
  }, []);
}

/** The same steps through today's code, the way the main calls it. */
function today(steps: readonly [LedgerActor, LedgerOp, number][]): LedgerDoc {
  return steps.reduce((doc, [actor, op, now]) => {
    const result = applyLedgerOp(doc, actor, op, { now, newId: () => 't-1' });
    if (!result.ok) throw new Error(result.reason);
    return result.doc;
  }, emptyLedgerDoc());
}

/** A line as a newer app would write it: a field this version does not know, chained and hashed right. */
function newerLine(previous: JournalLine): string {
  const raw = { versao: LIVRO_VERSION + 1, seq: previous.seq + 1, id: 'l-novo', em: T0 + 9, quem: lider, tipo: 'priorizada', tarefa: 't-1', dados: { posicao: 1 }, chave: 'k-novo', campoNovo: true, anterior: previous.hash };
  return canonicalJson({ ...raw, hash: entryHash(raw) });
}

describe('livro — formato do lançamento (F1)', () => {
  it('salvar e ler de volta não perde nada, nem o lançamento de uma versão mais nova', () => {
    const lines = journal(flow);
    const text = `${serializeJournal(lines)}${newerLine(lines.at(-1)!)}\n`;
    const read = readJournal(text);
    expect(read.problems).toEqual([]);
    expect(read.readOnly).toBe(true);
    expect(read.lines.slice(0, 4)).toEqual(lines);
    expect(read.lines[4]).toMatchObject({ kind: 'newer', seq: 5, versao: LIVRO_VERSION + 1 });
    expect(serializeJournal(read.lines)).toBe(text);
    // Read-only: this app never appends after a line it does not understand.
    const append = appendEntry(read.lines, { ...flow[1]!, id: 'l-9', chave: 'k-9' });
    expect(append.ok).toBe(false);
  });

  it('trocar qualquer byte de um lançamento do meio faz a conferência apontar exatamente aquele lançamento', () => {
    const text = serializeJournal(journal(flow));
    const rows = text.split('\n');
    const target = rows[2]!; // seq 3
    for (let i = 0; i < target.length; i += 1) {
      const swapped = target[i] === 'x' ? 'y' : 'x';
      const tampered = [...rows.slice(0, 2), target.slice(0, i) + swapped + target.slice(i + 1), ...rows.slice(3)].join('\n');
      const seqs = readJournal(tampered).problems.map((problem) => problem.seq);
      expect(seqs, `byte ${i}`).toEqual([3]);
    }
  });

  it('um campo desconhecido na versão atual é recusado', () => {
    const lines = journal(flow.slice(0, 1));
    const raw = { ...JSON.parse(serializeJournal(lines)), extra: 1 };
    delete raw.hash;
    const read = readJournal(`${canonicalJson({ ...raw, hash: entryHash(raw) })}\n`);
    expect(read.problems).toMatchObject([{ seq: 1 }]);
    expect(read.problems[0]!.reason).toContain('extra');
  });

  it('a mesma chave com outro conteúdo é recusada; com o mesmo conteúdo não grava de novo', () => {
    const lines = journal(flow);
    const retry = appendEntry(lines, { ...flow[1]!, id: 'l-retry', em: T0 + 50 });
    expect(retry).toMatchObject({ ok: true, repeated: true });
    if (retry.ok) expect(retry.lines).toHaveLength(4);
    const other = appendEntry(lines, { ...flow[1]!, id: 'l-outro', dados: { outro: true } });
    expect(other.ok).toBe(false);
    // A writer that skips appendEntry is caught by the check.
    const forged = { versao: LIVRO_VERSION, seq: 5, id: 'l-5', em: T0 + 5, quem: dev, tipo: 'assumir', tarefa: 't-2', dados: {}, chave: 'k-assumir', anterior: lines[3]!.hash };
    const read = readJournal(`${serializeJournal(lines)}${canonicalJson({ ...forged, hash: entryHash(forged) })}\n`);
    expect(read.problems.map((problem) => problem.seq)).toEqual([5]);
  });
});

describe('livro — projeção (F2)', () => {
  it('criar, assumir, entregar e aceitar projeta a mesma tarefa que o applyLedgerOp de hoje', () => {
    const projection = projectJournal(journal(flow));
    expect(projection.steps.map((step) => step.status)).toEqual(['aplicado', 'aplicado', 'aplicado', 'aplicado']);
    expect(projection.doc).toEqual(
      today([
        [lider, { op: 'criar', ...criar }, T0],
        [dev, { op: 'assumir', id: 't-1' }, T0 + 1],
        [dev, { op: 'entregar', id: 't-1', proofs: [{ kind: 'texto', text: 'npm test: 1 passed' }], note: 'pronto' }, T0 + 2],
        [revisor, { op: 'aceitar', id: 't-1' }, T0 + 3],
      ]),
    );
    expect(projection.doc.tasks['t-1']!.state).toBe('aceita');
  });

  it('um lançamento recusado pelas regras fica no diário como recusado e não muda o estado', () => {
    const inputs: EntryInput[] = [
      ...flow.slice(0, 3),
      // Whoever delivered never accepts the own delivery.
      { id: 'l-x', em: T0 + 3, quem: dev, tipo: 'aceitar', tarefa: 't-1', dados: {}, chave: 'k-auto-aceite' },
      // Broken data never throws the projection away.
      { id: 'l-y', em: T0 + 4, quem: dev, tipo: 'entregar', tarefa: 't-1', dados: { proofs: 'nada' }, chave: 'k-quebrado' },
      // A second birth of the same task would overwrite it.
      { id: 'l-z', em: T0 + 5, quem: lider, tipo: 'criar', tarefa: 't-1', dados: criar, chave: 'k-criar-de-novo' },
    ];
    const lines = journal(inputs);
    const projection = projectJournal(readJournal(serializeJournal(lines)).lines);
    expect(projection.steps.map((step) => step.status)).toEqual(['aplicado', 'aplicado', 'aplicado', 'recusado', 'recusado', 'recusado']);
    expect(projection.steps[3]!.reason).toContain('quem entregou');
    expect(projection.doc).toEqual(projectJournal(lines.slice(0, 3)).doc);
    expect(projection.doc.tasks['t-1']!.state).toBe('entregue');
  });
});

describe('livro — importação do ledger v4, só leitura (F3)', () => {
  /** A v4 ledger as today's code writes it, with the odd paths: marks, transfer with risk change, rework, letters, bot. */
  function v4Ledger(): LedgerDoc {
    let n = 0;
    let clock = T0;
    let doc = emptyLedgerDoc();
    const dono: LedgerActor = { kind: 'dono' };
    const run = (actor: LedgerActor, op: LedgerOp): string => {
      const result = applyLedgerOp(doc, actor, op, { now: (clock += 1000), newId: () => `t-${(n += 1)}` });
      if (!result.ok) throw new Error(result.reason);
      doc = result.doc;
      return result.task.id;
    };
    const a = run(lider, { op: 'criar', ...criar, title: 'Livro', requestedBy: 'dono', frente: 'Ledger' });
    run(lider, { op: 'transferir', id: a, to: 'place:dev2', reason: 'o outro Dev fecha', risk: 'alto' });
    const dev2: LedgerActor = { kind: 'lugar', placeId: 'place:dev2', roleId: 'dev' };
    run(dev2, { op: 'assumir', id: a });
    run(dev2, { op: 'entregar', id: a, proofs: [{ kind: 'texto', text: 'ok' }], forOwner: { question: 'Aceita o livro?', summary: 'O livro está pronto.', options: [{ label: 'Aceitar', effect: 'Fecha.', closes: 'aceita', recommended: true }, { label: 'Refazer', effect: 'Volta.', closes: 'rejeitada' }], why: 'Testes verdes.', risk: 'Nenhum.' } });
    run(dono, { op: 'rejeitar', id: a, reason: '', option: 'Refazer' });
    run(dev2, { op: 'assumir', id: a });
    run(dev2, { op: 'andamento', id: a, progress: { estado: 'trabalhando', proximo: 'ajustar' } });
    const b = run(lider, { op: 'criar', ...criar, request: 'Outro pedido' });
    run(lider, { op: 'frente', id: b, frente: 'Ledger', requestedBy: 'dono' });
    run(lider, { op: 'criar', ...criar, request: 'Substituto', replaces: b });
    const letter = run(dev, { op: 'carta-slack', projectPath: '/p', slack: { destination: 'C01', text: 'Oi', reason: 'avisar' } });
    run(dono, { op: 'aceitar', id: letter, option: 'Enviar' });
    run(dev, { op: 'slack-enviada', id: letter });
    run(dev, { op: 'slack-resultado', id: letter, outcome: 'confirmado' });
    run(dev, { op: 'slack-bot', projectPath: '/p', bot: { server: 'bot', tool: 'post', destination: 'C02', text: 'feito', outcome: 'confirmado' } });
    const c = run(lider, { op: 'criar', ...criar, request: 'Para o Revisor' });
    run(dev, { op: 'assumir', id: c });
    run(dev, { op: 'entregar', id: c, proofs: [{ kind: 'link', url: 'https://ci.example/1' }] });
    run(revisor, { op: 'aceitar', id: c });
    run(dono, { op: 'comentar', id: c, text: 'Visto.', deliveredTo: null });
    run(dono, { op: 'aceitar', id: c });
    return doc;
  }

  it('cada evento vira um lançamento e a projeção devolve as mesmas tarefas, uma a uma', () => {
    const original = v4Ledger();
    const lines = importV4Journal(original);
    expect(lines).toHaveLength(Object.values(original.tasks).reduce((sum, task) => sum + task.events.length, 0));
    const read = readJournal(serializeJournal(lines));
    expect(read.problems).toEqual([]);
    const projection = projectJournal(read.lines);
    expect(projection.steps.every((step) => step.status === 'aplicado')).toBe(true);
    expect(compareLedgers(original, projection.doc)).toEqual([]);
    expect(projection.doc).toEqual(original);
    // Importing again is the same journal: the keys are the events.
    expect(serializeJournal(importV4Journal(original))).toBe(serializeJournal(lines));
  });

  it('a diferença aparece tarefa a tarefa, e evento importado depois de uma operação é recusado', () => {
    const original = v4Ledger();
    const changed = { ...original, tasks: { ...original.tasks, 't-1': { ...original.tasks['t-1']!, state: 'aceita' as const } } };
    expect(compareLedgers(changed, projectJournal(importV4Journal(original)).doc).map((difference) => difference.task)).toEqual(['t-1']);
    const lines = importV4Journal(original);
    const opened = appendEntry(lines, { id: 'l-op', em: T0 + 99_000, quem: lider, tipo: 'criar', tarefa: 't-99', dados: criar, chave: 'k-op' });
    if (!opened.ok) throw new Error(opened.reason);
    const late = appendEntry(opened.lines, { ...stripLine(lines[0]!), id: 'l-tarde', chave: 'k-tarde', tarefa: 't-tarde' });
    if (!late.ok) throw new Error(late.reason);
    expect(projectJournal(late.lines).steps.at(-1)).toMatchObject({ status: 'recusado' });
  });
});

function stripLine(line: JournalLine): EntryInput {
  if (line.kind !== 'entry') throw new Error('linha de versão maior');
  return { id: line.id, em: line.em, quem: line.quem, tipo: line.tipo, tarefa: line.tarefa, dados: line.dados, chave: line.chave };
}
