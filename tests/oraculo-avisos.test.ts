import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import type { LedgerService } from '../src/main/ledger-store';
import { createCelularCore } from '../src/main/celular/service';
import { applyLedgerOp, emptyLedgerDoc, type LedgerDoc } from '../src/shared/ledger/contract';
import type { OwnerInboxItem } from '../src/shared/ledger/inbox';
import { createCelularLocalStore } from '../src/oraculo/celular-local';
import { createCelularV2Handler, signedMessage } from '../src/oraculo/celular-v2';
import { isChatRoute } from '../src/oraculo/celular-frente';
import { JOINED_REPLY } from '../src/oraculo/chat-celular';
import { avisavel, avisoDeCarta, avisosDoChat, createAvisos, createAvisosTeste, decodeCursor, encodeCursor, type Avisos, type LinhaDoChat } from '../src/oraculo/avisos';
import { createAvisosCartasReader, createAvisosCartasWriter, entradasDeCartas } from '../src/oraculo/avisos-cartas';

// t-b07b50ff — o celular avisa como um app normal (contrato: ~/seazone/_scratch/sondas/notificacao-celular/contrato.md).
// O dono: "Eu prefiro não receber mensagem do que receber uma mensagem vazia tua." O que quebraria sem ele perceber:
// um aviso vazio, um aviso repetido ou perdido numa volta, a noite sem rede virando dezenas de vibrações, e a rota
// aberta sem assinatura ou com a flag desligada.

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'avisos-'));
  dirs.push(dir);
  return dir;
};

