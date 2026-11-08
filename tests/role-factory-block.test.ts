import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRolesStore } from '../src/main/roles-store';
import { factoryRole, FACTORY_ROLES, LEADER_ROLE_ID } from '../src/shared/roles';
import { ROLE_FACTORY_HISTORY } from '../src/shared/roleFactoryHistory';

// Papel de fábrica editado (dono, 08/11: "Papel editado: bloco de fábrica separado"). The file in `papeis/` holds the
// factory text of the day it was saved plus the owner's lines; the session must get the CURRENT factory text and only
// the owner's lines as a complement — and the file, shared by every channel, is never rewritten by a read.

const OWNER_LINE = '- Sempre responda em tópicos curtos.';
/** The Dev guidance as the factory shipped it on 03/11 (4669c0e), the day the factory roles were born. */
const OLD_DEV_GUIDANCE = [
  'Você faz a mudança pedida, do começo ao fim, e pede revisão.',
  '',
  '- Antes de mexer, entenda o efeito que o dono quer e onde ele aparece. Se o pedido estiver ambíguo, pergunte uma vez, com uma recomendação.',
  '- Faça a menor mudança que entrega esse efeito. Siga o jeito do projeto (CLAUDE.md, AGENTS.md, README, testes existentes).',
  '- Rode a verificação que o projeto usa (tipos, testes, build) antes de dizer que terminou, e diga o que rodou.',
  '- Ao terminar, peça revisão: diga o que mudou, por que, como conferir e o que ficou de fora. Você não aprova o próprio trabalho.',
].join('\n');
const OLD_CHANGED_LINE = '- Rode a verificação que o projeto usa (tipos, testes, build) antes de dizer que terminou, e diga o que rodou.';
const OWNER_HEADING = 'Orientação do dono para este papel (complementa a de fábrica):';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function userDataWith(id: string, file: string): { userData: string; path: string } {
  const userData = mkdtempSync(join(tmpdir(), 'donel-role-factory-'));
  dirs.push(userData);
  mkdirSync(join(userData, 'papeis'));
  const path = join(userData, 'papeis', `${id}.md`);
  writeFileSync(path, file, 'utf8');
  return { userData, path };
}

function promptOf(userData: string, id: string, options?: { readonly leaderOfAll?: boolean }): string {
  const promptPath = createRolesStore(userData).promptFileFor(id, options);
  expect(promptPath).not.toBeNull();
  return readFileSync(promptPath!, 'utf8');
}

describe('papel de fábrica editado: bloco de fábrica atual + só a parte do dono', () => {
  it('arquivo de uma versão antiga + uma linha do dono: fábrica atual inteira, a linha do dono uma vez, a linha antiga some', () => {
    const { userData } = userDataWith('dev', `---\nnome: Dev\ncor: implementar\n---\n${OLD_DEV_GUIDANCE}\n${OWNER_LINE}\n`);
    const text = promptOf(userData, 'dev');
    expect(text).toContain(factoryRole('dev')!.guidance);
    expect(text.split(OWNER_LINE).length - 1).toBe(1);
    expect(text).toContain(OWNER_HEADING);
    expect(text).not.toContain(OLD_CHANGED_LINE);
  });

  it('arquivo igual à fábrica atual: sem bloco do dono', () => {
    const { userData } = userDataWith('revisor', `---\nnome: Revisor\ncor: validar\n---\n${factoryRole('revisor')!.guidance}\n`);
    const text = promptOf(userData, 'revisor');
    expect(text).toContain(factoryRole('revisor')!.guidance);
    expect(text).not.toContain(OWNER_HEADING);
  });

  it('papel criado pelo dono: a orientação dele inteira, como antes', () => {
    const guidance = 'Você escreve o changelog.\n\n- Uma linha por mudança.';
    const { userData } = userDataWith('redator', `---\nnome: Redator\ncor: documentar\n---\n${guidance}\n`);
    expect(promptOf(userData, 'redator')).toBe(
      [
        'Você é Redator nesta sessão, aberta pelo Donel Dev num lugar do quadro do projeto.',
        'O papel é fixo neste lugar. Se o trabalho pedir outro papel, diga isso ao dono e sugira passar a parte a uma sessão com esse papel, em vez de mudar o seu.',
        '',
        `${guidance}\n`,
      ].join('\n'),
    );
  });

  it('Líder único com o Líder editado: só a linha do dono entra como complemento', () => {
    const lider = factoryRole(LEADER_ROLE_ID)!.guidance;
    const { userData } = userDataWith(LEADER_ROLE_ID, `---\nnome: Líder\ncor: plano\n---\n${lider}\n${OWNER_LINE}\n`);
    const text = promptOf(userData, LEADER_ROLE_ID, { leaderOfAll: true });
    expect(text).toContain(OWNER_LINE);
    expect(text).not.toContain(lider.split('\n')[0]!);
  });

  it('ler o papel para a sessão nunca reescreve o arquivo em papeis/', () => {
    const file = `---\nnome: Dev\ncor: implementar\n---\n${OLD_DEV_GUIDANCE}\n${OWNER_LINE}\n`;
    const { userData, path } = userDataWith('dev', file);
    const before = readFileSync(path);
    promptOf(userData, 'dev');
    createRolesStore(userData).list();
    expect(readFileSync(path).equals(before)).toBe(true);
    // And the editor still gets the whole file text, which is what it saves back.
    expect(createRolesStore(userData).get('dev')!.guidance).toBe(`${OLD_DEV_GUIDANCE}\n${OWNER_LINE}`);
  });

  it('toda linha atual de fábrica está no histórico (mudou a orientação de fábrica? acrescente as linhas novas lá)', () => {
    const norm = (line: string): string => line.trim().replace(/\s+/g, ' ');
    for (const role of FACTORY_ROLES) {
      const history = new Set(ROLE_FACTORY_HISTORY[role.id] ?? []);
      for (const line of role.guidance.split('\n').map(norm).filter(Boolean)) expect(history, `${role.id}: ${line}`).toContain(line);
    }
  });
});
