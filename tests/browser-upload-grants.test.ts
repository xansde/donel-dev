// Navegador integrado — o orquestrador de cada quadro libera pastas de envio no lugar do dono (pedido do dono, 07/11:
// "receba o poder de liberar as pastas através do orquestrador de cada quadro/projeto"). Anexos do chat saem sem
// pedido; só os ARQUIVOS de segredo seguem recusados. Um furo aqui não aparece usando o app.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findUploadFile } from '../src/main/browser/panel-helpers';
import { createSystemConfigIoDeps, defaultAppConfig, readAppConfig, sanitizeAppConfig, writeAppConfig, type AppConfig } from '../src/main/config-store';
import {
  chatAttachmentsDir,
  refusedUploadFolder,
  secretUploadFile,
  uploadFoldersFor,
  uploadGrantAuthority,
  withUploadGrant,
  withoutUploadGrantFolder,
  type UploadGrant,
} from '../src/shared/browser/upload';

const WIN = { home: 'C:\\Users\\dono', userData: 'C:\\Users\\dono\\AppData\\Roaming\\donel-dev' };

describe('quem libera pasta', () => {
  it('o Líder único libera em qualquer quadro, dizendo qual', () => {
    expect(uploadGrantAuthority({ liderUnico: true }, undefined)).toEqual({ ok: false, reason: expect.stringContaining('quadro') });
    expect(uploadGrantAuthority({ liderUnico: true }, 'Homologação')).toEqual({ ok: true, leaderOfAll: true });
  });

  it('o Líder de um quadro libera só no próprio quadro', () => {
    const dalton = { lugar: 'place:dalton', papel: 'lider', papelNome: 'Líder', nome: 'Dalton', pasta: 'C:\\seazone\\homologacao' };
    expect(uploadGrantAuthority(dalton, undefined)).toEqual({ ok: true, board: 'C:\\seazone\\homologacao', by: 'Líder Dalton (place:dalton)' });
    expect(uploadGrantAuthority(dalton, 'Donel Dev').ok).toBe(false);
  });

  it('Dev, Revisor ou lugar que ainda não está no quadro não liberam', () => {
    expect(uploadGrantAuthority({ lugar: 'place:dev', papel: 'dev', pasta: 'C:\\seazone\\x' }, undefined).ok).toBe(false);
    expect(uploadGrantAuthority({ lugar: 'place:rev', papel: 'revisor', pasta: 'C:\\seazone\\x' }, undefined).ok).toBe(false);
    expect(uploadGrantAuthority({ papel: 'lider', pasta: 'C:\\seazone\\x' }, undefined).ok).toBe(false);
    expect(uploadGrantAuthority({}, undefined).ok).toBe(false);
  });
});

describe('que pastas cada sessão usa', () => {
  const grants: UploadGrant[] = [
    { board: 'C:\\seazone\\homologacao', folder: 'D:\\envios-homolog', by: 'Líder Dalton (place:dalton)', at: '2026-11-07T18:00:00.000Z' },
    { board: 'C:\\seazone\\bizops', folder: 'D:\\envios-bizops', by: 'Líder único', at: '2026-11-07T18:05:00.000Z' },
  ];

  it('a sessão do quadro vê as do dono, os anexos do chat e as liberadas para o quadro dela, não as de outro quadro', () => {
    const folders = uploadFoldersFor({ owner: ['D:\\do-dono'], grants, board: 'c:/seazone/HOMOLOGACAO/', userData: WIN.userData });
    expect(folders).toEqual(['D:\\do-dono', chatAttachmentsDir(WIN.userData), 'D:\\envios-homolog']);
  });

  it('o Líder único vê as liberadas de todos os quadros', () => {
    expect(uploadFoldersFor({ owner: [], grants, board: 'all', userData: WIN.userData })).toEqual([chatAttachmentsDir(WIN.userData), 'D:\\envios-homolog', 'D:\\envios-bizops']);
  });

  it('liberar de novo atualiza quem e quando, sem duplicar; o dono remove a pasta de todos os quadros', () => {
    const again = withUploadGrant(grants, { board: 'c:\\seazone\\homologacao', folder: 'd:/ENVIOS-homolog/', by: 'Líder único', at: '2026-11-07T19:00:00.000Z' });
    expect(again).toHaveLength(2);
    expect(again.find((grant) => grant.folder.toLowerCase().includes('homolog'))).toMatchObject({ by: 'Líder único', at: '2026-11-07T19:00:00.000Z' });
    expect(withoutUploadGrantFolder(again, 'D:\\envios-homolog')).toEqual([grants[1]]);
  });
});

