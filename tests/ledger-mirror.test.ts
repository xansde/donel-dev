import { describe, expect, it } from 'vitest';
import { createLedgerMirror, type MirrorSink, type MirrorTimers } from '../src/main/ledger-mirror/mirror';
import { createSupabaseSink } from '../src/main/ledger-mirror/supabase-sink';
import { maskSecrets, tarefaRows, withPlaceMemory, type PlaceInfo, type PlaceInfoOf, type TarefaRow } from '../src/shared/ledger/mirror';
import { LEADER_OF_ALL } from '../src/shared/mindscape/leader';
import { LEDGER_SCHEMA_VERSION, type LedgerDoc, type LedgerTask } from '../src/shared/ledger/contract';

// Espelho do Oráculo — the tasks leave the PC: a burst goes as one registry, no network never loses a change nor
// blocks, nothing secret leaves, and each row says what the owner reads in the table.

const T0 = Date.UTC(2026, 10, 6, 12);

function task(id: string, over: Partial<LedgerTask> = {}): LedgerTask {
  return {
    id,
    projectPath: 'C:\\Users\\x\\seazone\\Donel Dev',
    title: `Tarefa ${id}`,
    request: 'Põe o botão verde',
    doneWhen: 'print',
    due: '2026-11-07',
    ownerPlaceId: 'place:dev',
    risk: 'baixo',
    state: 'aberta',
    createdAt: T0,
    events: [{ kind: 'criada', at: T0, by: { kind: 'dono' } }],
    ...over,
  };
}

const doc = (...tasks: LedgerTask[]): LedgerDoc => ({ schemaVersion: LEDGER_SCHEMA_VERSION, startedAt: T0, tasks: Object.fromEntries(tasks.map((t) => [t.id, t])) });

/** Timers the test runs by hand. */
function fakeTimers(): MirrorTimers & { fire(): Promise<void>; pending(): number[] } {
  const queue: Array<{ fn: () => void; ms: number }> = [];
  return {
    set: (fn, ms) => {
      const entry = { fn, ms };
      queue.push(entry);
      return entry;
    },
    clear: (handle) => {
      const i = queue.indexOf(handle as { fn: () => void; ms: number });
      if (i >= 0) queue.splice(i, 1);
    },
    async fire() {
      const entry = queue.shift();
      entry?.fn();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    },
    pending: () => queue.map((entry) => entry.ms),
  };
}

function recordingSink(fail: () => boolean = () => false): MirrorSink & { pushes: TarefaRow[][] } {
  const pushes: TarefaRow[][] = [];
  return {
    pushes,
    async push(rows) {
      if (fail()) throw new Error('sem rede (TypeError)');
      pushes.push([...rows]);
    },
  };
}

