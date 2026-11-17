import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createLedgerMirror, type MirrorSink, type MirrorTimers } from '../src/main/ledger-mirror/mirror';
import { createSupabaseSink } from '../src/main/ledger-mirror/supabase-sink';
import { MAX_CARD_IMAGE_BYTES, type ProofReader } from '../src/main/ledger-mirror/cartas';
import { cartaRows, maskSecrets, tarefaRows, withPlaceMemory, type PlaceInfo, type PlaceInfoOf, type TarefaRow } from '../src/shared/ledger/mirror';
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
    // Ressalvas do Revisor no #308: a denial right after the colon, the case of the id, and a task that replaces itself.
    ['sent, then denied', 'Enviada: não chegou a sair', 'cancelada', 'cancelada por Alexandre'],
    ['done, then denied, with a PR further on', 'concluída: não, o dono desistiu; ver #12', 'cancelada', 'cancelada por Alexandre'],
    ['done, "nunca" after the colon', 'Concluída: nunca saiu do rascunho (t-0123abcd)', 'cancelada', 'cancelada por Alexandre'],
    ['replaced, id in capitals', 'Coberta pela T-ABCD1234 (aceita)', 'substituída', 'substituída pela t-abcd1234 · fechada por Alexandre'],
    ['replaced by itself', 'substituída pela t-2', 'cancelada', 'cancelada por Alexandre'],
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

  // t-36a99827 — the phone shows the card's options, the recommended one and the delivery's print and prototype.
  describe('cartas do celular', () => {
    const dev = { kind: 'lugar' as const, placeId: 'place:dev', roleId: 'dev' };
    const secret = 'ghp_' + 'z'.repeat(36);
    const files = {
      print: '2026-11-17-aaaaaaaaaaaa.png',
      proto: '2026-11-17-bbbbbbbbbbbb.html',
      video: '2026-11-17-cccccccccccc.mp4',
      big: '2026-11-17-dddddddddddd.png',
    };
    const printBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const protoHtml = `<html><body><script>const token = "${secret}";</script>ok</body></html>`;
    const waiting = task('t-1', {
      risk: 'alto',
      state: 'entregue',
      events: [
        { kind: 'criada', at: T0, by: { kind: 'dono' } },
        {
          kind: 'entregue',
          at: T0 + 1,
          by: dev,
          proofs: [
            { kind: 'arquivo', file: files.print, mediaType: 'image/png' },
            { kind: 'texto', text: '4 passed' },
            { kind: 'arquivo', file: files.proto, mediaType: 'text/html' },
            { kind: 'arquivo', file: files.video, mediaType: 'video/mp4' },
            { kind: 'arquivo', file: files.big, mediaType: 'image/png' },
          ],
          forOwner: {
            title: 'Botão verde',
            question: 'Aceito o botão verde?',
            summary: `Feito; avisei cliente@empresa.com.br`,
            options: [
              { label: 'Aceitar', effect: 'Vai para o alfa.', closes: 'aceita', recommended: true },
              { label: 'Refazer', effect: 'Volta para o Dev.', risk: 'Atrasa um dia.', closes: 'rejeitada' },
            ],
            why: 'O print bate com o pedido.',
            risk: 'Baixo.',
            visual: { kind: 'antes-depois', before: 0, after: 2 },
          },
        },
      ],
    });
    // A Revisor's accept in the daily sample: it came with a card, but the phone draws the old one, without options.
    const sample = task('t-2', {
      state: 'aceita',
      events: [
        { kind: 'criada', at: T0, by: { kind: 'dono' } },
        {
          kind: 'entregue',
          at: T0 + 1,
          by: dev,
          proofs: [{ kind: 'arquivo', file: files.print, mediaType: 'image/png' }],
          forOwner: { question: 'q?', summary: 's', options: [{ label: 'A', effect: 'e', closes: 'aceita', recommended: true }, { label: 'B', effect: 'e', closes: 'rejeitada' }], why: 'w', risk: 'r', visual: { kind: 'prova', proof: 0 } },
        },
        { kind: 'aceita', at: T0 + 2, by: { kind: 'lugar', placeId: 'place:rev', roleId: 'revisor' } },
      ],
    });
    // Not waiting: a low-risk delivery, and one the owner already decided.
    const lowRisk = task('t-3', { state: 'entregue', events: [{ kind: 'criada', at: T0, by: { kind: 'dono' } }, { kind: 'entregue', at: T0 + 1, by: dev, proofs: [{ kind: 'texto', text: 'ok' }] }] });
    const decided = task('t-4', {
      risk: 'alto',
      state: 'aceita',
      events: [...waiting.events, { kind: 'aceita', at: T0 + 2, by: { kind: 'dono' }, option: 'Aceitar' }],
    });
    const ledgerDoc = doc(waiting, sample, lowRisk, decided);

    it('a card waiting for the owner goes with its options, the recommended one, the visual and the proof files, masked', () => {
      const { rows, masked } = cartaRows(ledgerDoc);
      // Only what waits for the owner; the sample goes without a card but with its print.
      expect(rows.map((row) => row.id)).toEqual(['t-1', 't-2']);
      expect(rows[0]).toEqual({
        id: 't-1',
        titulo: 'Botão verde',
        pergunta: 'Aceito o botão verde?',
        resumo: 'Feito; avisei [e-mail]',
        opcoes: [
          { rotulo: 'Aceitar', efeito: 'Vai para o alfa.', fecha: 'aceita', recomendada: true },
          { rotulo: 'Refazer', efeito: 'Volta para o Dev.', risco: 'Atrasa um dia.', fecha: 'rejeitada' },
        ],
        porque: 'O print bate com o pedido.',
        risco: 'Baixo.',
        visual: { tipo: 'antes-depois', antes: 0, depois: 2 },
        // `ordem` is the place in the delivery's proofs (the text proof keeps its number 1).
        provas: [
          { ordem: 0, tipo: 'imagem', media_type: 'image/png', rotulo: 'Print', file: files.print },
          { ordem: 2, tipo: 'prototipo', media_type: 'text/html', rotulo: 'Protótipo', file: files.proto },
          { ordem: 3, tipo: 'video', media_type: 'video/mp4', rotulo: 'Vídeo', file: files.video },
          { ordem: 4, tipo: 'imagem', media_type: 'image/png', rotulo: 'Print', file: files.big },
        ],
      });
      expect(rows[1]).toEqual({
        id: 't-2',
        titulo: null,
        pergunta: null,
        resumo: null,
        opcoes: [],
        porque: null,
        risco: null,
        visual: null,
        provas: [{ ordem: 0, tipo: 'imagem', media_type: 'image/png', rotulo: 'Print', file: files.print }],
      });
      expect(masked).toEqual([{ taskId: 't-1', field: 'carta.resumo', kinds: ['e-mail'] }]);
    });

    it('checks on the front are masked too', () => {
      const checks = task('t-5', {
        risk: 'alto',
        state: 'entregue',
        events: [
          { kind: 'criada', at: T0, by: { kind: 'dono' } },
          {
            kind: 'entregue',
            at: T0 + 1,
            by: dev,
            proofs: [{ kind: 'texto', text: 'ok' }],
            forOwner: { ...waiting.events[1]!.forOwner!, summary: 'ok', visual: { kind: 'checagens', checks: [{ name: 'deploy', ok: true, sentence: `saiu com ${secret}` }] } },
          },
        ],
      });
      const { rows, masked } = cartaRows(doc(checks));
      expect(rows[0]!.visual).toEqual({ tipo: 'checagens', itens: [{ nome: 'deploy', ok: true, frase: 'saiu com [segredo]' }] });
      expect(masked).toEqual([{ taskId: 't-5', field: 'carta.visual.itens[0].frase', kinds: ['token GitHub'] }]);
    });

    const key = 'sb_secret_' + 'k'.repeat(30);
    const reader: ProofReader & { reads: string[] } = Object.assign(
      async (file: string, max: number) => {
        reader.reads.push(file);
        if (file === files.print) return { kind: 'ok' as const, bytes: printBytes };
        if (file === files.proto) return { kind: 'ok' as const, bytes: Buffer.from(protoHtml, 'utf8') };
        if (file === files.big) return { kind: 'grande' as const, size: max + 1 };
        throw new Error(`the video is never read: ${file}`);
      },
      { reads: [] as string[] },
    );
    const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

    /** A Supabase that records each POST and answers each RPC from `answers`. */
    function fakeSupabase(answers: { cartas?: () => Response; prova?: () => Response } = {}) {
      const calls: Array<{ url: string; body: any }> = [];
      const fetchFn = (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        if (url.endsWith('/rpc/celular_cartas_gravar')) return answers.cartas?.() ?? Response.json([]);
        if (url.endsWith('/rpc/celular_prova_gravar')) return answers.prova?.() ?? Response.json(true);
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch;
      return { calls, fetchFn };
    }

    it('the sink records the cards after the tasks and uploads only the proofs asked for, with the right hash', async () => {
      reader.reads = [];
      const lines: string[] = [];
      // The database asks for every proof of t-1, the video and the big print included: those never go as bytes.
      const ask = Response.json([0, 2, 3, 4].map((ordem) => ({ tarefa: 't-1', ordem })));
      const supabase = fakeSupabase({ cartas: () => ask.clone() });
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn, readProof: reader, log: (line) => lines.push(line) });
      const cartas = cartaRows(ledgerDoc).rows;
      await sink.push(tarefaRows(ledgerDoc).rows, cartas);

      expect(supabase.calls.map((call) => call.url.replace('https://abcdefgh.supabase.co/rest/v1/', ''))).toEqual([
        'tarefas?on_conflict=id',
        'rpc/celular_cartas_gravar',
        'rpc/celular_prova_gravar',
        'rpc/celular_prova_gravar',
      ]);
      const maskedHtml = Buffer.from(maskSecrets(protoHtml).text, 'utf8');
      const body = supabase.calls[1]!.body as { p_cartas: Array<Record<string, unknown>> };
      expect(body.p_cartas.map((carta) => carta.id)).toEqual(['t-1', 't-2']);
      expect(body.p_cartas[0]).toMatchObject({ pergunta: 'Aceito o botão verde?', opcoes: [expect.objectContaining({ rotulo: 'Aceitar', recomendada: true }), expect.not.objectContaining({ recomendada: true })] });
      expect(body.p_cartas[0]!.provas).toEqual([
        { ordem: 0, tipo: 'imagem', media_type: 'image/png', rotulo: 'Print', sha256: sha(printBytes), tamanho: printBytes.length, sem_arquivo: false },
        { ordem: 2, tipo: 'prototipo', media_type: 'text/html', rotulo: 'Protótipo', sha256: sha(maskedHtml), tamanho: maskedHtml.length, sem_arquivo: false },
        { ordem: 3, tipo: 'video', media_type: 'video/mp4', rotulo: 'Vídeo', sha256: null, tamanho: null, sem_arquivo: true },
        { ordem: 4, tipo: 'imagem', media_type: 'image/png', rotulo: 'Print', sha256: null, tamanho: MAX_CARD_IMAGE_BYTES + 1, sem_arquivo: true },
      ]);
      // No file name, no path, no secret in what the cards' RPC receives.
      expect(JSON.stringify(body)).not.toMatch(/2026-11-17-|ledger-provas|ghp_|cliente@/);

      const [print, proto] = [supabase.calls[2]!.body, supabase.calls[3]!.body];
      expect(print).toEqual({ p_tarefa: 't-1', p_ordem: 0, p_sha256: sha(printBytes), p_dados: printBytes.toString('base64') });
      expect(proto).toMatchObject({ p_tarefa: 't-1', p_ordem: 2, p_sha256: sha(maskedHtml) });
      const uploaded = Buffer.from(proto.p_dados as string, 'base64').toString('utf8');
      expect(uploaded).not.toContain(secret);
      expect(uploaded).toContain('const token = "[segredo]"');
      expect(lines).toContain('mascarado: tarefa t-1, campo prova 2 (protótipo) (token GitHub)');
      // What goes only as a mention is never read for an upload, even when asked.
      expect(reader.reads.filter((file) => file === files.big)).toHaveLength(1);

      // The next push: nothing asked, nothing uploaded, and the files already hashed are not read again.
      reader.reads = [];
      const quiet = fakeSupabase();
      const again = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: quiet.fetchFn, readProof: reader });
      await again.push([], cartas);
      await again.push([], cartas);
      expect(quiet.calls.map((call) => call.url.split('/').pop())).toEqual(['celular_cartas_gravar', 'celular_cartas_gravar']);
      expect(reader.reads.filter((file) => file === files.print)).toHaveLength(1);
    });

    it('a print not on this PC yet (remote mode) goes as a mention, and with its bytes once it arrives', async () => {
      let arrived = false;
      const late: ProofReader = async () => (arrived ? { kind: 'ok', bytes: printBytes } : { kind: 'sumiu' });
      const supabase = fakeSupabase();
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn, readProof: late });
      const cartas = cartaRows(doc(sample)).rows;
      await sink.push([], cartas);
      arrived = true;
      await sink.push([], cartas);
      const proofOf = (n: number) => (supabase.calls[n]!.body as { p_cartas: Array<{ provas: unknown[] }> }).p_cartas[0]!.provas[0];
      expect(proofOf(0)).toMatchObject({ sha256: null, tamanho: null, sem_arquivo: true });
      expect(proofOf(1)).toMatchObject({ sha256: sha(printBytes), tamanho: printBytes.length, sem_arquivo: false });
    });

    it('with no card waiting the list goes empty (the phone drops the old ones)', async () => {
      const supabase = fakeSupabase();
      await createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn }).push([], cartaRows(doc(lowRisk)).rows);
      expect(supabase.calls).toEqual([{ url: 'https://abcdefgh.supabase.co/rest/v1/rpc/celular_cartas_gravar', body: { p_cartas: [] } }]);
    });

    it('a failure of the cards (the RPC not created yet) never stops the tasks, nor shows the key', async () => {
      const lines: string[] = [];
      const supabase = fakeSupabase({ cartas: () => new Response(`função ausente, chave ${key}`, { status: 404 }) });
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn, readProof: reader, log: (line) => lines.push(line) });
      const timers = fakeTimers();
      const mirror = createLedgerMirror({ sink: () => sink, timers });
      mirror.changed(ledgerDoc);
      await timers.fire();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      await mirror.flush();
      expect(supabase.calls[0]!.url).toContain('/rest/v1/tarefas?on_conflict=id');
      expect((supabase.calls[0]!.body as TarefaRow[]).map((row) => row.id)).toEqual(['t-1', 't-2', 't-3', 't-4']);
      // The tasks went: no retry, no error on the screen; the log says what failed, without the key.
      expect(mirror.status()).toMatchObject({ pending: false, lastError: null });
      expect(timers.pending()).toEqual([]);
      const failure = lines.find((line) => line.startsWith('cartas do celular'));
      expect(failure).toContain('404');
      expect(lines.join('\n')).not.toContain(key);
      expect(supabase.calls.some((call) => call.url.includes('celular_prova_gravar'))).toBe(false);
    });
  });
});