describe('pasta liberável e arquivo de segredo', () => {
  it('a pasta do app e as de configuração podem ser liberadas; a raiz e a casa inteira não', () => {
    expect(refusedUploadFolder(WIN.userData, WIN)).toBeNull();
    expect(refusedUploadFolder(`${WIN.userData}\\chat-attachments`, WIN)).toBeNull();
    expect(refusedUploadFolder('C:\\Users\\dono\\.claude', WIN)).toBeNull();
    expect(refusedUploadFolder('C:\\', WIN)).not.toBeNull();
    expect(refusedUploadFolder('C:\\Users\\dono', WIN)).not.toBeNull();
    expect(refusedUploadFolder('C:\\Users', WIN)).not.toBeNull();
  });

  it('recusa os arquivos de segredo, onde quer que a pasta liberada esteja', () => {
    const secrets = [
      `${WIN.userData}\\config.json`,
      `${WIN.userData}\\accounts-vault.json`,
      `${WIN.userData}\\browser-mcp\\abc.json`,
      `${WIN.userData}\\hook-settings\\abc.json`,
      `${WIN.userData}\\accounts-login-1234\\.credentials.json`,
      `${WIN.userData}\\Partitions\\donel-browser\\Network\\Cookies`,
      `${WIN.userData}\\celular.json`,
      'C:\\Users\\dono\\.claude\\.credentials.json',
      'C:\\Users\\dono\\.claude\\settings.json',
      'C:\\Users\\dono\\.claude.json',
      'C:\\Users\\dono\\.ssh\\known_hosts',
      'C:\\Users\\dono\\.aws\\credentials',
      'C:\\Users\\dono\\.docker\\config.json',
      'C:\\Users\\dono\\.config\\gh\\hosts.yml',
      'C:\\Users\\dono\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data',
      'C:\\Users\\dono\\AppData\\Local\\Google\\Chrome\\User Data\\Local State',
      'D:\\projeto\\.env.production',
      'D:\\projeto\\api-token.txt',
      'D:\\projeto\\client_secret.json',
      'D:\\certificados\\empresa.pfx',
    ];
    for (const path of secrets) expect(secretUploadFile(path, WIN), path).not.toBeNull();
  });

  it('anexo do chat, download e arquivo comum saem', () => {
    const fine = [
      `${WIN.userData}\\chat-attachments\\sessao-1\\print.png`,
      `${WIN.userData}\\browser-downloads\\nota.pdf`,
      'C:\\Users\\dono\\Documents\\envios\\contrato.pdf',
      'C:\\Users\\dono\\.claude\\projects\\x\\relatorio.html',
      'D:\\design\\token-de-cor.png',
    ];
    for (const path of fine) expect(secretUploadFile(path, WIN), path).toBeNull();
  });
});