const T0 = Date.parse('2026-11-20T14:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const linha = (id: string, autor: 'dono' | 'lider', texto: string, at: number): LinhaDoChat => ({ id, autor, texto, criada_em: new Date(at).toISOString() });

function mundo(opts: { clock?: () => number } = {}) {
  const rows: LinhaDoChat[] = [];
  const dir = tmp();
  const file = join(dir, 'avisos-cartas.json');
  const clock = opts.clock ?? (() => T0);
  const teste = createAvisosTeste(clock);
  const reader = createAvisosCartasReader(file);
  const avisos: Avisos = createAvisos({ conversa: () => rows, cartas: reader.entradas, teste: teste.entradas, now: clock });
  return { rows, file, teste, avisos };
}

const q = (desde: string | null, espera?: number): URLSearchParams => {
  const p = new URLSearchParams();
  if (desde !== null) p.set('desde', desde);
  if (espera !== undefined) p.set('espera', String(espera));
  return p;
};

describe('avisos do celular (t-b07b50ff)', () => {
  it('1. sem texto, sem aviso; linha do dono nunca vira aviso', () => {
    const rows = [
      linha('a', 'lider', '', T0),
      linha('b', 'lider', '   ', T0 + 1),
      linha('c', 'lider', '-', T0 + 2),
      linha('d', 'lider', JOINED_REPLY, T0 + 3),
      linha('e', 'dono', 'oi, Líder', T0 + 4),
      linha('f', 'lider', 'O PR entrou na staging.', T0 + 5),
    ];
    const out = avisosDoChat(rows, null);
    expect(out.map((a) => a.id)).toEqual(['chat:f']);
    expect(out[0]).toMatchObject({ v: 1, tipo: 'chat', titulo: 'Líder único', texto: 'O PR entrou na staging.', abrir: { tela: 'lider' } });
    expect(avisavel(JOINED_REPLY)).toBe(false);
    expect(avisavel('ok', '  ')).toBe(false);
  });

  it('2. sem cursor, sem histórico: a resposta vem na hora, vazia, com o cursor', async () => {
    const w = mundo();
    for (let i = 0; i < 300; i += 1) w.rows.push(linha(`l${String(i).padStart(3, '0')}`, i % 2 ? 'lider' : 'dono', `mensagem ${i}`, T0 - (300 - i) * 1000));
    const res = await w.avisos.atender('cel', q(null));
    expect(res.avisos).toEqual([]);
    expect(res.mais).toBe(false);
    expect(decodeCursor(res.cursor)?.c).toEqual({ em: w.rows[299]!.criada_em, id: 'l299' });
  });

  it('3. retomada exata: sai só o que veio depois, igual na repetição, e o cursor final não reemite', async () => {
    vi.useFakeTimers();
    const w = mundo();
    w.rows.push(linha('a', 'lider', 'antes', T0 - 5 * MIN));
    const c0 = (await w.avisos.atender('cel', q(null))).cursor;
    w.rows.push(linha('b', 'dono', 'pergunta', T0 - 4 * MIN), linha('c', 'lider', 'um', T0 - 3 * MIN), linha('d', 'lider', 'dois', T0 - 2 * MIN));
    const first = await w.avisos.atender('cel', q(c0));
    expect(first.avisos.map((a) => a.id)).toEqual(['chat:c', 'chat:d']);
    const again = await w.avisos.atender('cel', q(c0));
    expect(again.avisos.map((a) => a.id)).toEqual(['chat:c', 'chat:d']);
    const pending = w.avisos.atender('cel', q(first.cursor, 1));
    await vi.advanceTimersByTimeAsync(1_100);
    expect((await pending).avisos).toEqual([]);
  });

  it('4. a linha do cursor apagada: a comparação por (criada_em, id) não repete nem perde', async () => {
    const w = mundo();
    w.rows.push(linha('a', 'lider', 'um', T0 - 5 * MIN), linha('b', 'lider', 'dois', T0 - 4 * MIN));
    const c0 = (await w.avisos.atender('cel', q(null))).cursor;
    w.rows.splice(0, 2);
    w.rows.push(linha('c', 'lider', 'três', T0 - 3 * MIN), linha('d', 'lider', 'quatro', T0 - 2 * MIN));
    expect((await w.avisos.atender('cel', q(c0))).avisos.map((a) => a.id)).toEqual(['chat:c', 'chat:d']);
  });

  it('5. teto de retomada: cursor velho com 40 avisos dá os 10 mais recentes das últimas 24 h; rajada nova pagina', async () => {
    vi.useFakeTimers();
    const w = mundo();
    const c0 = (await w.avisos.atender('cel', q(null))).cursor;
    for (let i = 0; i < 40; i += 1) w.rows.push(linha(`m${String(i).padStart(2, '0')}`, 'lider', `aviso ${i}`, T0 - 40 * HOUR + i * HOUR));
    const res = await w.avisos.atender('cel', q(c0));
    expect(res.avisos.map((a) => a.id)).toEqual(Array.from({ length: 10 }, (_, k) => `chat:m${30 + k}`));
    expect(res.mais).toBe(false);
    const pending = w.avisos.atender('cel', q(res.cursor, 1));
    await vi.advanceTimersByTimeAsync(1_100);
    expect((await pending).avisos).toEqual([]);

    // Uma rajada recente (não é retomada): os 10 mais antigos primeiro, `mais`, e o resto na volta seguinte.
    for (let i = 0; i < 12; i += 1) w.rows.push(linha(`r${String(i).padStart(2, '0')}`, 'lider', `rajada ${i}`, T0 - 60_000 + i * 1000));
    const page = await w.avisos.atender('cel', q(res.cursor));
    expect(page.avisos.map((a) => a.id)).toEqual(Array.from({ length: 10 }, (_, k) => `chat:r${String(k).padStart(2, '0')}`));
    expect(page.mais).toBe(true);
    const rest = await w.avisos.atender('cel', q(page.cursor));
    expect(rest.avisos.map((a) => a.id)).toEqual(['chat:r10', 'chat:r11']);
    expect(rest.mais).toBe(false);
  });

  it('6. cartas: só as de decidir, nunca vazias, seq que não volta e o mesmo since novo avisa de novo', async () => {
    const made = applyLedgerOp(emptyLedgerDoc(), { kind: 'lugar', placeId: 'place:dev' }, { op: 'carta-slack', projectPath: 'C:/p', slack: { destination: 'C0123ABC', destinationLabel: '#produto', text: 'oi', reason: 'avisar' } }, { now: T0, newId: () => 't-1a2b3c4d' });
    if (!made.ok) throw new Error(made.reason);
    const task = made.task;
    const item = (kind: OwnerInboxItem['kind']): OwnerInboxItem => ({ kind, task, since: T0, blocks: false });
    const novas = entradasDeCartas([item('para-repassar'), item('carta-parada'), item('aprovar-carta')]);
    expect(novas.map((n) => n.kind)).toEqual(['aprovar-carta']);
    expect(novas[0]!.titulo).toContain('#produto');
    expect(novas[0]!.texto.trim()).not.toBe('');

    let clock = T0;
    const w = mundo({ clock: () => clock });
    const c0 = (await w.avisos.atender('cel', q(null))).cursor;
    const writer = createAvisosCartasWriter(w.file, () => clock);
    writer.add([
      { t: 't-1a2b3c4d', kind: 'decidir-entrega', since: T0 - 1000, titulo: '   ', texto: 'Posso?' },
      { t: 't-1a2b3c4d', kind: 'decidir-entrega', since: T0 - 1000, titulo: 'Faixa', texto: '-' },
    ]);
    expect(existsSync(w.file) ? JSON.parse(readFileSync(w.file, 'utf8')).entradas : []).toEqual([]);
    writer.add([{ t: 't-1a2b3c4d', kind: 'decidir-entrega', since: T0 - 1000, titulo: 'Faixa do celular', texto: 'Posso promover?' }]);
    expect(statSync(w.file).mode & 0o777).toBe(0o600);
    const s1 = JSON.parse(readFileSync(w.file, 'utf8')).entradas[0].seq as number;
    // Reinício com o relógio parado: o seq lido do arquivo segue crescendo.
    createAvisosCartasWriter(w.file, () => clock).add([{ t: 't-1a2b3c4d', kind: 'decidir-entrega', since: T0 + 5000, titulo: 'Faixa do celular', texto: 'Posso promover?' }]);
    const entradas = JSON.parse(readFileSync(w.file, 'utf8')).entradas as Array<{ seq: number; id: string }>;
    expect(entradas[1]!.seq).toBeGreaterThan(s1);
    expect(entradas[1]!.id).not.toBe(entradas[0]!.id);

    const got = await w.avisos.atender('cel', q(c0));
    expect(got.avisos.map((a) => a.id)).toEqual([`carta:t-1a2b3c4d:decidir-entrega:${T0 - 1000}`, `carta:t-1a2b3c4d:decidir-entrega:${T0 + 5000}`]);
    expect(got.avisos[0]).toMatchObject({ tipo: 'carta', abrir: { tela: 'oraculo', carta: 't-1a2b3c4d' }, em: new Date(T0 - 1000).toISOString() });

    // Apagado o arquivo, o seq do escritor novo não volta para trás.
    unlinkSync(w.file);
    clock = T0 + MIN;
    createAvisosCartasWriter(w.file, () => clock).add([{ t: 't-1a2b3c4d', kind: 'entrega-parada', since: T0 + 9000, titulo: 'Faixa do celular', texto: 'Parada.' }]);
    const after = JSON.parse(readFileSync(w.file, 'utf8')).entradas as Array<{ seq: number }>;
    expect(after[0]!.seq).toBeGreaterThan(entradas[1]!.seq);
    const next = await w.avisos.atender('cel', q(got.cursor));
    expect(next.avisos.map((a) => a.id)).toEqual([`carta:t-1a2b3c4d:entrega-parada:${T0 + 9000}`]);
    expect(avisoDeCarta({ seq: 1, id: 'x', t: 't-1a2b3c4d', kind: 'decidir-entrega', since: T0, titulo: 'ok', texto: '  ', em: '' })).toBeNull();
  });

  it('7. o serviço do celular chama onFresh sem inscrição de push e com o celular desligado', async () => {
    const dev = { kind: 'lugar' as const, placeId: 'place:dev' };
    let n = 0;
    const ctx = () => ({ now: T0 + n * 1000, newId: () => `t-0000000${++n}` });
    const letter = (label: string) => ({ op: 'carta-slack' as const, projectPath: 'C:/p', slack: { destination: 'C0123ABC', destinationLabel: label, text: 'oi', reason: 'avisar' } });
    const first = applyLedgerOp(emptyLedgerDoc(), dev, letter('#produto'), ctx());
    if (!first.ok) throw new Error(first.reason);
    let doc: LedgerDoc = first.doc;
    const seen: string[] = [];
    const core = createCelularCore({
      userDataDir: tmp(),
      io: createSystemConfigIoDeps(),
      ledger: () => ({ load: () => ({ doc }) }) as unknown as LedgerService,
      provasRoot: tmp(),
      onFresh: (fresh) => seen.push(...fresh.map((item) => `${item.task.id}:${item.kind}`)),
    });
    try {
      const second = applyLedgerOp(doc, dev, letter('#time'), ctx());
      if (!second.ok) throw new Error(second.reason);
      doc = second.doc;
      core.ledgerChanged(doc);
      expect(seen).toEqual([`${second.task.id}:aprovar-carta`]);
    } finally {
      await core.dispose();
    }
  });

  it('8. corte: 5 mil caracteres viram 300 com «…», e o aviso serializado cabe em 2048 bytes', () => {
    const [long] = avisosDoChat([linha('a', 'lider', 'a'.repeat(5000), T0)], null);
    expect(Array.from(long!.texto)).toHaveLength(300);
    expect(long!.texto.endsWith('…')).toBe(true);
    const heavy = avisoDeCarta({ seq: 1, id: 'x', t: 't-1a2b3c4d', kind: 'decidir-entrega', since: T0, titulo: '\u0001'.repeat(500), texto: '\u0001'.repeat(5000), em: '' });
    expect(Array.from(heavy!.titulo)).toHaveLength(70);
    expect(Buffer.byteLength(JSON.stringify(heavy))).toBeLessThanOrEqual(2048);
    expect(heavy!.texto.endsWith('…')).toBe(true);
  });

  describe('9. a rota GET /api/v2/avisos', () => {
    const KEY = createHash('sha256').update('token-do-aparelho', 'utf8').digest();
    function rota(opts: { flag?: boolean; avisos?: boolean } = {}) {
      const w = mundo();
      const handler = createCelularV2Handler({
        verify: (message, signature) => (createHmac('sha256', KEY).update(message, 'utf8').digest('hex') === signature ? { name: 'Donel (Android)' } : null),
        doc: () => null,
        store: createCelularLocalStore(join(tmp(), 'chat-local.json'), () => T0),
        readProof: async () => ({ kind: 'sumiu' }),
        arvoreFile: join(tmp(), 'arvore.json'),
        flagOn: (name) => name === 'celular-avisos' && (opts.flag ?? true),
        ...(opts.avisos === false ? {} : { avisos: w.avisos }),
        now: () => T0,
      });
      const call = (url: string, ts = T0) => {
        const sig = createHmac('sha256', KEY).update(signedMessage('GET', url, String(ts), ''), 'utf8').digest('hex');
        return handler({ method: 'GET', url, body: '', authorization: `Donel-HMAC ${ts}.${sig}` });
      };
      return { w, handler, call };
    }
    const body = (res: { body: unknown }): any => JSON.parse(String(res.body));

    it('fecha sem assinatura, com relógio velho, com a flag desligada e no registro', async () => {
      expect(isChatRoute('/api/v2/avisos?desde=x&espera=50')).toBe(true);
      const r = rota();
      const unsigned = await r.handler({ method: 'GET', url: '/api/v2/avisos', body: '' });
      expect([unsigned.status, body(unsigned).erro]).toEqual([401, 'nao-pareado']);
      const old = await r.call('/api/v2/avisos', T0 - 10 * MIN);
      expect([old.status, body(old).erro]).toEqual([401, 'relogio']);
      const off = await rota({ flag: false }).call('/api/v2/avisos');
      expect([off.status, body(off).erro]).toEqual([404, 'desligada']);
      const registro = await rota({ avisos: false }).call('/api/v2/avisos');
      expect([registro.status, body(registro).erro]).toEqual([404, 'nao-encontrada']);
      const ok = await r.call('/api/v2/avisos');
      expect(ok.status).toBe(200);
      expect(body(ok)).toMatchObject({ v: 1, mais: false, avisos: [] });
    });

    it('espera até o fim e devolve vazio com o mesmo cursor; aviso que chega sai na hora; pedido novo do aparelho encerra o anterior', async () => {
      vi.useFakeTimers();
      const r = rota();
      const cursor = body(await r.call('/api/v2/avisos')).cursor as string;
      const url = `/api/v2/avisos?desde=${encodeURIComponent(cursor)}&espera=3`;
      const waiting = r.call(url);
      await vi.advanceTimersByTimeAsync(3_100);
      expect(body(await waiting)).toEqual({ v: 1, cursor, mais: false, avisos: [] });

      const arriving = r.call(url);
      await vi.advanceTimersByTimeAsync(500);
      r.w.teste.add();
      await vi.advanceTimersByTimeAsync(1_000);
      const got = body(await arriving);
      expect(got.avisos).toHaveLength(1);
      expect(got.avisos[0]).toMatchObject({ tipo: 'teste', abrir: { tela: 'lider' } });
      expect(got.avisos[0].texto).toMatch(/^Teste de aviso \d{2}:\d{2}:\d{2}$/);

      const next = body(await r.call('/api/v2/avisos')).cursor as string;
      const longUrl = `/api/v2/avisos?desde=${encodeURIComponent(next)}&espera=50`;
      const first = r.call(longUrl);
      await vi.advanceTimersByTimeAsync(100);
      const second = r.call(longUrl);
      expect(body(await first)).toEqual({ v: 1, cursor: next, mais: false, avisos: [] });
      await vi.advanceTimersByTimeAsync(50_100);
      expect(body(await second).avisos).toEqual([]);
    });
  });

  it('10. vetor de assinatura (o mesmo literal do AvisoRegraTest.kt)', () => {
    const chave = '5f2b0c7e1d9a4b3c8e6f7a2d1c0b9e8f7a6d5c4b3a291807f6e5d4c3b2a19087';
    const path = '/api/v2/avisos?desde=eyJjIjp7ImVtIjoiIiwiaWQiOiIifSwiayI6MCwidCI6MH0&espera=50';
    const hex = createHmac('sha256', Buffer.from(chave, 'hex')).update(signedMessage('GET', path, '1763647391204', ''), 'utf8').digest('hex');
    expect(hex).toBe('6d353d4db61c85d46f04869226735d241e513c7b9b5cb48cf52bba306bed6372');
    expect(encodeCursor({ c: { em: '', id: '' }, k: 0, t: 0 })).toBe('eyJjIjp7ImVtIjoiIiwiaWQiOiIifSwiayI6MCwidCI6MH0');
  });
});
