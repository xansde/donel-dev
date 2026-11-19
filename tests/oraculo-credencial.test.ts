import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileHandler, mobileRequestListener, type MobileResponse } from '../src/main/celular/server';
import { createCelularLocalStore } from '../src/oraculo/celular-local';
import { createCelularV2Handler, signedMessage } from '../src/oraculo/celular-v2';
import { isChatRoute } from '../src/oraculo/celular-frente';
import { avisoLinha, CREDENCIAL_PEDIDOS_FILE, createCredencialHandler, type SshResult, type SshRunner } from '../src/oraculo/credencial';

// t-c441e144 (carta t-6b5092f6) — a caixa de credencial do celular: a senha vai do corpo do pedido direto ao cofre, só
// pelo stdin do ssh. O que não pode acontecer sem o dono ver: a senha num arquivo do Oráculo, num log, numa resposta,
// no argv do filho ou num erro do bw; um item do cofre editado por cima; o mesmo envio guardado duas vezes.

const MARCADOR = `VAZAMENTO-TESTE-${randomUUID()}`;
const KEY = createHash('sha256').update('token-do-aparelho', 'utf8').digest();
const T0 = Date.parse('2026-11-19T15:00:00Z');
const UUID = (n: number): string => `${String(n).padStart(8, '0')}-1111-4222-8333-444455556666`;
const ITEM = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const curto = (senha: string): string => createHash('sha256').update(senha, 'utf8').digest('hex').slice(0, 10);

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

type Modo = 'ok' | 'ja-existe' | 'ssh-caiu' | 'tempo' | 'sessao-vencida' | 'bw-vaza';

function world(initial: Modo = 'ok', runner?: SshRunner) {
  const dir = tmp('oraculo-credencial-');
  const store = createCelularLocalStore(join(dir, 'celular-local.json'), () => T0);
  const logs: string[] = [];
  // Anything the daemon would print goes to the journal: it counts as log too.
  for (const level of ['log', 'error', 'warn', 'info'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')));
  const filhos: Array<{ argv: readonly string[]; stdin: string }> = [];
  const respostas: string[] = [];
  const kicks: string[] = [];
  let modo: Modo = initial;
  const fake: SshRunner = async (argv, stdin) => {
    const senha = Buffer.from(stdin).toString('utf8');
    filhos.push({ argv: [...argv], stdin: senha });
    const result: Record<Modo, SshResult> = {
      ok: { code: 0, stdout: `${JSON.stringify({ id: ITEM, sha256_curto: curto(senha) })}\n` },
      'ja-existe': { code: 0, stdout: '{"erro": "ja-existe"}\n' },
      'ssh-caiu': { code: 255, stdout: '' },
      tempo: { code: null, stdout: '', falhou: 'tempo' },
      'sessao-vencida': { code: 0, stdout: '{"erro": "cofre-indisponivel", "motivo": "sync"}\n' },
      // A bw that echoes what it got: the value, its item, an id made of it.
      'bw-vaza': { code: 1, stdout: `bw falhou: ${senha}\n${JSON.stringify({ id: senha, sha256_curto: senha, erro: senha, motivo: senha })}\n` },
    };
    return result[modo];
  };
  const credencial = createCredencialHandler({ dir, run: runner ?? fake, log: (line) => logs.push(line), now: () => T0 });
  const v2 = createCelularV2Handler({
    verify: (message, signature) => (createHmac('sha256', KEY).update(message, 'utf8').digest('hex') === signature ? { name: 'Donel (Android)' } : null),
    doc: () => null,
    store,
    readProof: async () => ({ kind: 'sumiu' }),
    arvoreFile: join(dir, 'arvore.json'),
    kick: (fila) => kicks.push(fila),
    credencial,
    log: (line) => logs.push(line),
    now: () => T0,
  });
  const record = (response: MobileResponse): MobileResponse => {
    respostas.push(`${response.status} ${JSON.stringify(response.headers)} ${String(response.body)}`);
    return response;
  };
  const sign = (body: string): string => {
    const ts = String(T0);
    return `Donel-HMAC ${ts}.${createHmac('sha256', KEY).update(signedMessage('POST', '/api/v2/credencial', ts, body), 'utf8').digest('hex')}`;
  };
  return {
    dir,
    store,
    logs,
    filhos,
    respostas,
    kicks,
    v2,
    sign,
    set modo(next: Modo) {
      modo = next;
    },
    async enviar(body: string): Promise<{ status: number; body: Record<string, unknown> }> {
      const response = record(await v2({ method: 'POST', url: '/api/v2/credencial', body, authorization: sign(body) }));
      return { status: response.status, body: JSON.parse(String(response.body)) as Record<string, unknown> };
    },
  };
}

type World = ReturnType<typeof world>;

const corpo = (id: string, senha: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id, nome: 'Portal da prefeitura', usuario: 'alexandre', url: 'https://portal.exemplo', senha, ...extra });

function arquivos(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...arquivos(path));
    else out.push(path);
  }
  return out;
}

