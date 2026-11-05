import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createOraculoHandler, readTokenHash, rotateToken } from '../src/servico/oraculo/api';
import { importLedger } from '../src/servico/oraculo/importar';

// Oráculo na VPS (demanda donel-vps, fatia 02): o que quebraria sem o dono
// perceber — tarefa, evento ou prova perdidos na migração do PC, Oráculo da VPS
// atropelado, ou a API aberta sem token.

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a6b10000000049454e44ae426082', 'hex');

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

async function pcLedgerWithDelivery(root: string): Promise<string> {
  const file = join(root, 'pc', 'ledger.json');
  const service = createLedgerService({ filePath: file, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs });
  const created = service.apply({ kind: 'lugar', placeId: 'lider' }, { op: 'criar', projectPath: '/p/atlas', request: 'fazer X', doneWhen: 'X feito', due: '2026-11-06', ownerPlaceId: 'dev', risk: 'baixo' });
  if (!created.ok) throw new Error(created.reason);
  service.apply({ kind: 'lugar', placeId: 'dev' }, { op: 'assumir', id: created.task.id });
  const shot = join(root, 'print.png');
  writeFileSync(shot, PNG);
  const proof = await service.importProof({ tipo: 'arquivo', caminho: shot });
  if ('error' in proof) throw new Error(proof.error);
  const delivered = service.apply({ kind: 'lugar', placeId: 'dev' }, { op: 'entregar', id: created.task.id, proofs: [proof, { kind: 'texto', text: 'npm run verify ok' }] });
  if (!delivered.ok) throw new Error(delivered.reason);
  return file;
}

describe('Oráculo na VPS', () => {
  it('a importação do PC leva todas as tarefas, eventos e provas, e não atropela um Oráculo com tarefas', async () => {
    dir = mkdtempSync(join(tmpdir(), 'donel-oraculo-'));
    const source = await pcLedgerWithDelivery(dir);
    const target = join(dir, 'vps', 'ledger.json');

    const first = importLedger({ sourceFile: source, sourceProofsDir: ledgerProofsDir(source), targetFile: target, targetProofsDir: ledgerProofsDir(target), replace: false });
    expect(first).toMatchObject({ ok: true, tarefas: 1, eventos: 3, provas: 1 });
    const vps = createLedgerService({ filePath: target, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs });
    const task = Object.values(vps.load().doc.tasks)[0];
    expect(task.state).toBe('entregue');
    const file = task.events.flatMap((event) => ('proofs' in event && event.proofs) || []).find((proof) => proof.kind === 'arquivo');
    expect(file && vps.proofPath(file) && readFileSync(vps.proofPath(file)!)).toEqual(PNG);

    // Segunda importação: o Oráculo da VPS já tem tarefa; só com --substituir, e com cópia de segurança.
    expect(importLedger({ sourceFile: source, sourceProofsDir: ledgerProofsDir(source), targetFile: target, targetProofsDir: ledgerProofsDir(target), replace: false })).toMatchObject({ ok: false, reason: 'oraculo-da-vps-nao-esta-vazio' });
    const replaced = importLedger({ sourceFile: source, sourceProofsDir: ledgerProofsDir(source), targetFile: target, targetProofsDir: ledgerProofsDir(target), replace: true });
    expect(replaced.ok && replaced.copiaDeSeguranca && existsSync(replaced.copiaDeSeguranca)).toBeTruthy();

    // Uma tarefa que o parse descartaria trava a importação inteira.
    const broken = JSON.parse(readFileSync(source, 'utf8')) as { tasks: Record<string, unknown> };
    broken.tasks['quebrada'] = { id: 'quebrada' };
    const brokenFile = join(dir, 'quebrado.json');
    writeFileSync(brokenFile, JSON.stringify(broken));
    expect(importLedger({ sourceFile: brokenFile, sourceProofsDir: ledgerProofsDir(source), targetFile: join(dir, 'outra', 'ledger.json'), targetProofsDir: join(dir, 'outra', 'p'), replace: false })).toMatchObject({ ok: false, reason: 'tarefas-que-se-perderiam' });
  });

  it('a API recusa sem o token e, com ele, escreve no Oráculo da VPS', async () => {
    dir = mkdtempSync(join(tmpdir(), 'donel-oraculo-'));
    const tokenFile = join(dir, 'oraculo.json');
    const token = rotateToken(tokenFile);
    expect(readFileSync(tokenFile, 'utf8')).not.toContain(token);
    const service = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs });
    const handle = createOraculoHandler({ service, tokenHash: () => readTokenHash(tokenFile), attachmentsDir: join(dir, 'anexos') });
    const op = { actor: { kind: 'lugar', placeId: 'lider' }, op: { op: 'criar', projectPath: '/p/atlas', request: 'r', doneWhen: 'd', due: '2026-11-06', ownerPlaceId: 'dev', risk: 'baixo' } };
    const body = Buffer.from(JSON.stringify(op));

    expect((await handle({ method: 'POST', url: '/v1/oraculo/aplicar', authorization: undefined, body })).status).toBe(401);
    expect((await handle({ method: 'POST', url: '/v1/oraculo/aplicar', authorization: 'Bearer outro', body })).status).toBe(401);
    expect(Object.keys(service.load().doc.tasks)).toHaveLength(0);

    const ok = await handle({ method: 'POST', url: '/v1/oraculo/aplicar', authorization: `Bearer ${token}`, body });
    expect(ok.json).toMatchObject({ ok: true });
    const read = await handle({ method: 'GET', url: '/v1/oraculo', authorization: `Bearer ${token}`, body: Buffer.alloc(0) });
    expect(Object.keys((read.json as { doc: { tasks: object } }).doc.tasks)).toHaveLength(1);
  });
});
