// Navegador integrado — o orquestrador de cada quadro libera pastas de envio no lugar do dono (pedido do dono, 07/11:
// "receba o poder de liberar as pastas através do orquestrador de cada quadro/projeto"). Anexos do chat saem sem
// pedido; só os ARQUIVOS de segredo seguem recusados. Um furo aqui não aparece usando o app.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findUploadFile } from '../src/main/browser/panel-helpers';
import { AgentBridge, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';
import { addLink, addPlace, emptyMindscapeDoc, setPlaceConversation, type MindscapeDoc } from '../src/shared/mindscape/model';
import { FACTORY_ROLES, LEADER_ROLE_ID } from '../src/shared/roles';
import { createSystemConfigIoDeps, defaultAppConfig, readAppConfig, sanitizeAppConfig, writeAppConfig, type AppConfig } from '../src/main/config-store';
import {
  chatAttachmentsDir,
  refusedUploadFolder,
  secretUploadFile,
  uploadFoldersFor,
  uploadGrantAuthority,
  withUploadGrant,
  withoutUploadGrantFolder,
  type UploadCaller,
  type UploadGrant,
} from '../src/shared/browser/upload';

const WIN = { home: 'C:\\Users\\dono', userData: 'C:\\Users\\dono\\AppData\\Roaming\\donel-dev' };

describe('quem libera pasta', () => {
  it('o Líder único libera em qualquer quadro, dizendo qual', () => {
    expect(uploadGrantAuthority({ liderUnico: true }, undefined)).toEqual({ ok: false, reason: expect.stringContaining('quadro') });
    expect(uploadGrantAuthority({ liderUnico: true }, 'Homologação')).toEqual({ ok: true, leaderOfAll: true });
  });

  it('o orquestrador do quadro libera só no próprio quadro', () => {
    const dalton = { lugar: 'place:dalton', papel: 'lider', papelNome: 'Líder', nome: 'Dalton', pasta: 'C:\\seazone\\homologacao', orquestrador: true };
    expect(uploadGrantAuthority(dalton, undefined)).toEqual({ ok: true, board: 'C:\\seazone\\homologacao', by: 'Líder Dalton (place:dalton)' });
    expect(uploadGrantAuthority(dalton, 'Donel Dev').ok).toBe(false);
  });

  it('o papel sozinho não basta: Dev, Revisor, um Líder que não é o orquestrador ou lugar fora do quadro não liberam', () => {
    expect(uploadGrantAuthority({ lugar: 'place:dev', papel: 'dev', pasta: 'C:\\seazone\\x' }, undefined).ok).toBe(false);
    expect(uploadGrantAuthority({ lugar: 'place:rev', papel: 'revisor', pasta: 'C:\\seazone\\x' }, undefined).ok).toBe(false);
    expect(uploadGrantAuthority({ lugar: 'place:filha', papel: 'lider', papelNome: 'Líder', pasta: 'C:\\seazone\\x', orquestrador: false }, undefined).ok).toBe(false);
    expect(uploadGrantAuthority({ lugar: 'place:filha', papel: 'lider', papelNome: 'Líder', pasta: 'C:\\seazone\\x' }, undefined).ok).toBe(false);
    expect(uploadGrantAuthority({ papel: 'lider', pasta: 'C:\\seazone\\x', orquestrador: true }, undefined).ok).toBe(false);
    expect(uploadGrantAuthority({}, undefined).ok).toBe(false);
  });

  it('o registro não repete o papel quando o nome da sessão é o nome do papel', () => {
    const lider = { lugar: 'place:l', papel: 'lider', papelNome: 'Líder', nome: 'Líder', pasta: 'C:\\seazone\\x', orquestrador: true };
    expect(uploadGrantAuthority(lider, undefined)).toMatchObject({ ok: true, by: 'Líder (place:l)' });
  });
});

// Achado do Revisor no PR #305: um Dev abria uma filha com papel 'lider' e ela liberava a pasta. Com o AgentBridge de
// verdade: quem libera sai da posição no quadro (o Líder que o dono pôs), e nenhuma sessão cria um lugar de Líder.
describe('o orquestrador sai do quadro, não do papel', () => {
  const ATLAS = '/proj/atlas';
  const DALTON = 'place:dalton';
  const DEV = 'place:dev';
  const FILHA = 'place:filha';

  function bridgeOnBoard(): { bridge: AgentBridge; doc: () => MindscapeDoc } {
    let doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: DALTON, roleId: LEADER_ROLE_ID });
    doc = addPlace(doc, ATLAS, { id: DEV, roleId: 'dev' });
    // A Líder a session made before this fix (a doc saved by the old app): on the board, but not the orchestrator.
    doc = addPlace(doc, ATLAS, { id: FILHA, roleId: LEADER_ROLE_ID, by: 'session' });
    doc = addLink(doc, ATLAS, { id: 'l1', from: DALTON, to: DEV, arrow: true });
    doc = addLink(doc, ATLAS, { id: 'l2', from: DEV, to: FILHA, arrow: true, by: 'session', opened: true });
    for (const [place, conv] of [[DALTON, 'conv-dalton'], [DEV, 'conv-dev'], [FILHA, 'conv-filha']] as const) doc = setPlaceConversation(doc, ATLAS, place, conv);
    const tabs: BridgeTab[] = [
      { id: 'tab-dalton', name: 'Dalton', cwd: ATLAS, projectName: 'atlas', claudeSessionId: 'conv-dalton', sessionType: 'claude' },
      { id: 'tab-dev', name: 'Dev', cwd: ATLAS, projectName: 'atlas', claudeSessionId: 'conv-dev', sessionType: 'claude' },
      { id: 'tab-filha', name: 'Líder', cwd: ATLAS, projectName: 'atlas', claudeSessionId: 'conv-filha', openedBy: DEV, sessionType: 'claude' },
      { id: 'tab-unico', name: 'Líder', cwd: '/proj', roleId: LEADER_ROLE_ID, leaderOfAll: true, sessionType: 'claude' },
    ];
    const ports: AgentBridgePorts = {
      loaded: true,
      doc: () => doc,
      applyGesture: (_path, gesture) => {
        doc = gesture(doc);
      },
      tabs: () => tabs,
      tabOfPty: (ptyId) => tabs.find((tab) => tab.id === `tab-${ptyId}`),
      stateOf: () => 'waiting',
      roles: () => FACTORY_ROLES,
      openSession: () => 'tab-new',
      closeTab: () => undefined,
      sendLine: () => undefined,
      deliverLine: async () => ({ kind: 'entrou' }),
      permissionOnScreen: () => false,
      unconfirmed: () => false,
      startTrouble: () => null,
      askOwner: async () => true,
      remoteLabel: (id) => id,
      remotes: () => [],
      projects: () => [{ path: ATLAS, name: 'atlas' }],
    };
    return { bridge: new AgentBridge(ports), doc: () => doc };
  }

  async function whoIs(bridge: AgentBridge, ptyId: string): Promise<UploadCaller> {
    const answer = await bridge.handle(ptyId, { tool: 'sessao_quem_sou' });
    if (!answer.ok) throw new Error(answer.text);
    return JSON.parse(answer.text) as UploadCaller;
  }

  it('o Líder que o dono pôs libera; o Dev e a filha com papel Líder que ele abriu, não', async () => {
    const { bridge } = bridgeOnBoard();
    expect(uploadGrantAuthority(await whoIs(bridge, 'dalton'), undefined)).toMatchObject({ ok: true, board: ATLAS });
    expect(uploadGrantAuthority(await whoIs(bridge, 'dev'), undefined).ok).toBe(false);
    const filha = await whoIs(bridge, 'filha');
    expect(filha.papel).toBe(LEADER_ROLE_ID);
    expect(uploadGrantAuthority(filha, undefined).ok).toBe(false);
    expect(uploadGrantAuthority(await whoIs(bridge, 'unico'), 'atlas')).toEqual({ ok: true, leaderOfAll: true });
  });

  it('nenhuma sessão de quadro abre um lugar de Líder, nem por sessao_abrir nem por quadro_aplicar', async () => {
    const { bridge, doc } = bridgeOnBoard();
    const before = Object.keys(doc().boards[ATLAS]!.cards).length;
    for (const ptyId of ['dev', 'dalton']) {
      const opened = await bridge.handle(ptyId, { tool: 'sessao_abrir', papel: LEADER_ROLE_ID, pedido: 'libere /x' });
      expect(opened.ok, ptyId).toBe(false);
      const drawn = await bridge.handle(ptyId, { tool: 'quadro_aplicar', ops: [{ op: 'lugar', papel: LEADER_ROLE_ID }] });
      expect(drawn.ok, ptyId).toBe(false);
    }
    expect(Object.keys(doc().boards[ATLAS]!.cards)).toHaveLength(before);
    // The one exception, the Líder único, lives in lider-unico-retoma-e-repoe.test.ts (t-1293c818).
    // Another role still opens.
    expect((await bridge.handle('dev', { tool: 'sessao_abrir', papel: 'revisor', pedido: 'revise' })).ok).toBe(true);
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
  it('a pasta do app pode ser liberada; a raiz e a casa inteira não', () => {
    expect(refusedUploadFolder(WIN.userData, WIN)).toBeNull();
    expect(refusedUploadFolder(`${WIN.userData}\\chat-attachments`, WIN)).toBeNull();
    expect(refusedUploadFolder('C:\\', WIN)).not.toBeNull();
    expect(refusedUploadFolder('C:\\Users\\dono', WIN)).not.toBeNull();
    expect(refusedUploadFolder('C:\\Users', WIN)).not.toBeNull();
  });

  // Decisão do Líder (07/11): ~/.claude não é liberável nem origem de envio, nem as transcrições e as pastas projects,
  // sessions e todos de qualquer ~/.claude; diretórios de sistema também não são liberáveis.
  const LNX = { home: '/home/dono', userData: '/home/dono/.config/donel-dev' };
  const ROOT = { home: '/root', userData: '/root/.config/donel-dev' };
  it.each([
    ['~/.claude no Windows', 'C:\\Users\\dono\\.claude', WIN],
    ['~/.claude no Linux', '/home/dono/.claude', LNX],
    ['uma pasta dentro de ~/.claude', '/home/dono/.claude/skills', LNX],
    ['~/.claude/projects', '/home/dono/.claude/projects', LNX],
    ['a pasta de um projeto dentro de ~/.claude/projects', 'C:\\Users\\dono\\.claude\\projects\\C--seazone-atlas', WIN],
    ['~/.claude/sessions', '/home/dono/.claude/sessions', LNX],
    ['~/.claude/todos', '/home/dono/.claude/todos', LNX],
    ['um ~/.claude de perfil antigo', 'C:\\Users\\dono\\.claude-profiles.old\\trabalho', WIN],
    ['projects de um .claude fora da casa (CLAUDE_CONFIG_DIR)', '/opt/contas/.claude/projects', LNX],
    ['sessions de um .claude fora da casa', 'D:\\contas\\.claude-b\\sessions', WIN],
    ['todos de um .claude fora da casa', '/opt/contas/.claude/todos', LNX],
    ['/etc', '/etc', LNX],
    ['uma pasta dentro de /etc', '/etc/ssl', LNX],
    ['/var', '/var', LNX],
    ['uma pasta dentro de /var', '/var/lib/postgresql', LNX],
    ['/root de outro usuário', '/root', LNX],
    ['uma pasta dentro do /root de outro usuário', '/root/seazone', LNX],
    ['/usr', '/usr/local', LNX],
    ['/bin', '/bin', LNX],
    ['/boot', '/boot', LNX],
    ['/proc', '/proc/1', LNX],
    ['/sys', '/sys', LNX],
    ['/sbin', '/sbin', LNX],
    ['/lib', '/lib', LNX],
    ['/dev', '/dev', LNX],
    ['/run', '/run/secrets', LNX],
    ['/etc do macOS depois do realpath', '/private/etc', { home: '/Users/dono', userData: '/Users/dono/Library/Application Support/donel-dev' }],
    ['/var do macOS depois do realpath', '/private/var/db', { home: '/Users/dono', userData: '/Users/dono/Library/Application Support/donel-dev' }],
    ['C:\\Windows', 'C:\\Windows', WIN],
    ['uma pasta dentro de C:\\Windows', 'C:\\Windows\\System32\\config', WIN],
    ['C:\\Program Files', 'C:\\Program Files', WIN],
    ['C:\\Program Files (x86)', 'C:\\Program Files (x86)\\Steam', WIN],
    ['C:\\ProgramData', 'C:\\ProgramData\\ssh', WIN],
  ])('não libera %s', (_what, folder, context) => {
    expect(refusedUploadFolder(folder, context)).not.toBeNull();
  });

  it.each([
    ['um arquivo comum de ~/.claude', 'C:\\Users\\dono\\.claude\\projects\\x\\relatorio.html', WIN],
    ['uma skill em ~/.claude', '/home/dono/.claude/skills/x/SKILL.md', LNX],
    ['uma transcrição', '/home/dono/.claude/projects/-home-dono-atlas/abc.jsonl', LNX],
    ['uma sessão', '/home/dono/.claude/sessions/123.json', LNX],
    ['uma lista de todos', '/home/dono/.claude/todos/abc-agent.json', LNX],
    ['uma transcrição de um .claude fora da casa', '/opt/contas/.claude/projects/-x/abc.jsonl', LNX],
    ['um arquivo de sessions de um .claude fora da casa', 'D:\\contas\\.claude-b\\sessions\\1.json', WIN],
    ['um arquivo de todos de um .claude fora da casa', '/opt/contas/.claude/todos/a.json', LNX],
  ])('não envia %s', (_what, path, context) => {
    expect(secretUploadFile(path, context)).not.toBeNull();
  });

  it('a pasta de trabalho de quem roda como root (a VPS) continua liberável, e o .claude de um repositório também', () => {
    expect(refusedUploadFolder('/root/seazone/atlas', ROOT)).toBeNull();
    expect(refusedUploadFolder('/root', ROOT)).not.toBeNull();
    expect(refusedUploadFolder('/home/dono/seazone/atlas/.claude/worktrees/x', LNX)).toBeNull();
    expect(refusedUploadFolder('/var-projetos/atlas', LNX)).toBeNull();
    expect(refusedUploadFolder('D:\\Windows-backup', WIN)).toBeNull();
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

  // Achado do Revisor no PR #305 e a mesma família: navegadores, nuvem, git, bancos, cofres do sistema, npm e pip.
  const HOME = 'C:\\Users\\dono';
  const LINUX = { home: '/home/dono', userData: '/home/dono/.config/donel-dev' };
  it.each([
    ['cookies do Firefox', `${HOME}\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\ab12.default\\cookies.sqlite`, WIN],
    ['senhas salvas do Firefox', `${HOME}\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\ab12.default\\logins.json`, WIN],
    ['chave que abre as senhas do Firefox', `${HOME}\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\ab12.default\\key4.db`, WIN],
    ['chave antiga do Firefox', '/home/dono/.mozilla/firefox/ab12.default/key3.db', LINUX],
    ['senhas antigas do Firefox', '/home/dono/.mozilla/firefox/ab12.default/signons.sqlite', LINUX],
    ['sessão aberta do Firefox (cookies de sessão)', '/home/dono/.mozilla/firefox/ab12.default/sessionstore.jsonlz4', LINUX],
    ['cópia da sessão do Firefox', '/home/dono/.mozilla/firefox/ab12.default/sessionstore-backups/recovery.jsonlz4', LINUX],
    ['cookies do Edge (perfil novo)', `${HOME}\\AppData\\Local\\Microsoft\\Edge\\User Data\\Profile 1\\Network\\Cookies`, WIN],
    ['senhas do Edge', `${HOME}\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Login Data`, WIN],
    ['chave do Chromium no Linux', '/home/dono/.config/chromium/Local State', LINUX],
    ['cookies de extensão do Chrome', `${HOME}\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Extension Cookies`, WIN],
    ['tokens de login no Local Storage do Chrome', `${HOME}\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Local Storage\\leveldb\\000003.log`, WIN],
    ['tokens no IndexedDB do Edge', `${HOME}\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\IndexedDB\\https_app.slack.com_0.indexeddb.leveldb\\000005.ldb`, WIN],
    ['credencial padrão do gcloud', '/home/dono/.config/gcloud/application_default_credentials.json', LINUX],
    ['tokens do gcloud', `${HOME}\\AppData\\Roaming\\gcloud\\access_tokens.db`, WIN],
    ['credenciais do gcloud', '/home/dono/.config/gcloud/credentials.db', LINUX],
    ['credencial antiga do gcloud em pasta própria', '/home/dono/.config/gcloud/legacy_credentials/dono@x.com/adc.json', LINUX],
    ['config do rclone', '/home/dono/.config/rclone/rclone.conf', LINUX],
    ['git-credentials sem ponto', 'D:\\backup\\git-credentials', WIN],
    ['.git-credentials', '/home/dono/.git-credentials', LINUX],
    ['.netrc', '/home/dono/.netrc', LINUX],
    ['_netrc do Windows', `${HOME}\\_netrc`, WIN],
    ['.pgpass', '/home/dono/.pgpass', LINUX],
    ['pgpass.conf do Windows', `${HOME}\\AppData\\Roaming\\postgresql\\pgpass.conf`, WIN],
    ['.my.cnf do MySQL', '/home/dono/.my.cnf', LINUX],
    ['chaveiro do macOS', '/Users/dono/Library/Keychains/login.keychain-db', { home: '/Users/dono', userData: '/Users/dono/Library/Application Support/donel-dev' }],
    ['chaveiro antigo do macOS', 'D:\\backup\\login.keychain', WIN],
    ['chaveiro do GNOME', '/home/dono/.local/share/keyrings/login.keyring', LINUX],
    ['carteira do KDE', '/home/dono/.local/share/kwalletd/kdewallet.kwl', LINUX],
    ['senhas do pass', '/home/dono/.password-store/banco.gpg', LINUX],
    ['Gerenciador de Credenciais do Windows', `${HOME}\\AppData\\Roaming\\Microsoft\\Credentials\\DFBE70A7E5CC19A398EBF1B96859CE5D`, WIN],
    ['chave mestra do DPAPI', `${HOME}\\AppData\\Roaming\\Microsoft\\Protect\\S-1-5-21-1\\3a6f-uuid`, WIN],
    ['cofre do Windows', `${HOME}\\AppData\\Local\\Microsoft\\Vault\\4BF4C442\\Policy.vpol`, WIN],
    ['token do npm (.npmrc)', 'D:\\projeto\\.npmrc', WIN],
    ['token do yarn', 'D:\\projeto\\.yarnrc.yml', WIN],
    ['config do pip (Linux)', '/home/dono/.config/pip/pip.conf', LINUX],
    ['config do pip (Windows)', `${HOME}\\AppData\\Roaming\\pip\\pip.ini`, WIN],
    ['token do PyPI (.pypirc)', '/home/dono/.pypirc', LINUX],
    ['credencial do Terraform Cloud', '/home/dono/.terraform.d/credentials.tfrc.json', LINUX],
    ['token do Vault', '/home/dono/.vault-token', LINUX],
    ['config do s3cmd', '/home/dono/.s3cfg', LINUX],
    ['config do boto', '/home/dono/.boto', LINUX],
    ['kubeconfig fora do ~/.kube', 'D:\\infra\\kubeconfig', WIN],
    ['senhas do Apache', '/srv/site/.htpasswd', LINUX],
    ['login antigo do Docker', '/home/dono/.dockercfg', LINUX],
  ])('recusa %s', (_what, path, context) => {
    expect(secretUploadFile(path, context)).not.toBeNull();
  });

  it('anexo do chat, download e arquivo comum saem', () => {
    const fine = [
      `${WIN.userData}\\chat-attachments\\sessao-1\\print.png`,
      `${WIN.userData}\\browser-downloads\\nota.pdf`,
      'C:\\Users\\dono\\Documents\\envios\\contrato.pdf',
      'D:\\design\\token-de-cor.png',
      'D:\\projeto\\config.json',
      'D:\\projeto\\package.json',
      'D:\\fotos\\cookies.jpg',
      'D:\\relatorios\\logins-do-mes.pdf',
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
    const authority = uploadGrantAuthority({ lugar: 'place:dalton', papel: 'lider', nome: 'Dalton', pasta: board, orquestrador: true }, undefined);
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