/** The carta's grep: zero in the Oráculo's directory, the log, the HTTP answers and the child's argv. */
function semVazamento(w: World): void {
  for (const file of arquivos(w.dir)) expect(readFileSync(file).includes(MARCADOR), file).toBe(false);
  expect(w.logs.join('\n')).not.toContain(MARCADOR);
  expect(w.respostas.join('\n')).not.toContain(MARCADOR);
  expect(w.filhos.map((filho) => filho.argv.join(' ')).join('\n')).not.toContain(MARCADOR);
}

describe('caixa de credencial do celular (/api/v2/credencial)', () => {
  it('guarda pelo stdin e só por ele, avisa o Líder e a conversa uma vez; a repetição devolve o mesmo, outra senha no mesmo id é conflito', async () => {
    const w = world();
    const senha = `${MARCADOR}-a`;
    const sucesso = await w.enviar(corpo(UUID(1), senha));
    expect(sucesso).toEqual({ status: 200, body: { ok: true, item_id: ITEM, hash_curto: curto(senha), nova: true } });
    expect(w.filhos).toHaveLength(1);
    expect(w.filhos[0]!.stdin).toBe(senha);
    expect(w.filhos[0]!.argv.slice(0, 6)).toEqual(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T']);
    expect(w.filhos[0]!.argv[6]).toBe('homologacoes-2222');
    expect(w.filhos[0]!.argv[7]).toMatch(/^python3 -I -c '/);
    expect(w.filhos[0]!.argv[7]).toContain("'Portal da prefeitura' 'alexandre' 'https://portal.exemplo' 'guardada pelo celular do dono, 2026-11-19'");
    semVazamento(w);

    const repeticao = await w.enviar(corpo(UUID(1), senha));
    expect(repeticao).toEqual({ status: 200, body: { ok: true, item_id: ITEM, hash_curto: curto(senha), nova: false } });
    expect(w.filhos).toHaveLength(1);
    semVazamento(w);

    const conflito = await w.enviar(corpo(UUID(1), `${MARCADOR}-b`));
    expect(conflito).toEqual({ status: 409, body: { erro: 'conflito' } });
    expect(w.filhos).toHaveLength(1);
    semVazamento(w);

    // The same id twice at once (the phone retried while the vault answered): one item, one line.
    const [x, y] = await Promise.all([w.enviar(corpo(UUID(2), `${MARCADOR}-c`)), w.enviar(corpo(UUID(2), `${MARCADOR}-c`))]);
    expect([x.body.nova, y.body.nova].sort()).toEqual([false, true]);
    expect(w.filhos).toHaveLength(2);
    semVazamento(w);

    const linhas = w.store.conversa(10).map((linha) => linha.texto);
    expect(linhas).toEqual([avisoLinha('Portal da prefeitura', ITEM), avisoLinha('Portal da prefeitura', ITEM)]);
    expect(linhas[0]).toBe(`🔐 Credencial «Portal da prefeitura» guardada no cofre, item ${ITEM}.`);
    expect(w.kicks).toEqual(['chat', 'chat']);
    expect(statSync(join(w.dir, CREDENCIAL_PEDIDOS_FILE)).mode & 0o777).toBe(0o600);
    expect(w.logs.filter((line) => line.startsWith('[credencial]'))).toHaveLength(5);
    expect(w.logs[0]).toBe(`[credencial] 00000001 «Portal da prefeitura» item=${ITEM} hash=${curto(senha)} resultado=guardada`);
  });

  it('nome que já existe no cofre: 409 com a mensagem fixa, nada lembrado nem avisado', async () => {
    const w = world('ja-existe');
    const resposta = await w.enviar(corpo(UUID(3), MARCADOR, { nome: `Banco ${MARCADOR.slice(0, 4)}` }));
    expect(resposta).toEqual({ status: 409, body: { erro: 'ja-existe', mensagem: 'Já existe um item com esse nome no cofre. Use outro nome.' } });
    expect(existsSync(join(w.dir, CREDENCIAL_PEDIDOS_FILE))).toBe(false);
    expect(w.store.conversa(10)).toEqual([]);
    semVazamento(w);
  });

  it('cofre fora (ssh caiu, tempo, sessão do bw vencida): 503 sem nada guardado; o envio seguinte vai ao cofre de novo', async () => {
    const w = world();
    for (const modo of ['ssh-caiu', 'tempo', 'sessao-vencida'] as const) {
      w.modo = modo;
      const resposta = await w.enviar(corpo(UUID(4), MARCADOR));
      expect(resposta).toEqual({ status: 503, body: { erro: 'cofre-indisponivel', mensagem: 'O cofre não respondeu; nada foi guardado. Tente de novo.' } });
      semVazamento(w);
    }
    expect(w.store.conversa(10)).toEqual([]);
    w.modo = 'ok';
    expect((await w.enviar(corpo(UUID(4), MARCADOR))).body.nova).toBe(true);
    expect(w.filhos).toHaveLength(4);
    semVazamento(w);
  });

  it('um erro do bw com o valor dentro não volta na resposta nem no log', async () => {
    const w = world('bw-vaza');
    const resposta = await w.enviar(corpo(UUID(5), MARCADOR));
    expect(resposta.status).toBe(503);
    semVazamento(w);
  });

  it('corpo inválido dá 400 {"erro":"corpo"} sem ecoar nada; acima de 16 KB, 413 na rota e no socket, sem ir ao cofre', async () => {
    const w = world();
    const invalidos = [
      `{"id":"${UUID(6)}","nome":"x","senha":"${MARCADOR}"`,
      corpo('nao-e-uuid', MARCADOR),
      corpo(UUID(6), ''),
      corpo(UUID(6), `${MARCADOR}${'x'.repeat(4000)}`),
      corpo(UUID(6), MARCADOR, { nome: 'n'.repeat(121) }),
      corpo(UUID(6), MARCADOR, { nome: '   ' }),
      corpo(UUID(6), MARCADOR, { usuario: 'u'.repeat(301) }),
      corpo(UUID(6), MARCADOR, { url: 7 }),
      corpo(UUID(6), MARCADOR, { nome: `quebra\n${MARCADOR}` }),
      JSON.stringify([MARCADOR]),
    ];
    for (const body of invalidos) expect(await w.enviar(body)).toEqual({ status: 400, body: { erro: 'corpo' } });
    expect(await w.enviar(corpo(UUID(6), MARCADOR, { lixo: 'y'.repeat(17 * 1024) }))).toEqual({ status: 413, body: { erro: 'grande-demais' } });
    expect(w.filhos).toEqual([]);
    semVazamento(w);

    // The socket: the phone's server reads at most 16 KB of this route and says 413; the entregador answers it itself.
    expect(isChatRoute('/api/v2/credencial')).toBe(true);
    const server = createServer(mobileRequestListener(createMobileHandler({ auth: {} as never, v2: () => w.v2, ledger: () => ({}) as never, assets: {}, provasRoot: null })));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    const post = (body: string): Promise<{ status: number; text: string }> =>
      new Promise((resolve, reject) => {
        const out = httpRequest(
          { host: '127.0.0.1', port, method: 'POST', path: '/api/v2/credencial', headers: { 'x-forwarded-for': '100.64.0.9', 'tailscale-user-login': 'dono@exemplo', authorization: w.sign(body), 'content-type': 'application/json' } },
          (answer) => {
            let text = '';
            answer.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
            answer.on('end', () => resolve({ status: answer.statusCode ?? 0, text }));
          },
        );
        out.once('error', reject);
        out.end(body);
      });
    try {
      const grande = await post(corpo(UUID(7), MARCADOR, { lixo: 'z'.repeat(17 * 1024) }));
      expect(grande).toEqual({ status: 413, text: '{"erro":"grande-demais"}' });
      const certo = await post(corpo(UUID(7), MARCADOR));
      expect(certo.status).toBe(200);
      expect(certo.text).not.toContain(MARCADOR);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
    expect(w.filhos).toHaveLength(1);
    semVazamento(w);
  });

  const temShell = spawnSync('python3', ['--version']).status === 0 && spawnSync('bash', ['--version']).status === 0;
  it.skipIf(!temShell)('o script do cofre só cria: o nome exato já existente é ja-existe, o parecido não; a senha chega inteira e não sai dele', async () => {
    // A bw of mentira: items in cofre/itens.json, a create that prints the whole item (as the real one does), and
    // failures that echo what they got.
    const base = tmp('cofre-falso-');
    const bin = join(base, 'bin');
    const cofre = join(base, 'cofre');
    mkdirSync(bin);
    mkdirSync(cofre);
    writeFileSync(join(cofre, 'itens.json'), JSON.stringify([{ id: '11111111-2222-4333-8444-555555555555', name: 'Portal da prefeitura 2' }]));
    writeFileSync(join(base, 'sessao'), 'BW_SESSION=sessao-de-teste\n');
    writeFileSync(
      join(bin, 'bw'),
      `#!/usr/bin/env python3
import base64, json, os, sys, uuid
cofre = os.environ["FAKE_BW_DIR"]
args = [a for a in sys.argv[1:] if a != "--nointeraction"]
if os.environ.get("BW_SESSION") != "sessao-de-teste" or os.path.exists(os.path.join(cofre, "trancado")):
    sys.stderr.write("Vault is locked."); sys.exit(1)
itens = json.load(open(os.path.join(cofre, "itens.json")))
if args[0] == "sync":
    print("Syncing complete.")
elif args[0] == "list":
    termo = args[2].split("=", 1)[1].lower()
    print(json.dumps([i for i in itens if termo in i["name"].lower()]))
elif args[0] == "get":
    print(json.dumps({"type": 1, "name": "", "notes": None, "login": None, "folderId": None, "favorite": False}))
elif args[0] == "create":
    bruto = sys.stdin.read()
    item = json.loads(base64.b64decode(bruto))
    if os.path.exists(os.path.join(cofre, "falha-criar")):
        sys.stderr.write("erro: " + json.dumps(item)); print("erro: " + json.dumps(item) + " " + bruto); sys.exit(1)
    item["id"] = str(uuid.uuid4())
    itens.append(item)
    json.dump(itens, open(os.path.join(cofre, "itens.json"), "w"))
    print(json.dumps(item))
`,
    );
    chmodSync(join(bin, 'bw'), 0o755);
    const saidas: string[] = [];
    const argvs: string[] = [];
    // The remote command, run here by bash as the Homologações' shell would: what the ssh child would hand it.
    const local: SshRunner = (argv, stdin) =>
      new Promise((resolve) => {
        argvs.push(argv.join(' '));
        const child = spawn('bash', ['-c', argv[argv.length - 1]!], {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, DONEL_BW_SESSION_FILE: join(base, 'sessao'), FAKE_BW_DIR: cofre },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
        child.once('close', (code) => {
          saidas.push(stdout, stderr);
          resolve({ code, stdout });
        });
        child.stdin.end(Buffer.from(stdin));
      });
    const w = world('ok', local);
    const itens = (): Array<Record<string, any>> => JSON.parse(readFileSync(join(cofre, 'itens.json'), 'utf8')) as Array<Record<string, any>>;

    const senha = `${MARCADOR} com 'aspas', $HOME e "duplas"`;
    const criada = await w.enviar(corpo(UUID(8), senha, { nome: "Portal da prefeitura", usuario: "o'neil" }));
    expect(criada.status).toBe(200);
    const nova = itens().find((item) => item.name === 'Portal da prefeitura')!;
    expect(criada.body).toEqual({ ok: true, item_id: nova.id, hash_curto: curto(senha), nova: true });
    expect(nova.login).toEqual({ username: "o'neil", password: senha, uris: [{ match: null, uri: 'https://portal.exemplo' }], totp: null });
    expect(nova.notes).toBe('guardada pelo celular do dono, 2026-11-19');

    const repetido = await w.enviar(corpo(UUID(9), `${MARCADOR}-outra`, { nome: 'Portal da prefeitura' }));
    expect(repetido).toEqual({ status: 409, body: { erro: 'ja-existe', mensagem: 'Já existe um item com esse nome no cofre. Use outro nome.' } });
    expect(itens()).toHaveLength(2);

    writeFileSync(join(cofre, 'falha-criar'), '');
    expect((await w.enviar(corpo(UUID(10), MARCADOR, { nome: 'Outro portal' }))).status).toBe(503);
    rmSync(join(cofre, 'falha-criar'));
    writeFileSync(join(cofre, 'trancado'), '');
    expect((await w.enviar(corpo(UUID(11), MARCADOR, { nome: 'Outro portal' }))).status).toBe(503);
    expect(itens()).toHaveLength(2);

    expect(saidas.join('\n')).not.toContain(MARCADOR);
    expect(argvs).toHaveLength(4);
    expect(argvs.join('\n')).not.toContain(MARCADOR);
    semVazamento(w);
  });
});
