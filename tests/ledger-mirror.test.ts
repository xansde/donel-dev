import { describe, expect, it } from 'vitest';
import { createLedgerMirror, type MirrorSink, type MirrorTimers } from '../src/main/ledger-mirror/mirror';
import { createSupabaseSink } from '../src/main/ledger-mirror/supabase-sink';
import { demandaRows, maskSecrets, type DemandaRow } from '../src/shared/ledger/mirror';
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

function recordingSink(fail: () => boolean = () => false): MirrorSink & { pushes: DemandaRow[][] } {
  const pushes: DemandaRow[][] = [];
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
    expect(sink.pushes[0]![0]!.prova).toBe('deploy ok com [segredo]');
    expect(lines).toEqual(['mascarado: tarefa t-1, campo prova (chave Anthropic/OpenAI)']);
  });

  it('a row says board, who asked, owner by name, dates, decision and reason; files stay out', () => {
    const rejected = task('t-1', {
      risk: 'alto',
      state: 'rejeitada',
      request: 'Registrar as tarefas fora do PC',
      events: [
        { kind: 'criada', at: T0, by: { kind: 'lugar', placeId: 'place:lider', roleId: 'lider' } },
        { kind: 'assumida', at: T0 + 1000, by: { kind: 'lugar', placeId: 'place:dev', roleId: 'dev' } },
        {
          kind: 'entregue',
          at: T0 + 2000,
          by: { kind: 'lugar', placeId: 'place:dev', roleId: 'dev' },
          proofs: [
            { kind: 'arquivo', file: 'abcdefgh-print.png', mediaType: 'image/png' },
            { kind: 'link', url: 'https://github.com/x/y/actions/runs/1' },
          ],
        },
        { kind: 'rejeitada', at: T0 + 3000, by: { kind: 'dono' }, text: 'Faltou a visão em aberto' },
      ],
    });
    const { rows } = demandaRows(doc(rejected), (_project, placeId) => (placeId === 'place:dev' ? 'espelho' : undefined));
    expect(rows[0]).toEqual({
      id: 't-1',
      quadro: 'Donel Dev',
      titulo: 'Tarefa t-1',
      pedido: 'Registrar as tarefas fora do PC',
      quem_pediu: 'Líder',
      estado: 'rejeitada',
      esperando_dono: false,
      risco: 'alto',
      dono: 'Dev · espelho',
      prazo: '2026-11-07',
      criada_em: new Date(T0).toISOString(),
      entregue_em: new Date(T0 + 2000).toISOString(),
      decidida_em: new Date(T0 + 3000).toISOString(),
      decisao: 'rejeitada (Dono)',
      motivo: 'Faltou a visão em aberto',
      prova: '(1 arquivo de prova só no app)',
      prova_link: 'https://github.com/x/y/actions/runs/1',
    });
    // A high-risk delivery waits for the owner.
    const waiting = task('t-2', { risk: 'alto', state: 'entregue', events: [...rejected.events.slice(0, 3)] });
    expect(demandaRows(doc(waiting)).rows[0]).toMatchObject({ estado: 'entregue', esperando_dono: true, decisao: null });
  });

  it('the Supabase sink upserts by id and never puts the key in an error', async () => {
    const key = 'sb_secret_' + 'k'.repeat(30);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const okFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    await createSupabaseSink({ url: 'https://abcdefgh.supabase.co/', key: () => key, fetch: okFetch }).push(demandaRows(doc(task('t-1'))).rows);
    expect(calls[0]!.url).toBe('https://abcdefgh.supabase.co/rest/v1/demandas?on_conflict=id');
    expect((calls[0]!.init.headers as Record<string, string>).Prefer).toContain('resolution=merge-duplicates');

    const echo = (async () => new Response(`bad key ${key}`, { status: 401 })) as unknown as typeof fetch;
    const error = await createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: echo }).push([]).then(
      () => null,
      (e: Error) => e,
    );
    // Empty push sends nothing; a real one fails without the key.
    expect(error).toBeNull();
    const failed = await createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: echo })
      .push(demandaRows(doc(task('t-1'))).rows)
      .then(
        () => null,
        (e: Error) => e.message,
      );
    expect(failed).toContain('401');
    expect(failed).not.toContain(key);
  });
});