describe('espelho do Oráculo', () => {
  it('joins a burst of changes into one push, after the wait', async () => {
    const timers = fakeTimers();
    const sink = recordingSink();
    const mirror = createLedgerMirror({ sink: () => sink, timers, delayMs: 45_000 });
    mirror.changed(doc(task('t-1')));
    mirror.changed(doc(task('t-1', { state: 'em-execucao' })));
    mirror.changed(doc(task('t-1', { state: 'em-execucao' }), task('t-2')));
    expect(timers.pending()).toEqual([45_000]);
    expect(sink.pushes).toHaveLength(0);
    await timers.fire();
    expect(sink.pushes).toHaveLength(1);
    expect(sink.pushes[0]!.map((row) => [row.id, row.estado])).toEqual([
      ['t-1', 'em execução'],
      ['t-2', 'aberta'],
    ]);
    expect(mirror.status().pending).toBe(false);
  });

  it('without network keeps the newest document, retries later and never throws into the app', async () => {
    const timers = fakeTimers();
    let offline = true;
    const sink = recordingSink(() => offline);
    const lines: string[] = [];
    const mirror = createLedgerMirror({ sink: () => sink, timers, delayMs: 45_000, retryMs: 60_000, log: (line) => lines.push(line) });
    mirror.changed(doc(task('t-1')));
    await timers.fire();
    expect(mirror.status()).toMatchObject({ pending: true, lastError: 'sem rede (TypeError)' });
    expect(timers.pending()).toEqual([60_000]);
    // A change while offline rides the retry already set.
    mirror.changed(doc(task('t-1'), task('t-2')));
    expect(timers.pending()).toEqual([60_000]);
    await timers.fire();
    expect(timers.pending()).toEqual([120_000]);
    offline = false;
    await timers.fire();
    expect(sink.pushes).toHaveLength(1);
    expect(sink.pushes[0]!.map((row) => row.id)).toEqual(['t-1', 't-2']);
    expect(mirror.status()).toMatchObject({ pending: false, lastError: null });
    expect(lines.some((line) => line.includes('tento de novo'))).toBe(true);
  });

  it('off (no destination) keeps the change for the first push after configuring', async () => {
    const timers = fakeTimers();
    let sink: MirrorSink | null = null;
    const real = recordingSink();
    const mirror = createLedgerMirror({ sink: () => sink, timers });
    mirror.changed(doc(task('t-1')));
    await timers.fire();
    expect(mirror.status().pending).toBe(true);
    sink = real;
    await mirror.flush();
    expect(real.pushes).toHaveLength(1);
  });

  it('masks tokens, keys, passwords and e-mails, and logs where (never the value)', async () => {
    const secret = 'ghp_' + 'a'.repeat(36);
    const masked = maskSecrets(`token ${secret} senha: hunter22 mail cliente@empresa.com.br Bearer abcdefghijklmnopqrstuvwxyz`);
    expect(masked.text).not.toContain(secret);
    expect(masked.text).not.toContain('hunter22');
    expect(masked.text).not.toContain('cliente@empresa.com.br');
    expect(masked.text).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(masked.text).toContain('senha: [segredo]');
    expect(masked.hits.map((hit) => hit.kind)).toEqual(expect.arrayContaining(['token GitHub', 'senha', 'e-mail', 'Bearer']));
    expect(maskSecrets('Põe o botão verde no painel').hits).toEqual([]);
  });

  // What a text proof usually is: command output, JSON, a `.env`. Secrets built by concatenation so the repo's own
  // secret scanners do not take the fixtures for real keys.
  it.each([
    ['senha em JSON', '{"password": "hunter2222"}', 'hunter2222', '{"password": "[segredo]"}'],
    ['chave de API em JSON (camelCase)', `"apiKey": "${'ab12'.repeat(4)}"`, 'ab12ab12', '"apiKey": "[segredo]"'],
    ['chave de API em JSON (snake_case)', `{'api_key': '${'ab12'.repeat(4)}'}`, 'ab12ab12', "{'api_key': '[segredo]'}"],
    ['PGPASSWORD no ambiente', 'PGPASSWORD=s3nh4F0rte psql -h db', 's3nh4F0rte', 'PGPASSWORD=[segredo] psql'],
    ['DB_PASSWORD no .env', 'DB_HOST=db\nDB_PASSWORD=s3nh4F0rte\n', 's3nh4F0rte', 'DB_PASSWORD=[segredo]'],
    ['Stripe sk_live', `chave ${'sk_' + 'live_'}${'a1B2'.repeat(6)}`, 'a1B2a1B2a1B2', 'chave [segredo]'],
    ['Stripe sk_test', `${'sk_' + 'test_'}${'a1B2'.repeat(6)}`, 'a1B2a1B2a1B2', '[segredo]'],
    ['Stripe rk_live', `${'rk_' + 'live_'}${'a1B2'.repeat(6)}`, 'a1B2a1B2a1B2', '[segredo]'],
    ['webhook do Slack', `POST ${'https://hooks.' + 'slack.com/services/'}T0ABCDEF/B0ABCDEF/${'x1Y2'.repeat(6)} ok`, 'x1Y2x1Y2', 'POST https://hooks.slack.com/[segredo] ok'],
    ['senha em conexão com host IP', 'postgres://app:p4ss!word@10.0.0.5/db', 'p4ss!word', 'postgres://app:[segredo]@10.0.0.5/db'],
    ['senha em conexão com host nome', 'mysql://root:hunter22@db.interno.com:3306/x', 'hunter22', 'mysql://root:[segredo]@db.interno.com:3306/x'],
    ['CPF sem pontos', 'cliente 12345678900 ok', '12345678900', 'cliente [cpf] ok'],
    ['CPF com pontos', 'cliente 123.456.789-00 ok', '123.456.789-00', 'cliente [cpf] ok'],
  ])('masks %s', (_name, input, secret, expected) => {
    const masked = maskSecrets(input);
    expect(masked.text).not.toContain(secret);
    expect(masked.text).toContain(expected);
    expect(masked.hits.length).toBeGreaterThan(0);
  });

  it('keeps an ordinary link and port as they are', () => {
    expect(maskSecrets('https://github.com/xansde/donel-dev/pull/260 e http://localhost:5173/').hits).toEqual([]);
  });

  it('sends a masked proof and logs where', async () => {
    const delivered = task('t-1', {
      state: 'entregue',
      events: [
        { kind: 'criada', at: T0, by: { kind: 'dono' } },
        { kind: 'entregue', at: T0 + 1, by: { kind: 'lugar', placeId: 'place:dev', roleId: 'dev' }, proofs: [{ kind: 'texto', text: `deploy ok com sk-ant-${'x'.repeat(30)}` }] },
      ],
    });
    const timers = fakeTimers();
    const sink = recordingSink();
    const lines: string[] = [];
    const mirror = createLedgerMirror({ sink: () => sink, timers, log: (line) => lines.push(line) });
    mirror.changed(doc(delivered));
    await timers.fire();
    expect(sink.pushes[0]![0]!.prova_texto).toBe('deploy ok com [segredo]');
    expect(lines).toEqual(['mascarado: tarefa t-1, campo ultima_entrega (chave Anthropic/OpenAI)', 'mascarado: tarefa t-1, campo prova_texto (chave Anthropic/OpenAI)']);
  });

  // 07/11 — the owner opened the table and read "quem pediu: Dev". Each row has to be read without decoding code.
  const places: PlaceInfoOf = (_project, placeId) =>
    ({
      'place:lider': { roleId: 'lider', name: 'Líder · leva do dia' },
      'place:dev': { roleId: 'dev', name: 'Dev · Mindscape de cadeiras' },
      'place:rev': { roleId: 'revisor', name: 'PR 276' },
      'place:theo': { roleId: 'theo-west', name: 'Theo · VPS' },
      'place:curador': { roleId: 'curador' },
    })[placeId];
  const by = (placeId: string, roleId?: string) => ({ kind: 'lugar' as const, placeId, ...(roleId ? { roleId } : {}) });

  it('a row reads like a sentence: people and place names, Portuguese state, last delivery and who decided', () => {
    const accepted = task('t-1', {
      title: 'Cadeiras no Mindscape',
      state: 'aceita',
      request: 'Quero ver as cadeiras do Mindscape',
      events: [
        { kind: 'criada', at: T0, by: by('place:lider', 'lider') },
        { kind: 'assumida', at: T0 + 1000, by: by('place:dev', 'dev') },
        {
          kind: 'entregue',
          at: T0 + 2000,
          by: by('place:dev', 'dev'),
          text: 'PR #280 com as cadeiras',
          proofs: [
            { kind: 'arquivo', file: 'abcdefgh-print.png', mediaType: 'image/png' },
            { kind: 'link', url: 'https://github.com/x/y/pull/280' },
          ],
        },
        { kind: 'aceita', at: T0 + 3000, by: by('place:rev', 'revisor') },
      ],
    });
    const { rows } = tarefaRows(doc(accepted), places, { ownerName: 'Alexandre' });
    expect(rows[0]).toEqual({
      quadro: 'Donel Dev',
      titulo: 'Cadeiras no Mindscape',
      // No front said: null, the table reads "sem frente".
      frente: null,
      estado: 'aceita',
      // The first week's daily sample: a Revisor's accept goes to the owner too.
      esperando_dono: true,
      // Created by a Líder who did not say who asked: no guess (owner, 07/11).
      quem_pediu: 'não registrado',
      pedido: 'Quero ver as cadeiras do Mindscape',
      quem_faz_agora: 'Dev · Mindscape de cadeiras',
      quem_criou: 'Líder · leva do dia',
      risco: 'baixo',
      prazo: '2026-11-07',
      ultima_entrega: 'PR #280 com as cadeiras',
      link_da_prova: 'https://github.com/x/y/pull/280',
      decisao: 'aceita por Revisor · PR 276',
      motivo: null,
      criada_em: new Date(T0).toISOString(),
      entregue_em: new Date(T0 + 2000).toISOString(),
      decidida_em: new Date(T0 + 3000).toISOString(),
      prova_texto: '(1 arquivo de prova só no app)',
      id: 't-1',
    });
    // Nothing in a row is an id but the id itself.
    for (const [column, value] of Object.entries(rows[0]!)) if (column !== 'id') expect(String(value)).not.toMatch(/place:|session:|t-1\b/);
  });

  it('sends the front of a task, the last one the Líder marked', () => {
    const marked = task('t-3', {
      events: [
        { kind: 'criada', at: T0, by: { kind: 'dono' }, text: '⟦pedido por dono⟧ ⟦frente Ledger⟧' },
        { kind: 'criada', at: T0 + 1000, by: { kind: 'lugar', placeId: LEADER_OF_ALL, roleId: 'lider' }, text: '⟦frente Oráculo na VPS⟧' },
      ],
    });
    expect(tarefaRows(doc(marked, task('t-4'))).rows.map((row) => row.frente)).toEqual(['Oráculo na VPS', null]);
  });

  it('the owner decides by name, a cancel says so, and a waiting delivery is flagged', () => {
    const cancelled = task('t-2', {
      state: 'rejeitada',
      events: [
        { kind: 'criada', at: T0, by: { kind: 'dono' } },
        { kind: 'rejeitada', at: T0 + 1, by: { kind: 'dono' }, text: '⟦cancelada⟧ substituída pela t-9' },
      ],
    });
    const waiting = task('t-3', { risk: 'alto', state: 'entregue', events: [{ kind: 'criada', at: T0, by: by('place:dev', 'dev') }, { kind: 'entregue', at: T0 + 1, by: by('place:dev', 'dev'), proofs: [{ kind: 'texto', text: 'ok' }] }] });
    const [a, b] = tarefaRows(doc(cancelled, waiting), places, { ownerName: 'Alexandre' }).rows;
    expect(a).toMatchObject({ estado: 'substituída', decisao: 'substituída pela t-9 · fechada por Alexandre', motivo: 'substituída pela t-9', quem_criou: 'Alexandre' });
    expect(b).toMatchObject({ estado: 'entregue', esperando_dono: true, decisao: null, ultima_entrega: 'ok' });
  });

  // Ledger v5, fatia 4 — a "cancel" is how v4 closed many things that were done or replaced: the row says what it
  // really was, read from the reason (nothing is written back).
  it.each<[string, string, string, string]>([
    ['done, with the merged PR', 'concluída: PR #269 (mesclado 06/11 22:57Z) criou tarefa_transferir', 'concluída por prova', 'concluída por prova · fechada por Alexandre'],
    ['done by other tasks', 'concluída pelas t-0dbcc00d e t-04d510ab: Jornada com selo provisório', 'concluída por prova', 'concluída por prova · fechada por Alexandre'],
    ['done, capitalized', 'Concluída: o ranking saiu pelo bot do Theo (t-856378c5 aceita)', 'concluída por prova', 'concluída por prova · fechada por Alexandre'],
    ['a message that went out', 'Enviada: é a raiz da thread de status no #retiro-ai', 'enviada', 'enviada · fechada por Alexandre'],
    ['replaced by one task', 'Carta substituída pela t-dc4a7364: a Triagem passa a uma cadeira agente', 'substituída', 'substituída pela t-dc4a7364 · fechada por Alexandre'],
    ['replaced by two letters', 'Substituída pelas cartas t-3401231c (reenvio da coleta) e t-c6964cbb', 'substituída', 'substituída pela t-3401231c · fechada por Alexandre'],
    ['covered by another task', 'Coberta pela t-121da54c (aceita pelo dono 06/11 20:36)', 'substituída', 'substituída pela t-121da54c · fechada por Alexandre'],
    ['it will not happen', 'O dono mandou não pedir ao Fernando', 'cancelada', 'cancelada por Alexandre'],
    // In doubt it stays "cancelada" (Revisor, PR #308): the first word is not proof; the reason must carry it.
    ['a question, not a fact', 'Concluída? Não: o dono desistiu', 'cancelada', 'cancelada por Alexandre'],
    ['a denial', 'concluída não, cancelada', 'cancelada', 'cancelada por Alexandre'],
    ['half done', 'Concluída parcialmente; o resto não vai sair', 'cancelada', 'cancelada por Alexandre'],
    ['done somewhere unnamed', 'Concluída em outra tarefa, não sei qual', 'cancelada', 'cancelada por Alexandre'],
    ['done, with no evidence after the colon', 'concluída: deu certo', 'cancelada', 'cancelada por Alexandre'],
    ['a send that did not happen', 'Enviada? não chegou a sair', 'cancelada', 'cancelada por Alexandre'],
    ['covered by a person', 'Coberta pelo Fernando', 'cancelada', 'cancelada por Alexandre'],
    ['covered by the rain', 'Coberta pela chuva', 'cancelada', 'cancelada por Alexandre'],
    ['replaced, with no task named', 'substituída pela nova versão do pedido', 'cancelada', 'cancelada por Alexandre'],
  ])('a cancel that was really %s says so', (_case, reason, estado, decisao) => {
    const closed = task('t-2', {
      state: 'rejeitada',
      events: [
        { kind: 'criada', at: T0, by: { kind: 'dono' } },
        { kind: 'rejeitada', at: T0 + 1, by: { kind: 'dono' }, text: `⟦cancelada⟧ ${reason}` },
      ],
    });
    const [row] = tarefaRows(doc(closed), places, { ownerName: 'Alexandre' }).rows;
    expect(row).toMatchObject({ estado, decisao, motivo: reason });
  });

  it('a rejected delivery stays rejected, and no cell shows a mark', () => {
    const rejected = task('t-4', {
      state: 'rejeitada',
      events: [
        { kind: 'criada', at: T0, by: { kind: 'dono' } },
        { kind: 'rejeitada', at: T0 + 1, by: { kind: 'dono' }, text: 'concluída: falta o print' },
      ],
    });
    const bot = task('t-5', {
      state: 'aceita',
      request: '⟦enviado pelo bot do agente⟧ Mensagem no Slack para D0CFB605B5M, por theo-west-slack (slack_post_message), sem carta.',
    });
    const [a, b] = tarefaRows(doc(rejected, bot), places, { ownerName: 'Alexandre' }).rows;
    expect(a).toMatchObject({ estado: 'rejeitada', decisao: 'rejeitada por Alexandre' });
    expect(b!.pedido).toBe('Mensagem no Slack para D0CFB605B5M, por theo-west-slack (slack_post_message), sem carta.');
    for (const row of [a!, b!]) for (const value of Object.values(row)) expect(String(value)).not.toContain('⟦');
  });

  it.each<[string, Partial<LedgerTask>, string]>([
    ['the creator said who (the new field)', { events: [{ kind: 'criada', at: T0, by: by('place:dev', 'dev'), text: '⟦pedido por Marta (Slack)⟧' }] }, 'Marta (Slack)'],
    ['the creator said it was the owner', { events: [{ kind: 'criada', at: T0, by: by('place:dev', 'dev'), text: '⟦substitui t-0 · pedido por dono⟧' }] }, 'Alexandre'],
    ['the owner created it', { events: [{ kind: 'criada', at: T0, by: { kind: 'dono' } }] }, 'Alexandre'],
    // 07/11, owner: "quem pediu" is the person, declared; a role never stands for one and nothing is deduced.
    ['the Líder registered it without saying who', { events: [{ kind: 'criada', at: T0, by: by('place:lider', 'lider') }] }, 'não registrado'],
    ['the Líder único registered it without saying who', { events: [{ kind: 'criada', at: T0, by: by(LEADER_OF_ALL) }] }, 'não registrado'],
    ['the Líder said it was the owner', { events: [{ kind: 'criada', at: T0, by: by('place:lider', 'lider'), text: '⟦pedido por dono⟧' }] }, 'Alexandre'],
    [
      'a Slack letter names the person it answers',
      {
        request: 'Mensagem no Slack para Gabriel Horst (DM): Você aceitou responder em «Horst: ligar as funções novas».',
        slack: { destination: 'U1', destinationLabel: 'Gabriel Horst (DM)', text: 'oi', reason: 'Você aceitou responder em «Horst: ligar as funções novas».' },
        events: [{ kind: 'criada', at: T0, by: by('place:theo', 'theo-west') }],
      },
      'Gabriel Horst (Slack)',
    ],
    [
      'a Slack letter in a channel names the person of the topic',
      {
        slack: { destination: 'C1', destinationLabel: '#homologação-spotometro, thread da Julia', thread: '1.2', text: 'oi', reason: 'Você aceitou responder em «Julia: saldo errado».' },
        events: [{ kind: 'criada', at: T0, by: by('place:theo', 'theo-west') }],
      },
      'Julia (Slack)',
    ],
    [
      'a Slack letter in a thread names who opened it',
      {
        slack: { destination: 'C1', destinationLabel: '#homologacao, na thread do Filipe de 28/10', thread: '1.2', text: 'oi', reason: 'Resposta ao Filipe sobre as homologações' },
        events: [{ kind: 'criada', at: T0, by: by('place:theo', 'theo-west') }],
      },
      'Filipe (Slack)',
    ],
    ['a quote of the owner in the request', { request: '"Preciso disso amanhã" (dono, 05/11; continua t-57d5a139)', events: [{ kind: 'criada', at: T0, by: by('place:pesq', 'pesquisa') }] }, 'não registrado'],
    ['a rule of the owner quoted mid-request', { request: 'Corrigir o build (dono, 05/11: verify inclui build) que quebrou no CI', events: [{ kind: 'criada', at: T0, by: by('place:dev', 'dev') }] }, 'não registrado'],
    ['a quote of the Revisor', { request: '"Sugestão: recusar também" (Revisor, PR #219, Ressalva 1)', events: [{ kind: 'criada', at: T0, by: by('place:pesq', 'pesquisa') }] }, 'não registrado'],
    ['a place quoted by its role', { request: 'Ajustar o card (Dev · Mindscape de cadeiras) antes do merge', events: [{ kind: 'criada', at: T0, by: by('place:dev', 'dev') }] }, 'não registrado'],
    ['a role quoted with a topic', { request: 'Comparar opções (Pesquisa sobre ledger v5)', events: [{ kind: 'criada', at: T0, by: by('place:lider', 'lider') }] }, 'não registrado'],
    ['a Curador signal quoting the owner is not the owner', { request: '"Sinal" (dono, 05/11: verify inclui build)', events: [{ kind: 'criada', at: T0, by: by('place:curador') }] }, 'sinal do Curador: dono, 05/11'],
    ['a Curador signal quoting a place by its role', { request: '"Sinal" (Dev · Mindscape de cadeiras)', events: [{ kind: 'criada', at: T0, by: by('place:curador') }] }, 'sinal do Curador: Dev, Mindscape de cadeiras'],
    ['a Curador signal with its source', { request: '"É a peça mais frágil." (Líder, como-trabalhar-05-11.html §2)', events: [{ kind: 'criada', at: T0, by: by('place:curador') }] }, 'sinal do Curador: Líder, como-trabalhar-05-11.html §2'],
    ['nobody said', { events: [{ kind: 'criada', at: T0, by: by('place:dev', 'dev') }] }, 'não registrado'],
  ])('who asked: %s', (_name, over, expected) => {
    expect(tarefaRows(doc(task('t-1', over)), places, { ownerName: 'Alexandre' }).rows[0]!.quem_pediu).toBe(expected);
  });

  it('a place keeps the name it had once its session closes, and an unknown one never shows an id', () => {
    const memory = new Map<string, PlaceInfo>();
    let live: Record<string, PlaceInfo> = { 'place:dev': { roleId: 'dev', name: 'Dev · espelho' } };
    const lookup = withPlaceMemory(() => (_project, placeId) => live[placeId], memory);
    const owned = (ownerPlaceId: string) => doc(task('t-1', { ownerPlaceId, events: [{ kind: 'criada', at: T0, by: { kind: 'dono' } }] }));
    expect(tarefaRows(owned('place:dev'), lookup()).rows[0]!.quem_faz_agora).toBe('Dev · espelho');
    live = {}; // the session closed: the registry forgot it
    expect(tarefaRows(owned('place:dev'), lookup()).rows[0]!.quem_faz_agora).toBe('Dev · espelho');
    expect(tarefaRows(owned('place:9f8e7d6c'), lookup()).rows[0]!.quem_faz_agora).toBe('lugar sem nome');
    expect(tarefaRows(owned(LEADER_OF_ALL), lookup()).rows[0]!.quem_faz_agora).toBe('Líder único');
    live = { 'place:a': { roleId: 'dev' }, 'place:b': { roleId: 'theo-west' } };
    expect(tarefaRows(owned('place:a'), lookup()).rows[0]!.quem_faz_agora).toBe('Dev (sem nome)');
    expect(tarefaRows(owned('place:b'), lookup()).rows[0]!.quem_faz_agora).toBe('Theo West');
    expect(tarefaRows(owned('place:dev'), lookup()).rows[0]!.quem_pediu).toBe('Dono');
  });

  it('the Supabase sink upserts by id and never puts the key in an error', async () => {
    const key = 'sb_secret_' + 'k'.repeat(30);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const okFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    await createSupabaseSink({ url: 'https://abcdefgh.supabase.co/', key: () => key, fetch: okFetch }).push(tarefaRows(doc(task('t-1'))).rows);
    expect(calls[0]!.url).toBe('https://abcdefgh.supabase.co/rest/v1/tarefas?on_conflict=id');
    expect((calls[0]!.init.headers as Record<string, string>).Prefer).toContain('resolution=merge-duplicates');

    const echo = (async () => new Response(`bad key ${key}`, { status: 401 })) as unknown as typeof fetch;
    const error = await createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: echo }).push([]).then(
      () => null,
      (e: Error) => e,
    );
    // Empty push sends nothing; a real one fails without the key.
    expect(error).toBeNull();
    const failed = await createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: echo })
      .push(tarefaRows(doc(task('t-1'))).rows)
      .then(
        () => null,
        (e: Error) => e.message,
      );
    expect(failed).toContain('401');
    expect(failed).not.toContain(key);
  });
});
