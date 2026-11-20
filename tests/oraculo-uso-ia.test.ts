import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCelularLocalStore } from '../src/oraculo/celular-local';
import { createCelularV2Handler, signedMessage } from '../src/oraculo/celular-v2';
import { localFlagOn } from '../src/main/local-flags';
import { CRITERIOS, cortesDaPreta, montarUsoIa, proficiencia, semanaDe, semanaInicioMs, USO_IA_FLAG } from '../src/oraculo/uso-ia';

// t-1c683858 — a tela "Uso de IA" do celular. O que quebraria sem o dono perceber: cortes diferentes dos do painel
// (faixa errada com cara de certa), uma conquista gravada que some, uma semana fechada reclassificada por régua nova,
// semana sem leitura zerando a sequência, e a rota respondendo com a flag desligada.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'uso-ia-'));
  dirs.push(dir);
  return dir;
};

const PRETAS_W46 = {
  sessoes_iniciadas: 500, mensagens: 3750, tarefas_operacionais: 428, tarefas_internas: 1150, skills_novas: 13,
  linhas_sistema: 219000, linhas_agente: 69100, cron_jobs: 30, workflows: 589, organizacao: 95,
} as const;

function machine(root: string, day: string, nome: string, semana: string, medido: string, dias: number, valores: Record<string, number>, pretas: Record<string, number> = PRETAS_W46): void {
  mkdirSync(join(root, day), { recursive: true });
  const criterios = Object.entries(valores).map(([criterio, valor]) => ({ criterio, valor, meta_preta_semana: pretas[criterio] }));
  writeFileSync(join(root, day, `maquina-${nome}.json`), JSON.stringify({ maquina: nome, semana, medido_em: medido, inicio_semana: '', dias_fechados: dias, criterios }));
}

function painel(root: string, semana: string, stamp: string, atualizado: string, valores: Record<string, number>, dias = 7): void {
  mkdirSync(join(root, 'painel'), { recursive: true });
  writeFileSync(join(root, 'painel', `${semana}-${stamp}.json`), JSON.stringify({ semana, atualizado_em: atualizado, fonte: 'painel', valores, dias_com_envio: dias }));
}

const all = (v: number): Record<string, number> => Object.fromEntries(CRITERIOS.map((c) => [c, c === 'organizacao' ? Math.min(v, 99) : v]));
/** A value at exactly the given belt of the W46 cuts for every criterion. */
const atBelt = (i: number): Record<string, number> => Object.fromEntries(CRITERIOS.map((c) => [c, cortesDaPreta(c, PRETAS_W46[c])![i]!]));