describe('envio de verdade, com pastas no disco', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('o orquestrador libera uma pasta e a sessão do quadro envia dela; anexo do chat sai sem liberar nada; segredo fica', () => {
    const root = mkdtempSync(join(tmpdir(), 'donel-upload-grant-'));
    dirs.push(root);
    const context = { home: join(root, 'home'), userData: join(root, 'home', 'AppData', 'Roaming', 'donel-dev') };
    const board = join(root, 'seazone', 'homologacao');
    const envios = join(root, 'envios');
    mkdirSync(envios, { recursive: true });
    writeFileSync(join(envios, 'laudo.pdf'), 'pdf');
    mkdirSync(join(chatAttachmentsDir(context.userData), 'sessao-1'), { recursive: true });
    writeFileSync(join(chatAttachmentsDir(context.userData), 'sessao-1', 'print.png'), 'png');
    writeFileSync(join(context.userData, 'config.json'), '{"chave":"x"}');

    const foldersOf = (grants: readonly UploadGrant[]): string[] => uploadFoldersFor({ owner: [], grants, board, userData: context.userData });

    // Before: the folder is not liberated, and the answer points to the orchestrator, never to the owner.
    const before = findUploadFile(foldersOf([]), join(envios, 'laudo.pdf'), context);
    expect(before.ok).toBe(false);
    expect(before.ok ? '' : before.reason).toContain('navegador_liberar_pasta');

    // The Dalton (Líder of the board) liberates it.
    const authority = uploadGrantAuthority({ lugar: 'place:dalton', papel: 'lider', nome: 'Dalton', pasta: board }, undefined);
    expect(authority.ok && 'board' in authority).toBe(true);
    const grants = withUploadGrant([], { board, folder: envios, by: 'Líder Dalton (place:dalton)', at: '2026-11-07T18:00:00.000Z' });
    expect(findUploadFile(foldersOf(grants), join(envios, 'laudo.pdf'), context)).toMatchObject({ ok: true, name: 'laudo.pdf' });

    // Chat attachments: no grant at all.
    expect(findUploadFile(foldersOf([]), join(chatAttachmentsDir(context.userData), 'sessao-1', 'print.png'), context)).toMatchObject({ ok: true, name: 'print.png' });

    // A secret file stays refused even when its folder is liberated.
    const withAppFolder = withUploadGrant(grants, { board, folder: context.userData, by: 'Líder único', at: '2026-11-07T18:10:00.000Z' });
    const secret = findUploadFile(foldersOf(withAppFolder), join(context.userData, 'config.json'), context);
    expect(secret.ok).toBe(false);
  });
});

describe('o registro das liberações na config', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('sobrevive a reiniciar e à escrita de um canal que não conhece a chave; o sanitize só guarda entradas completas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'donel-upload-grants-'));
    dirs.push(dir);
    const path = join(dir, 'config.json');
    const legacy = { projectConfigPath: join(dir, 'project-config.json'), activeProfilePath: join(dir, 'active-profile.json') };
    const io = createSystemConfigIoDeps();
    const defaults = defaultAppConfig(['C:\\projetos']);
    const restart = (): AppConfig => readAppConfig(path, defaults, legacy, io);
    const grant: UploadGrant = { board: 'C:\\seazone\\homologacao', folder: 'D:\\envios', by: 'Líder Dalton (place:dalton)', at: '2026-11-07T18:00:00.000Z' };

    const first = restart();
    expect(first.browserUploadGrants.grants).toEqual([]);
    writeAppConfig(path, { ...first, browserUploadGrants: { grants: [grant] } }, io, first);
    expect(restart().browserUploadGrants.grants).toEqual([grant]);

    const { browserUploadGrants: _unknownToOldChannel, ...oldShape } = restart();
    const oldChannel = { ...oldShape, unknownFields: { browserUploadGrants: { grants: [grant] } } } as unknown as AppConfig;
    writeAppConfig(path, { ...oldChannel, favorites: ['C:\\projetos\\atlas'] }, io, oldChannel);
    expect(restart().browserUploadGrants.grants).toEqual([grant]);

    const read = (value: unknown): readonly UploadGrant[] => sanitizeAppConfig({ browserUploadGrants: value }, defaults).browserUploadGrants.grants;
    expect(read({ grants: [grant, { ...grant, folder: '' }, { board: 'x' }, 3, null] })).toEqual([grant]);
    expect(read('lixo')).toEqual([]);
  });
});
