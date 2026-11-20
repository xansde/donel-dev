import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCelularLocalStore } from '../src/oraculo/celular-local';
import { createCelularV2Handler, signedMessage } from '../src/oraculo/celular-v2';
import { localFlagOn } from '../src/main/local-flags';
import { HOMOLOGACAO_FLAG } from '../src/oraculo/homologacao';

// t-b3f48bf5 — a tela de homologação do celular. O que quebraria sem o dono perceber: a rota respondendo com a flag
// desligada, lendo outro arquivo que não a cópia limpa (por parâmetro), acrescentando campo ao que a cópia diz, e a
// cópia velha ou ausente chegando ao app como se fosse de agora.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'homologacao-'));
  dirs.push(dir);
  return dir;
};

const T0 = Date.parse('2026-11-20T19:30:00-03:00');
const KEY = createHash('sha256').update('token', 'utf8').digest();

function setup() {
  const home = tmp();
  const pasta = join(home, '.donel', 'homologacao');
  mkdirSync(pasta, { recursive: true });
  const file = join(pasta, 'export.json');
  const h = createCelularV2Handler({
    verify: (message, signature) => (createHmac('sha256', KEY).update(message, 'utf8').digest('hex') === signature ? { name: 'x' } : null),
    doc: () => null,
    store: createCelularLocalStore(join(home, 'celular-local.json'), () => T0),
    readProof: async () => ({ kind: 'sumiu' }),
    arvoreFile: join(home, 'arvore.json'),
    homologacao: { file, flagOn: () => localFlagOn(HOMOLOGACAO_FLAG, home) },
    now: () => T0,
  });
  const call = (url = '/api/v2/homologacao', authorized = true) => {
    const ts = String(T0);
    const sig = createHmac('sha256', KEY).update(signedMessage('GET', url, ts, ''), 'utf8').digest('hex');
    return h({ method: 'GET', url, body: '', ...(authorized ? { authorization: `Donel-HMAC ${ts}.${sig}` } : {}) });
  };
  const ligar = () => {
    mkdirSync(join(home, '.donel', 'flags'), { recursive: true });
    writeFileSync(join(home, '.donel', 'flags', HOMOLOGACAO_FLAG), '');
  };
  return { home, pasta, file, call, ligar };
}

const copia = (lidoEm: string, extra: Record<string, unknown> = {}) => ({
  formato: 'homologacao-painel@1',
  lidoEm,
  placar: { comSelo: 29, semSelo: 34 },
  travados: [{ app: 'CS Proprietários', tipo: 'outro-laco', quem: 'Homologador', motivo: 'selo MVP manual' }],
  ...extra,
});

describe('homologação no celular', () => {
  it('sem a flag a rota responde 404 desligada, mesmo com a cópia no lugar', async () => {
    const { file, call } = setup();
    writeFileSync(file, JSON.stringify(copia('2026-11-20T19:25:00-03:00')));
    const off = await call();
    expect(off.status).toBe(404);
    expect(JSON.parse(String(off.body))).toEqual({ erro: 'desligada' });
  });

  it('com a flag: assinatura exigida, 404 sem a cópia e 503 com cópia quebrada', async () => {
    const { file, call, ligar } = setup();
    ligar();
    expect((await call('/api/v2/homologacao', false)).status).toBe(401);
    const sem = await call();
    expect(sem.status).toBe(404);
    expect(JSON.parse(String(sem.body)).erro).toBe('sem-copia');
    writeFileSync(file, '{ quebrado');
    const quebrada = await call();
    expect(quebrada.status).toBe(503);
    expect(JSON.parse(String(quebrada.body)).erro).toBe('copia-invalida');
    writeFileSync(file, JSON.stringify({ formato: 'outro@9', lidoEm: '2026-11-20T19:25:00-03:00' }));
    expect((await call()).status).toBe(503);
  });

  it('devolve a cópia como está, sem acrescentar nada, e nunca lê outro arquivo por parâmetro', async () => {
    const { pasta, file, call, ligar } = setup();
    ligar();
    // Uma cópia "suja" (a limpeza é do cron): a rota não tira nem põe nada.
    const suja = copia('2026-11-20T19:25:00-03:00', { nota: 'x@seazone.com.br' });
    writeFileSync(file, JSON.stringify(suja));
    writeFileSync(join(pasta, 'segredo.json'), JSON.stringify({ formato: 'homologacao-painel@1', lidoEm: '2026-11-20T19:25:00-03:00', senha: 'NAO-PODE-SAIR' }));
    const on = await call();
    expect(on.status).toBe(200);
    const body = JSON.parse(String(on.body));
    expect(Object.keys(body).sort()).toEqual(['dados', 'idadeMin', 'lidoEm', 'velho']);
    expect(body).toEqual({ lidoEm: '2026-11-20T19:25:00-03:00', idadeMin: 5, velho: false, dados: suja });
    for (const url of ['/api/v2/homologacao?arquivo=segredo.json', '/api/v2/homologacao?file=../homologacao/segredo.json', '/api/v2/homologacao?path=' + encodeURIComponent(join(pasta, 'segredo.json'))]) {
      const r = await call(url);
      expect(r.status).toBe(200);
      expect(String(r.body)).not.toContain('NAO-PODE-SAIR');
      expect(JSON.parse(String(r.body))).toEqual(body);
    }
  });

  it('cópia com mais de 60 min chega marcada velha', async () => {
    const { file, call, ligar } = setup();
    ligar();
    writeFileSync(file, JSON.stringify(copia('2026-11-20T18:00:00-03:00')));
    const body = JSON.parse(String((await call()).body));
    expect(body.idadeMin).toBe(90);
    expect(body.velho).toBe(true);
  });
});
