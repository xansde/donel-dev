import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createLedgerMirror, type MirrorSink, type MirrorTimers } from '../src/main/ledger-mirror/mirror';
import { createSupabaseSink } from '../src/main/ledger-mirror/supabase-sink';
import { MAX_CARD_IMAGE_BYTES, MAX_PROOF_UPLOAD_FAILURES, PROOF_GIVE_UP_MS, createProofReader, type ProofReader, type ProofReaderFs } from '../src/main/ledger-mirror/cartas';
import { cartaRows, maskSecrets, tarefaRows, withPlaceMemory, type PlaceInfo, type PlaceInfoOf, type TarefaRow } from '../src/shared/ledger/mirror';
import { LEADER_OF_ALL } from '../src/shared/mindscape/leader';
import { LEDGER_SCHEMA_VERSION, applyLedgerOp, emptyLedgerDoc, type LedgerDoc, type LedgerTask } from '../src/shared/ledger/contract';

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

  // t-36a99827 — the whole prototype (2 MB) goes through the scan in the main: it must never mask less than the
  // regexes it replaced (copied here as they were on staging), and never take more than linear time.
  describe('varredura de segredos', () => {
    type Keep = (match: string, ...groups: string[]) => string;
    const STAGING: ReadonlyArray<readonly [string, RegExp, Keep?]> = [
      ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
      ['token GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
      ['chave Anthropic/OpenAI', /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g],
      ['token Supabase', /\b(?:sbp_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{10,})/g],
      ['chave Stripe', /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{16,})/g],
      ['token Slack', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
      ['webhook Slack', /\b(https?:\/\/hooks\.slack\.com\/)(?:services|workflows|triggers)\/[A-Za-z0-9_/-]+/g, (_m, base) => `${base}[segredo]`],
      ['chave AWS', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
      ['chave Google', /\bAIza[A-Za-z0-9_-]{30,}/g],
      ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
      ['Bearer', /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, (_m, word) => `${word} [segredo]`],
      ['senha', /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, (_m, head) => `${head}[segredo]@`],
      [
        'senha',
        /\b([A-Za-z0-9_.-]*(?:password|passwd|senha|secret|token|api[_-]?key)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(?!["']?\[segredo\])("[^"\n]+"|'[^'\n]+'|[^\s"',;&]{4,})/gi,
        (_m, name, sep, value) => {
          const quote = value!.startsWith('"') || value!.startsWith("'") ? value![0] : '';
          return `${name}${sep}${quote}[segredo]${quote}`;
        },
      ],
      ['e-mail', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, () => '[e-mail]'],
      ['CPF', /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, () => '[cpf]'],
    ];
    function stagingMask(text: string): { text: string; kinds: string[] } {
      const kinds: string[] = [];
      let out = text;
      for (const [kind, re, keep] of STAGING) {
        out = out.replace(re, (...args: unknown[]) => {
          kinds.push(kind);
          const groups = args.slice(1, -2).map((g) => (typeof g === 'string' ? g : ''));
          return keep ? keep(String(args[0]), ...groups) : '[segredo]';
        });
      }
      return { text: out, kinds };
    }

    // The 4 limits where the bounded regexes let a secret out (the Revisor's table), and the 3 escaped forms.
    const longLocal = 'a'.repeat(70);
    it.each([
      ['prefixo > 64', `SEAZONE_OPERACOES_INTERNAS_INTEGRACAO_COM_PARCEIRO_EXTERNO_PRODUCAO_API_KEY=${'abcd'}1234efgh`, 'abcd1234efgh', '_API_KEY=[segredo]'],
      ['sufixo > 64', `DB_PASSWORD_${'X'.repeat(65)}=hunter2secret`, 'hunter2secret', `${'X'.repeat(65)}=[segredo]`],
      ['esquema > 32', `${'x'.repeat(30)}postgres://app:p4ssw0rd@10.0.0.5/db`, 'p4ssw0rd', 'postgres://app:[segredo]@10.0.0.5/db'],
      ['e-mail com parte local > 64', `avisei ${longLocal}@empresa.com.br hoje`, longLocal, 'avisei [e-mail] hoje'],
      ['token em JSON dentro de string JS', '<script>window.cfg = "{\\"token\\": \\"tok_live_9f8e7d6c5b4a\\"}";</script>', 'tok_live', '{\\"token\\": \\"[segredo]\\"}'],
      ['apiKey em JSON.parse', 'JSON.parse("{\\"apiKey\\": \\"abc123secretvalue\\"}")', 'abc123secretvalue', '{\\"apiKey\\": \\"[segredo]\\"}'],
      ['senha em entidade HTML', '<pre>{&quot;password&quot;: &quot;hunter2secret&quot;}</pre>', 'hunter2secret', '{&quot;password&quot;: &quot;[segredo]&quot;}'],
      ['senha em JSON escapado duas vezes', 'x = "{\\\\\\"secret\\\\\\": \\\\\\"zzzz9999\\\\\\"}"', 'zzzz9999', '\\\\\\"secret\\\\\\": \\\\\\"[segredo]\\\\\\"'],
      ['senha entre &#39;', "{&#39;senha&#39;: &#39;s3nh4F0rte&#39;}", 's3nh4F0rte', '{&#39;senha&#39;: &#39;[segredo]&#39;}'],
      // The next escaped forms (second round of the review): \u0022 and \x22, numeric references with zeros or without
      // `;`, a backslash before an entity, a double encoding, and an escaped quote inside the value.
      ['token entre \\u0022', '"{\\u0022token\\u0022: \\u0022fakefakefake\\u0022}"', 'fakefakefake', '\\u0022[segredo]\\u0022'],
      ['token entre \\x22', '"{\\x22token\\x22: \\x22tok9f8e7d6c5b4a\\x22}"', 'tok9f8e7d6c5b4a', '\\x22[segredo]\\x22'],
      ['token entre \\u0027', "'{\\u0027token\\u0027: \\u0027fakefakefake\\u0027}'", 'fakefakefake', '\\u0027[segredo]\\u0027'],
      ['nome escapado, valor não', '"{\\"token\\": "tok9f8e7d6c5b4a"}"', 'tok9f8e7d6c5b4a', '"[segredo]"'],
      ['nome não, valor escapado', '"{"token": \\"tok9f8e7d6c5b4a\\"}"', 'tok9f8e7d6c5b4a', '\\"[segredo]\\"'],
      ['senha entre &#039;', '{&#039;password&#039;: &#039;hunter2secret&#039;}', 'hunter2secret', '&#039;[segredo]&#039;'],
      ['senha entre &#034;', '{&#034;password&#034;: &#034;hunter2secret&#034;}', 'hunter2secret', '&#034;[segredo]&#034;'],
      ['senha entre &#x022;', '{&#x022;password&#x022;: &#x022;hunter2secret&#x022;}', 'hunter2secret', '&#x022;[segredo]&#x022;'],
      ['senha entre &#x0022;', '{&#x0022;password&#x0022;: &#x0022;hunter2secret&#x0022;}', 'hunter2secret', '&#x0022;[segredo]&#x0022;'],
      ['senha entre &quot sem ;', '{&quotpassword&quot: &quothunter2secret&quot}', 'hunter2secret', '&quot[segredo]&quot'],
      ['senha entre &#34 sem ;', '{&#34password&#34: &#34hunter2secret&#34}', 'hunter2secret', '&#34[segredo]&#34'],
      ['JSON em string JSON em atributo', '<div data-cfg="&quot;{\\&quot;token\\&quot;:\\&quot;tok9f8e7d6c5b4a\\&quot;}&quot;">', 'tok9f8e7d6c5b4a', '\\&quot;[segredo]\\&quot;'],
      ['senha codificada duas vezes', '{&amp;quot;password&amp;quot;: &amp;quot;hunter2secret&amp;quot;}', 'hunter2secret', '&amp;quot;[segredo]&amp;quot;'],
      // An escaped quote inside the value is skipped (masked whole) only when what it reaches holds no other secret
      // name with its separator; otherwise the value closes where the regexes closed it, and the next pair goes alone.
      ['aspa escapada no valor', '"password": "hun\\"ter2secret"', 'ter2secret', '"password": "[segredo]"'],
      ['aspa escapada no valor, depois outro par', '"password": "hun\\"ter2" "token": "abc12345"', 'ter2', '"password": "[segredo]" "token": "[segredo]"'],
      ['aspa escapada que engoliria outro par', 'password: "hun\\"ter2 token: abc12345"', 'abc12345', 'password: "[segredo]"ter2 token: [segredo]"'],
      ['aspa escapada no valor escapado', '"{\\"password\\": \\"hun\\\\\\"ter2secret\\"}"', 'ter2secret', '\\"password\\": \\"[segredo]\\"}'],
      // The escaped pass looks for the close within a window: a value of a hash, and one at the window's very edge
      // (4096 after the opening `\"`, its close's backslash included).
      ['valor escapado de 64 caracteres', `"{\\"token\\": \\"${'9f8e7d6c'.repeat(8)}\\"}"`, '9f8e7d6c', '\\"token\\": \\"[segredo]\\"}'],
      ['valor escapado no limite da janela', `"{\\"token\\": \\"${'f'.repeat(4094)}\\"}"`, 'ffffffff', '\\"token\\": \\"[segredo]\\"}'],
    ])('masks %s', (_name, input, secret, expected) => {
      const masked = maskSecrets(input);
      expect(masked.text).not.toContain(secret);
      expect(masked.text).toContain(expected);
    });

    // A backslash right before the closing quote (a Windows path, an `.env` pasted in a proof): the regexes closed on
    // that quote, so the value is masked there and the next pair on the line on its own (third round of the review).
    it.each([
      ['password="hunter2\\"', 'password="[segredo]"'],
      ["senha='abc\\'", "senha='[segredo]'"],
      ['SECRET_DIR="C:\\keys\\" DB_PASSWORD="hunter2" fim', 'SECRET_DIR="[segredo]" DB_PASSWORD="[segredo]" fim'],
      ['token="C:\\dir\\" password="hunter2"', 'token="[segredo]" password="[segredo]"'],
      // What lies past the backslash holds another pair: a quoted name, spaces around the separator, a name right
      // after the quote, a name run that starts with no word character (each one a guard that let SEC1 out).
      ['token="C:\\dir\\" \'password\'="SEC1" fim', 'token="[segredo]" \'password\'="[segredo]" fim'],
      ['token="C:\\dir\\" password = "SEC1" fim', 'token="[segredo]" password = "[segredo]" fim'],
      ['token="C:\\dir\\"password="SEC1" fim', 'token="[segredo]"password="[segredo]" fim'],
      ['token="C:\\dir\\" --password="SEC1" fim', 'token="[segredo]" --password="[segredo]" fim'],
    ])('masks %s as the regexes did', (input, expected) => {
      const masked = maskSecrets(input);
      expect(masked.text).toBe(expected);
      expect(masked.text).toBe(stagingMask(input).text);
      expect(masked.hits.map((hit) => hit.kind)).toEqual(stagingMask(input).kinds);
    });

    // The same in the escaped pass (the regexes found no pair here): the next pair's name is escaped too.
    it('masks a value with a backslash before its quote, then an escaped pair, each on its own', () => {
      expect(maskSecrets('\\"token\\": "C:\\dir\\" \\"password\\": "SEC1" fim').text).toBe('\\"token\\": "[segredo]" \\"password\\": "[segredo]" fim');
    });

    // Each shape that made a regex retry a long run from every start inside it: linear now, so 2 MB in well under 1 s.
    const MB2 = 2 * 1024 * 1024;
    const fill = (unit: string, size = MB2): string => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
    const base64url = (): string => {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const out: string[] = [];
      let x = 7;
      for (let i = 0; i < MB2; i += 1) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        out.push(alphabet[x % 64]!);
      }
      return out.join('');
    };
    it.each([
      ['eyJ- (200 KB)', () => 'eyJ-'.repeat(50_000)],
      ['eyJ- (2 MB)', () => fill('eyJ-')],
      ['segmentos de JWT sem fim', () => fill('eyJaaaaaaaa.')],
      ['a. (2 MB)', () => 'a.'.repeat(1_000_000)],
      ['base64url (2 MB)', base64url],
      ['a@', () => fill('a@')],
      ['e-mail sem domínio', () => fill('.a@b.')],
      ['domínio sem fim', () => `a@${fill('b.')}`],
      ['password', () => fill('password')],
      ['password- ', () => fill('password-')],
      ['token:"', () => fill('token:"')],
      ['token:"…\\n', () => fill('token:"a\n')],
      ['x://', () => fill('x://')],
      ['esquema com hífen', () => fill('a-')],
      ['usuário sem fim', () => `x://${fill('u')}`],
      ['senha da URL sem @', () => `x://u:${fill('p:')}`],
      ['Bearer', () => fill('Bearer ')],
      ['Bearer e espaços', () => `Bearer${' '.repeat(MB2)}`],
      ['CPF', () => fill('123.')],
      ['chave privada sem fim', () => `-----BEGIN ${fill('A ')}`],
      ['barras invertidas', () => fill('\\')],
      ['aspas escapadas sem fim', () => `token\\": \\"${fill('a')}`],
      ['entidades', () => fill('password&quot;: &quot;x')],
      ['zeros numa entidade', () => fill('password&#0000000000')],
      ['&amp; sem fim', () => fill('token:&amp;')],
      ['dígitos hex sem fim', () => `token: &#x${fill('f')}`],
      ['\\u00 sem fim', () => fill('token\\u00')],
      ['barras no valor sem fim', () => `token: "${fill('\\a')}`],
      ['aspas de cada nível sem fechar', () => {
        let line = '';
        for (let d = 1; d < 1 << 17; d = d * 2 + 1) for (const q of ['"', "'", '&quot;', '&#39;', '&amp;quot;', 'u0022', 'x27']) line += `token: ${'\\'.repeat(d)}${q}a `;
        return line + fill('a', MB2 - line.length);
      }],
      // Every class of escaped opening (quote x `&amp;` x level) once after an escaped name, none closed, then a 2 MB
      // line of `\&#1` or `&`: each opening looks for its close only so far (unbounded, 2.4–3.4 s).
      ['52 aberturas escapadas sem fecho', () => {
        let line = '';
        for (let d = 0; d < 1 << 13; d = d * 2 + 1) for (const q of ['&quot;', '&#39;', '&amp;quot;', '&amp;#39;']) line += `\\"token\\": ${'\\'.repeat(d)}${q}a `;
        return line + fill('\\&#1', MB2 - line.length);
      }],
      ['52 aberturas escapadas sem fecho, resto de &', () => {
        let line = '';
        for (let d = 0; d < 1 << 13; d = d * 2 + 1) for (const q of ['&quot;', '&#39;', '&amp;quot;', '&amp;#39;']) line += `\\"token\\": ${'\\'.repeat(d)}${q}a `;
        return line + fill('&', MB2 - line.length);
      }],
      // One unclosed opening of each class (quote x `&amp;` x level), then one 2 MB run of entity digits or backslashes:
      // each look inside the window used to read the run to its end (1.7–3.1 s).
      ...(() => {
        const openings = [255, 127, 63, 31, 15, 7, 3, 1, 0]
          .flatMap((d) => ['quot', 'apos'].flatMap((q) => [false, true].map((amp) => {
            const ent = `${amp ? '&amp;' : '&'}${q};`;
            if (d === 1 && q === 'quot' && !amp) return '';
            return ` token\\": ${d === 0 ? ent : '\\'.repeat(d) + (amp ? ent : q === 'quot' ? '"' : "'")}x`;
          })))
          .join('');
        const few = [' token=&quot;x', ' token=&apos;x', ' token=&amp;quot;x', ' token=&amp;apos;x', " token=\\'x"].join('');
        return [
          ['34 aberturas e \\&# com 2 MB de zeros', () => `${openings}\\&#${'0'.repeat(2e6)}z`],
          ['34 aberturas e &#x com 2 MB de zeros', () => `${openings}&#x${'0'.repeat(2e6)}z`],
          ['5 aberturas e \\&# com 2 MB de zeros', () => `${few}\\&#${'0'.repeat(2e6)}z`],
          ['34 aberturas e 2 MB de barras', () => `${openings}${'\\'.repeat(2e6)}z`],
        ] as [string, () => string][];
      })(),
      // One unclosed opening of each class (quote x `&amp;` x 6 levels) every ~4 KB, a bit more than the window apart
      // (closer, an opening may close on the next block's), then entities with 8 zeros: each opening reading its own
      // window added up to 1.3–1.7 s over the 2 MB.
      ['24 aberturas sem fecho a cada 4 KB', () => {
        let block = '';
        for (const d of [0, 1, 3, 7, 15, 31]) for (const q of ['quot', 'apos']) for (const amp of ['&', '&amp;']) block += `\\"token\\": ${'\\'.repeat(d)}${amp}${q};a `;
        return fill(block + fill('\\&#00000000', 4300 - block.length));
      }],
      ['aspas fora da escada', () => {
        let line = '';
        for (let k = 2; line.length < MB2; k += 1) line += `token: ${'\\'.repeat(k)}"a `;
        return line;
      }],
      ['mistura', () => fill('pass_token.a-b@c.d:e//f=g"h\'i\\j&k;')],
    ])('scans %s in linear time', (_name, make) => {
      const input = make();
      // CPU time, not the clock: a busy machine (other tests, other sessions) stretches the clock, not the work.
      const started = process.cpuUsage();
      maskSecrets(input);
      const spent = process.cpuUsage(started);
      expect((spent.user + spent.system) / 1000).toBeLessThan(1000);
    });

    // A deterministic corpus of small texts, from pieces that hit every boundary of the regexes.
    const PIECES = [
      'a', 'Z', '0', '9', '_', '-', '.', '@', ':', '/', '=', '"', "'", '\\', '&', ';', ' ', '\n', '\t', '%', '+', ',', '\u00a0', 'é',
      'eyJ', 'password', 'PASSWORD', 'token', 'senha', 'secret', 'api_key', 'api-key', 'apiKey', 'passwd', 'x://', '://', 'com', 'co',
      '[segredo]', '[SEGREDO]', '&quot;', '&#39;', '&apos;', '\\"', '\\\\\\"', '&quot', '&#039;', '&#x22', '&amp;quot;', '\\u0022', '\\x27', '12345678', '123.456.789-00', 'Bearer ', 'sk-', 'ghp_',
      'abcdefgh', 'abcd', 'a@b.co', 'x.y@ab.cd', 'eyJabcdefgh.', 'abcdefgh.', 'postgres://u:p@', ':p@h', '@h.com', 'hunter22', '": "', "': '",
      'C:\\', 'TOKEN', 'TOKEN',
    ];
    // Each `TOKEN` becomes a text found nowhere else in the corpus: where the old regexes erase it, the new scan must too.
    const TOKEN = /zq[0-9a-z]+qz/g;
    let tokens = 0;
    const token = (): string => `zq${(tokens++).toString(36)}qz`;
    // Which pair shapes the corpus holds, counted below: every one must be there (an LCG's `seed % n`, its low bits of
    // short period, once left out the quoted names, the spaced separators and the single-quoted and bare values).
    const shapes = { pair: new Set<string>(), next: new Set<string>(), name: new Set<string>(), pairs: new Set<number>() };
    function corpus(): string[] {
      // mulberry32: every bit of its output is good, so `% n` reaches every choice in every mix.
      let seed = 36;
      const next = (n: number): number => {
        seed = (seed + 0x6d2b79f5) | 0;
        let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) % n;
      };
      const out: string[] = [];
      for (let i = 0; i < 30_000; i += 1) {
        const length = 1 + next(14);
        let text = '';
        for (let j = 0; j < length; j += 1) {
          const piece = PIECES[next(PIECES.length)]!;
          text += piece === 'TOKEN' ? token() : piece;
        }
        out.push(text);
      }
      // Pairs as a log line or an `.env` carries them: a value with a backslash before its quote, a Windows path, an
      // escaped quote inside, an unclosed one; two or three on a line.
      const names = ['password', 'DB_PASSWORD', 'SECRET_DIR', 'token', 'apiKey', 'senha', 'x', 'path', 'my.secret-key', 'API_KEY_FILE', '--password'];
      const nameQuotes = ['', '', '"', "'"];
      const seps = ['=', ':', ' = ', ': '];
      const quotes = ['"', '"', "'", ''];
      const values = [
        (k: string) => k, (k: string) => `C:\\dir\\${k}\\`, (k: string) => `${k}\\`, (k: string) => `hun\\"${k}`, (k: string) => `hun\\'${k}`,
        (k: string) => `C:\\keys\\${k}`, (k: string) => `${k}\\\\`, (k: string) => `a b ${k}`, (k: string) => `${k}\\"x`,
      ];
      const closes = (q: string): string[] => (q ? [q, q, `\\${q}`, '', `${q}${q}`] : ['', '\\']);
      const joins = [' ', ', ', '; ', '&', '\t', '', ' fim ', '\n'];
      for (let i = 0; i < 40_000; i += 1) {
        const pairs = 1 + next(3);
        shapes.pairs.add(pairs);
        let line = '';
        let slashBefore = false;
        for (let j = 0; j < pairs; j += 1) {
          const nq = nameQuotes[next(nameQuotes.length)]!;
          const q = quotes[next(quotes.length)]!;
          const close = closes(q);
          const name = names[next(names.length)]!;
          const sep = seps[next(seps.length)]!;
          const value = next(values.length);
          const end = close[next(close.length)]!;
          const pair = `${nq}${name}${nq}${sep}${q}${values[value]!(token())}${end}`;
          shapes.pair.add(JSON.stringify([nq, sep, q, value, end]));
          shapes.name.add(JSON.stringify([nq, name]));
          // A pair after a value with a backslash right before its quote: what a guard must find past that quote.
          if (j > 0 && slashBefore) shapes.next.add(JSON.stringify([nq, sep, q]));
          slashBefore = q !== '' && pair.endsWith(`\\${q}`);
          line += pair + joins[next(joins.length)];
        }
        out.push(line);
      }
      const bases = [
        `SEAZONE_OPERACOES_API_KEY=${'abcd'}1234efgh`, `DB_PASSWORD_${'X'.repeat(65)}=hunter2secret`, `${'x'.repeat(30)}postgres://app:p4ssw0rd@10.0.0.5/db`,
        `${longLocal}@empresa.com.br`, '{\\"token\\": \\"tok_live_9f8e7d6c5b4a\\"}', '{&quot;password&quot;: &quot;hunter2secret&quot;}',
        'eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl', 'Bearer abcdefghijklmnopqrstuvwxyz',
        // Segments one short of the minimum, one at a time.
        `eyJ${'a'.repeat(7)}.${'b'.repeat(8)}.${'c'.repeat(8)}`, `eyJ${'a'.repeat(8)}.${'b'.repeat(7)}.${'c'.repeat(8)}`, `eyJ${'a'.repeat(8)}.${'b'.repeat(8)}.${'c'.repeat(7)}`,
      ];
      for (const base of bases) for (const left of PIECES) for (const right of PIECES) out.push(`${left}${base}${right}`);
      return out;
    }

    it('never masks less than the regexes it replaced, and is the same where nothing is escaped', () => {
      const escapedQuote = /\\+(?:["']|u00(?:22|27)|x(?:22|27))|&(?:amp;)?(?:quot|apos|#)/i;
      let escaped = 0;
      let erased = 0;
      for (const input of corpus()) {
        const now = maskSecrets(input);
        const old = stagingMask(input);
        // By value: every token the old regexes erased (whole or in part) is gone from the new text too.
        for (const [found] of input.matchAll(TOKEN)) {
          if (old.text.includes(found)) continue;
          erased += 1;
          expect(now.text, `${JSON.stringify(input)} deixou ${found}`).not.toContain(found);
        }
        if (!escapedQuote.test(input)) {
          expect(now.text, JSON.stringify(input)).toBe(old.text);
          expect(now.hits.map((hit) => hit.kind)).toEqual(old.kinds);
          continue;
        }
        escaped += 1;
      }
      expect(escaped).toBeGreaterThan(10_000);
      expect(erased).toBeGreaterThan(20_000);
      // Every pair shape (name quote x separator x value quote x value x close: 3 x 4 x (2 x 9 x 4 + 9 x 2) = 1080), every
      // name with every name quote, and every next pair after a backslash before the quote (3 x 4 x 3), with 1 to 3 pairs.
      expect(shapes.pair.size).toBe(1080);
      expect(shapes.name.size).toBe(33);
      expect(shapes.next.size).toBe(36);
      expect([...shapes.pairs].sort()).toEqual([1, 2, 3]);
    });
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
        tipo: null,
        corpo: null,
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
        tipo: null,
        corpo: null,
      });
      expect(masked).toEqual([{ taskId: 't-1', field: 'carta.resumo', kinds: ['e-mail'] }]);
    });

    it('a Tutorial, an Update or an Idea goes with its kind and its text, masked', () => {
      const made = applyLedgerOp(emptyLedgerDoc(), dev, { op: 'carta', projectPath: 'C:/p', card: { kind: 'atualizacao', title: 'Chave nova', summary: 'Troquei a chave do espelho.', details: `export KEY=${secret}` } }, { now: T0, newId: () => 't-9' });
      if (!made.ok) throw new Error(made.reason);
      const { rows, masked } = cartaRows(made.doc);
      expect(rows[0]).toMatchObject({ id: 't-9', tipo: 'atualizacao', corpo: 'export KEY=[segredo]', pergunta: 'Ficou claro?', resumo: 'Troquei a chave do espelho.' });
      expect(masked).toEqual([{ taskId: 't-9', field: 'carta.corpo', kinds: ['token GitHub'] }]);
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
    function fakeSupabase(answers: { cartas?: () => Response; prova?: (body: any) => Response | Promise<Response> } = {}) {
      const calls: Array<{ url: string; body: any }> = [];
      const fetchFn = (async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push({ url, body });
        if (url.endsWith('/rpc/celular_cartas_gravar')) return answers.cartas?.() ?? Response.json([]);
        if (url.endsWith('/rpc/celular_prova_gravar')) return answers.prova?.(body) ?? Response.json(true);
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
      await sink.idle();

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
      await again.idle();
      await again.push([], cartas);
      await again.idle();
      expect(quiet.calls.map((call) => call.url.split('/').pop())).toEqual(['celular_cartas_gravar', 'celular_cartas_gravar']);
      expect(reader.reads.filter((file) => file === files.print)).toHaveLength(1);
    });

    it('a print not on this PC yet (remote mode) goes as a mention, and with its bytes once it arrives', async () => {
      let arrived = false;
      const late: ProofReader = async () => (arrived ? { kind: 'ok', bytes: printBytes } : { kind: 'sumiu' });
      const supabase = fakeSupabase();
      const sinkTimers = fakeTimers();
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn, readProof: late, timers: sinkTimers });
      const cartas = cartaRows(doc(sample)).rows;
      await sink.push([], cartas);
      await sink.idle();
      // Not here yet: the cards try again on their own, with no change of the ledger.
      expect(sinkTimers.pending()).toEqual([60_000]);
      arrived = true;
      await sinkTimers.fire();
      await sink.idle();
      expect(sinkTimers.pending()).toEqual([]);
      const proofOf = (n: number) => (supabase.calls[n]!.body as { p_cartas: Array<{ provas: unknown[] }> }).p_cartas[0]!.provas[0];
      expect(proofOf(0)).toMatchObject({ sha256: null, tamanho: null, sem_arquivo: true });
      expect(proofOf(1)).toMatchObject({ sha256: sha(printBytes), tamanho: printBytes.length, sem_arquivo: false });
    });

    it('with no card waiting the list goes empty (the phone drops the old ones)', async () => {
      const supabase = fakeSupabase();
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn });
      await sink.push([], cartaRows(doc(lowRisk)).rows);
      await sink.idle();
      expect(supabase.calls).toEqual([{ url: 'https://abcdefgh.supabase.co/rest/v1/rpc/celular_cartas_gravar', body: { p_cartas: [] } }]);
    });

    it('a failure of the cards (the RPC not created yet) never stops the tasks, nor shows the key', async () => {
      const lines: string[] = [];
      const supabase = fakeSupabase({ cartas: () => new Response(`função ausente, chave ${key}`, { status: 404 }) });
      const sinkTimers = fakeTimers();
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn, readProof: reader, log: (line) => lines.push(line), timers: sinkTimers });
      const timers = fakeTimers();
      const mirror = createLedgerMirror({ sink: () => sink, timers });
      mirror.changed(ledgerDoc);
      await timers.fire();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      await mirror.flush();
      await sink.idle();
      expect(supabase.calls[0]!.url).toContain('/rest/v1/tarefas?on_conflict=id');
      expect((supabase.calls[0]!.body as TarefaRow[]).map((row) => row.id)).toEqual(['t-1', 't-2', 't-3', 't-4']);
      // The tasks went: no retry, no error on the screen; the log says what failed, without the key.
      expect(mirror.status()).toMatchObject({ pending: false, lastError: null });
      expect(timers.pending()).toEqual([]);
      // The cards alone try again (the 006 may be applied with the app open), bounded.
      expect(sinkTimers.pending()).toEqual([60_000]);
      const failure = lines.find((line) => line.startsWith('cartas do celular'));
      expect(failure).toContain('404');
      expect(lines.join('\n')).not.toContain(key);
      expect(supabase.calls.some((call) => call.url.includes('celular_prova_gravar'))).toBe(false);
    });

    it('a proof whose upload fails never stops the next ones, and the same bytes wait their backoff, then stop for 6 h', async () => {
      let clock = 0;
      const lines: string[] = [];
      const two = { ...waiting, id: 't-9' };
      const ask = Response.json([{ tarefa: 't-1', ordem: 0 }, { tarefa: 't-1', ordem: 2 }, { tarefa: 't-9', ordem: 0 }]);
      // The print of t-1 is too big for the gateway; the prototype comes back `false`; t-9's print goes.
      const supabase = fakeSupabase({
        cartas: () => ask.clone(),
        prova: (body) => (body.p_tarefa === 't-1' && body.p_ordem === 0 ? new Response('payload too large', { status: 413 }) : Response.json(body.p_tarefa === 't-9')),
      });
      const sinkTimers = fakeTimers();
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn, readProof: reader, log: (line) => lines.push(line), timers: sinkTimers, now: () => clock });
      const cartas = cartaRows(doc(waiting, two)).rows;
      const uploads = () => supabase.calls.filter((call) => call.url.endsWith('celular_prova_gravar')).map((call) => `${call.body.p_tarefa}/${call.body.p_ordem}`);

      await sink.push([], cartas);
      await sink.idle();
      expect(uploads()).toEqual(['t-1/0', 't-1/2', 't-9/0']);
      // The failed ones bring the cards back on their own.
      expect(sinkTimers.pending()).toEqual([60_000]);
      expect(lines).toContain('prova não foi ao celular: tarefa t-1, prova 0 (Supabase respondeu 413: payload too large); tento de novo depois');
      expect(lines).toContain('prova não foi ao celular: tarefa t-1, prova 2 (o Supabase recusou); tento de novo depois');
      expect(lines).toContain(`prova enviada ao celular: tarefa t-9, prova 0 (${printBytes.length} bytes)`);

      // A change of the ledger right after: the failed bytes wait their backoff, the list still goes.
      supabase.calls.length = 0;
      await sink.push([], cartas);
      await sink.idle();
      expect(uploads()).toEqual(['t-9/0']);
      // Still waiting their backoff: the cards come back for them.
      expect(sinkTimers.pending()).toEqual([60_000]);

      // Past each backoff they go again, and after the last failure they stop until the file changes.
      for (let n = 1; n < MAX_PROOF_UPLOAD_FAILURES; n += 1) {
        clock += 60 * 60_000;
        await sink.push([], cartas);
        await sink.idle();
      }
      supabase.calls.length = 0;
      clock += 60 * 60_000;
      await sink.push([], cartas);
      await sink.idle();
      expect(uploads()).toEqual(['t-9/0']);
      expect(lines.filter((line) => line.includes('desisto dela por 6 h'))).toHaveLength(2);
      // The file never changes: 6 h after the last failure they go again (a restart is not the only way back).
      const sixHours = 6 * 60 * 60_000;
      expect(PROOF_GIVE_UP_MS).toBe(sixHours);
      const lastFailure = MAX_PROOF_UPLOAD_FAILURES - 1;
      supabase.calls.length = 0;
      clock = lastFailure * 60 * 60_000 + sixHours - 1;
      await sink.push([], cartas);
      await sink.idle();
      expect(uploads()).toEqual(['t-9/0']);
      supabase.calls.length = 0;
      clock += 1;
      await sink.push([], cartas);
      await sink.idle();
      expect(uploads()).toEqual(['t-1/0', 't-1/2', 't-9/0']);
      expect(lines.join('\n')).not.toContain(key);
    });

    it('an upload that hangs never holds the next push of the tasks', async () => {
      const supabase = fakeSupabase({ cartas: () => Response.json([{ tarefa: 't-1', ordem: 0 }]), prova: () => new Promise<Response>(() => undefined) });
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn, readProof: reader, timers: fakeTimers() });
      const timers = fakeTimers();
      const mirror = createLedgerMirror({ sink: () => sink, timers });
      mirror.changed(ledgerDoc);
      await mirror.flush();
      mirror.changed(doc(waiting));
      await mirror.flush();
      const tasks = supabase.calls.filter((call) => call.url.includes('/tarefas?'));
      expect(tasks).toHaveLength(2);
      expect(mirror.status()).toMatchObject({ pending: false, lastError: null });
      // The newer list waits for the hung upload (bounded by its timeout), never in front of the tasks.
      expect(supabase.calls.filter((call) => call.url.endsWith('celular_cartas_gravar'))).toHaveLength(1);
      sink.dispose();
    });

    it('the cards retry on their own 6 times at most, and dispose stops the timer', async () => {
      const lines: string[] = [];
      const supabase = fakeSupabase({ cartas: () => new Response('ausente', { status: 404 }) });
      const sinkTimers = fakeTimers();
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn, log: (line) => lines.push(line), timers: sinkTimers });
      await sink.push([], cartaRows(ledgerDoc).rows);
      await sink.idle();
      const waits: number[][] = [sinkTimers.pending()];
      for (let i = 0; i < 7; i += 1) {
        await sinkTimers.fire();
        await sink.idle();
        waits.push(sinkTimers.pending());
      }
      expect(waits).toEqual([[60_000], [120_000], [240_000], [480_000], [900_000], [900_000], [], []]);
      expect(supabase.calls).toHaveLength(7);
      expect(lines).toContain('cartas do celular: paro de tentar até a próxima mudança do Oráculo');

      // A change of the ledger starts over; dispose clears the timer it left.
      await sink.push([], cartaRows(ledgerDoc).rows);
      await sink.idle();
      expect(sinkTimers.pending()).toEqual([60_000]);
      sink.dispose();
      expect(sinkTimers.pending()).toEqual([]);
    });

    it('a newer list replaces the one uploading: the old one stops before its next proof', async () => {
      let release: (response: Response) => void = () => undefined;
      const supabase = fakeSupabase({
        cartas: () => Response.json([{ tarefa: 't-1', ordem: 0 }, { tarefa: 't-1', ordem: 2 }]),
        prova: (body) => (body.p_ordem === 0 && !supabase.calls.some((call) => call.url.endsWith('celular_cartas_gravar') && call.body.p_cartas.length === 0) ? new Promise<Response>((resolve) => (release = resolve)) : Response.json(true)),
      });
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn, readProof: reader, timers: fakeTimers() });
      await sink.push([], cartaRows(doc(waiting)).rows);
      for (let i = 0; i < 50 && !supabase.calls.some((call) => call.url.endsWith('celular_prova_gravar')); i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      // While the print of the old list uploads, the owner decides: the new list has no card.
      await sink.push([], []);
      release(Response.json(true));
      await sink.idle();
      expect(supabase.calls.map((call) => `${call.url.split('/').pop()}${call.body.p_ordem === undefined ? `(${call.body.p_cartas.length})` : `/${call.body.p_ordem}`}`)).toEqual([
        'celular_cartas_gravar(1)',
        'celular_prova_gravar/0',
        'celular_cartas_gravar(0)',
      ]);
    });

    it('dispose stops an upload in course before its next proof, and no list goes after it', async () => {
      let release: (response: Response) => void = () => undefined;
      const supabase = fakeSupabase({
        cartas: () => Response.json([{ tarefa: 't-1', ordem: 0 }, { tarefa: 't-1', ordem: 2 }]),
        prova: (body) => (body.p_ordem === 0 ? new Promise<Response>((resolve) => (release = resolve)) : Response.json(true)),
      });
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn, readProof: reader, timers: fakeTimers() });
      await sink.push([], cartaRows(doc(waiting)).rows);
      for (let i = 0; i < 50 && !supabase.calls.some((call) => call.url.endsWith('celular_prova_gravar')); i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      sink.dispose();
      release(Response.json(true));
      await sink.idle();
      await sink.push([], cartaRows(doc(waiting)).rows);
      await sink.idle();
      expect(supabase.calls.map((call) => `${call.url.split('/').pop()}${call.body.p_ordem === undefined ? '' : `/${call.body.p_ordem}`}`)).toEqual(['celular_cartas_gravar', 'celular_prova_gravar/0']);
    });

    it('a prototype cut in the middle of a character (a copy still arriving) is read again, never kept as a file', async () => {
      const whole = Buffer.from(`${protoHtml}ç`, 'utf8');
      let reads = 0;
      const arriving: ProofReader = async (file, max) => (file === files.proto ? { kind: 'ok', bytes: reads++ === 0 ? whole.subarray(0, whole.length - 1) : whole } : reader(file, max));
      const supabase = fakeSupabase();
      const sinkTimers = fakeTimers();
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn, readProof: arriving, timers: sinkTimers });
      await sink.push([], cartaRows(doc(waiting)).rows);
      await sink.idle();
      expect(sinkTimers.pending()).toEqual([60_000]);
      await sinkTimers.fire();
      await sink.idle();
      const prototypeOf = (n: number) => supabase.calls[n]!.body.p_cartas[0].provas[1];
      expect(prototypeOf(0)).toMatchObject({ ordem: 2, tipo: 'arquivo', sha256: null });
      expect(prototypeOf(1)).toMatchObject({ ordem: 2, tipo: 'prototipo', sha256: sha(Buffer.from(maskSecrets(whole.toString('utf8')).text, 'utf8')) });
      expect(reads).toBe(2);
    });

    it('a prototype saved in UTF-16 is masked too, and goes up in UTF-8', async () => {
      const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(protoHtml, 'utf16le')]);
      const read: ProofReader = async () => ({ kind: 'ok', bytes: utf16 });
      const supabase = fakeSupabase({ cartas: () => Response.json([{ tarefa: 't-1', ordem: 2 }]) });
      const sink = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: supabase.fetchFn, readProof: read, timers: fakeTimers() });
      await sink.push([], cartaRows(doc(waiting)).rows);
      await sink.idle();
      const upload = supabase.calls.find((call) => call.url.endsWith('celular_prova_gravar'))!.body;
      expect(Buffer.from(upload.p_dados, 'base64').toString('utf8')).toBe(maskSecrets(protoHtml).text);
      // Without a mark, NUL between the letters: no scan can read it, so it goes only as a mention.
      const bare: ProofReader = async () => ({ kind: 'ok', bytes: Buffer.from(protoHtml, 'utf16le') });
      const quiet = fakeSupabase({ cartas: () => Response.json([{ tarefa: 't-1', ordem: 2 }]) });
      const other = createSupabaseSink({ url: 'https://abcdefgh.supabase.co', key: () => key, fetch: quiet.fetchFn, readProof: bare, timers: fakeTimers() });
      await other.push([], cartaRows(doc(waiting)).rows);
      await other.idle();
      // As a file the phone does not open ("Formato que o celular não abre"), never as one too big.
      expect(quiet.calls[0]!.body.p_cartas[0].provas[1]).toMatchObject({ ordem: 2, tipo: 'arquivo', sha256: null, sem_arquivo: true });
      expect(quiet.calls.some((call) => call.url.endsWith('celular_prova_gravar'))).toBe(false);
    });

    it('the proof reader never follows a link, never reads past the limit, and reads the very file it looked at', async () => {
      const dir = '/provas';
      type Fake = { link?: boolean; size: number; ino: number; openIno?: number; content: Buffer; device?: boolean };
      function fakeFs(files: Record<string, Fake>): ProofReaderFs & { opened: string[] } {
        const opened: string[] = [];
        const of = (path: string): Fake => {
          const file = files[path.replace(/\\/g, '/').split('/').pop()!];
          if (!file) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          return file;
        };
        return {
          opened,
          lstat: async (path) => {
            const file = of(path);
            return { isSymbolicLink: () => file.link === true, isFile: () => !file.link, size: file.size, dev: 1, ino: file.ino };
          },
          open: async (path) => {
            opened.push(path);
            const file = of(path);
            return {
              stat: async () => ({ isFile: () => !file.device, size: file.size, dev: 1, ino: file.openIno ?? file.ino }),
              read: async (buffer, offset, length, position) => {
                const bytesRead = file.content.copy(buffer, offset, position, Math.min(file.content.length, position + length));
                return { bytesRead };
              },
              close: async () => undefined,
            };
          },
        };
      }
      const ok = Buffer.from('png!');
      const io = fakeFs({
        '2026-11-17-aaaaaaaaaaaa.png': { size: 4, ino: 1, content: ok },
        '2026-11-17-bbbbbbbbbbbb.png': { link: true, size: 4, ino: 2, content: ok },
        '2026-11-17-cccccccccccc.png': { size: 11, ino: 3, content: Buffer.alloc(11) },
        '2026-11-17-dddddddddddd.png': { size: 4, ino: 4, content: Buffer.alloc(11) },
        '2026-11-17-eeeeeeeeeeee.png': { size: 4, ino: 5, openIno: 99, content: ok },
        '2026-11-17-ffffffffffff.png': { size: 4, ino: 6, content: ok, device: true },
      });
      const read = createProofReader(dir, io);
      expect(await read('2026-11-17-aaaaaaaaaaaa.png', 10)).toEqual({ kind: 'ok', bytes: ok });
      expect(await read('2026-11-17-bbbbbbbbbbbb.png', 10)).toEqual({ kind: 'sumiu' });
      // Over the limit by the look: never opened.
      expect(await read('2026-11-17-cccccccccccc.png', 10)).toEqual({ kind: 'grande', size: 11 });
      expect(io.opened.some((path) => path.includes('cccccccccccc'))).toBe(false);
      // It grew after the look: at most limit + 1 read.
      expect(await read('2026-11-17-dddddddddddd.png', 10)).toEqual({ kind: 'grande', size: 11 });
      // Swapped after the look (another file, a device): nothing goes.
      expect(await read('2026-11-17-eeeeeeeeeeee.png', 10)).toEqual({ kind: 'sumiu' });
      expect(await read('2026-11-17-ffffffffffff.png', 10)).toEqual({ kind: 'sumiu' });
      expect(await read('../segredo.png', 10)).toEqual({ kind: 'sumiu' });
      expect(await read('2026-11-17-gggggggggggg.png', 10)).toEqual({ kind: 'sumiu' });
    });
  });
});