describe('uso de IA no celular', () => {
  it('os cortes batem com os da W46 do painel', () => {
    expect(cortesDaPreta('sessoes_iniciadas', 500)).toEqual([21, 36, 61, 103, 174, 295, 500]);
    expect(cortesDaPreta('workflows', 589)).toEqual([0, 1, 4, 13, 46, 165, 589]);
    expect(cortesDaPreta('organizacao', 95)).toEqual([61, 67, 73, 78, 84, 90, 95]);
    expect(cortesDaPreta('linhas_sistema', 219000)).toEqual([0, 1, 12, 137, 1601, 18723, 219000]);
    expect(semanaInicioMs('2026-W47')).toBe(Date.parse('2026-11-13T17:00:00-03:00'));
    expect(semanaDe(Date.parse('2026-11-13T16:59:00-03:00'))).toBe('2026-W46');
    expect(semanaDe(Date.parse('2026-11-13T17:00:00-03:00'))).toBe('2026-W47');
  });

  it('semana sem leitura não conta nem quebra a sequência', () => {
    expect(proficiencia([4, null, 4]).nivel).toBe(1);
    expect(proficiencia([4, 3, 4]).nivel).toBe(0);
    // Mestre pede 4 Pretas seguidas; o buraco no meio não zera.
    expect(proficiencia([6, 6, null, null, 6, 6]).nivel).toBe(3);
  });

  it('feito gravado nunca some e semana congelada não é reescrita', () => {
    const root = tmp();
    const estado = join(tmp(), 'estado');
    const now = Date.parse('2026-11-25T12:00:00-03:00'); // W48 em andamento: W46 e W47 fechadas
    // W46 e W47 em Roxa no total: Treinado em todas as perícias, na W47.
    machine(root, '2026-11-13', 'vps-alexandrelentz', '2026-W46', '2026-11-13T15:35:00-03:00', 6, all(1));
    painel(root, '2026-W46', '20261113T1835', '2026-11-13T18:35:00-03:00', atBelt(4));
    painel(root, '2026-W47', '20261120T1835', '2026-11-20T18:35:00-03:00', atBelt(4));
    // Um feito antigo que o cálculo de hoje não daria (Expert em sessões).
    mkdirSync(estado, { recursive: true });
    const antigo = { criterio: 'sessoes_iniciadas', nivel: 2, semana: '2026-W40', em: '2026-10-03T00:00:00.000Z' };
    writeFileSync(join(estado, 'feitos.json'), JSON.stringify([antigo]));

    const first = montarUsoIa({ dir: root, estado }, now) as any;
    expect(first.proficiencia.mensagens.nivel).toBe(1);
    expect(first.proficiencia.sessoes_iniciadas.nivel).toBe(2);
    expect(first.feitos.some((f: any) => f.criterio === 'mensagens' && f.nivel === 1 && f.semana === '2026-W47')).toBe(true);
    const fechadas = JSON.parse(readFileSync(join(estado, 'fechadas.json'), 'utf8'));
    expect(fechadas['2026-W46'].mensagens).toBe(4);

    // Régua nova e valor novo da W46: a semana fechada fica como foi congelada, e o feito antigo segue lá.
    painel(root, '2026-W46', '20261114T0900', '2026-11-14T09:00:00-03:00', atBelt(0));
    const second = montarUsoIa({ dir: root, estado }, now + 60_000) as any;
    expect(JSON.parse(readFileSync(join(estado, 'fechadas.json'), 'utf8'))).toEqual(fechadas);
    expect(second.proficiencia.mensagens.historico.map((h: any) => h.faixa)).toEqual([4, 4]);
    const gravados = JSON.parse(readFileSync(join(estado, 'feitos.json'), 'utf8'));
    expect(gravados[0]).toEqual(antigo);
    expect(gravados.filter((f: any) => f.criterio === 'mensagens')).toHaveLength(1);
    expect(second.feitos.find((f: any) => f.criterio === 'mensagens').em).toBe(first.feitos.find((f: any) => f.criterio === 'mensagens').em);
  });

  it('a rota só responde com a flag ligada e lê as pastas de verdade', async () => {
    const home = tmp();
    const root = join(home, 'faixa-preta-dia');
    const estado = join(home, 'uso-ia');
    const T0 = Date.parse('2026-11-20T15:00:00-03:00');
    machine(root, '2026-11-20', 'vps-alexandrelentz', '2026-W47', '2026-11-20T13:35:00-03:00', 6, { sessoes_iniciadas: 504, mensagens: 5102 });
    machine(root, '2026-11-14-p2156', 'vps-alexandrelentz', '2026-W47', '2026-11-21T00:00:00-03:00', 6, { sessoes_iniciadas: 1 });
    machine(root, '2026-11-20', 'vps-time-homologacoes', '2026-W47', '2026-11-20T13:35:00-03:00', 6, all(1));
    mkdirSync(join(root, '2026-11-19'), { recursive: true });
    writeFileSync(join(root, '2026-11-19', 'maquina-vps-time-homologacoes.json'), '{ quebrado');
    painel(root, '2026-W46', '20261113T1835', '2026-11-13T18:35:00-03:00', atBelt(6));
    const KEY = createHash('sha256').update('token', 'utf8').digest();
    const h = createCelularV2Handler({
      verify: (message, signature) => (createHmac('sha256', KEY).update(message, 'utf8').digest('hex') === signature ? { name: 'x' } : null),
      doc: () => null,
      store: createCelularLocalStore(join(home, 'celular-local.json'), () => T0),
      readProof: async () => ({ kind: 'sumiu' }),
      arvoreFile: join(home, 'arvore.json'),
      usoIa: { dir: root, estado, flagOn: () => localFlagOn(USO_IA_FLAG, home) },
      now: () => T0,
    });
    const call = (authorized = true) => {
      const ts = String(T0);
      const sig = createHmac('sha256', KEY).update(signedMessage('GET', '/api/v2/uso-ia', ts, ''), 'utf8').digest('hex');
      return h({ method: 'GET', url: '/api/v2/uso-ia', body: '', ...(authorized ? { authorization: `Donel-HMAC ${ts}.${sig}` } : {}) });
    };

    const off = await call();
    expect(off.status).toBe(404);
    expect(JSON.parse(String(off.body))).toEqual({ erro: 'desligada' });
    expect(existsSync(estado)).toBe(false);

    mkdirSync(join(home, '.donel', 'flags'), { recursive: true });
    writeFileSync(join(home, '.donel', 'flags', USO_IA_FLAG), '');
    expect((await call(false)).status).toBe(401);
    const on = await call();
    expect(on.status).toBe(200);
    const body = JSON.parse(String(on.body));
    expect(body.maquinas.map((m: any) => m.id)).toEqual(['todas', 'pc', 'vps', 'homolog']);
    expect(body.semanas.map((s: any) => s.semana)).toEqual(['2026-W47', '2026-W46']);
    const w47 = body.semanas[0];
    expect(w47.fechada).toBe(false);
    expect(w47.inicio).toBe('2026-11-13T17:00:00-03:00');
    // A pasta "-p2156" não é lida (o medido_em dela seria o mais novo).
    expect(w47.leituras.vps.valores).toEqual({ sessoes_iniciadas: 504, mensagens: 5102 });
    expect(w47.leituras.vps.cortes_ate_hoje.sessoes_iniciadas).toEqual([18, 31, 53, 89, 150, 253, 429]);
    expect(w47.leituras.vps.faixas.sessoes_iniciadas).toBe(6);
    expect(w47.leituras.vps.faixa_geral).toBeNull();
    expect(body.semanas[1].leituras.todas.faixa_geral).toBe(6);
    expect(body.proficiencia.workflows.historico).toEqual([{ semana: '2026-W46', rotulo: 'W46', faixa: 6 }]);
  });
});
