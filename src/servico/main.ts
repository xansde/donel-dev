// Serviço Donel sem tela (ADR 0008 e 0009) — roda em CADA VPS por systemd e
// mantém a conta dela trocando sozinha com o PC desligado. Fatia 1: o motor de
// contas da própria VPS (troca automática a 90%), sem ssh para outra máquina.
//
//   donel-servico rodar                         processo do systemd
//   donel-servico estado                        contas e carga (sem segredo)
//   donel-servico contas colher <pasta> <rótulo>
//   donel-servico contas adotar <rótulo>
//   donel-servico contas trocar <conta>
//   donel-servico contas remover <conta>

import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServicoContas, servicoPathsFor, type ServicoContas } from '../main/accounts/servico/servico-contas';
import { createKeyCipher, loadVaultKey } from '../main/accounts/servico/vault-key-cipher';
import { listenOnSocket, sendToSocket, type SocketRequest } from './socket';

const paths = servicoPathsFor(homedir(), process.env.DONEL_SERVICO_DIR || undefined);
const socketPath = join(paths.dir, 'servico.sock');

async function dispatch(contas: ServicoContas, request: SocketRequest): Promise<unknown> {
  const [a, b] = request.args;
  switch (request.cmd) {
    case 'estado':
      return contas.estado();
    case 'contas.colher':
      return contas.colher(a ?? '', b ?? '');
    case 'contas.adotar':
      return contas.adotar(a ?? '');
    case 'contas.trocar':
      return contas.trocar(a ?? '');
    case 'contas.remover':
      return contas.remover(a ?? '');
    default:
      return { ok: false, reason: 'comando-desconhecido' };
  }
}

async function run(): Promise<void> {
  const { key, source } = loadVaultKey({
    credentialsDirectory: process.env.CREDENTIALS_DIRECTORY,
    keyFilePath: join(paths.dir, 'vault.key'),
    createKeyFileIfMissing: process.env.DONEL_SERVICO_CRIAR_CHAVE === '1',
  });
  if (!key) {
    console.error('[donel-servico] sem chave do cofre (veja docs/servico-vps.md, passo da chave). Saindo.');
    process.exit(2);
  }
  console.log(`[donel-servico] chave do cofre: ${source}`);
  const contas = createServicoContas({ paths, cipher: createKeyCipher(key) });
  await contas.start();
  const server = await listenOnSocket(socketPath, (request) => dispatch(contas, request));
  console.log(`[donel-servico] no ar; socket ${socketPath}`);
  const stop = (): void => {
    contas.dispose();
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

function requestFromArgv(argv: readonly string[]): SocketRequest | null {
  const [group, action, ...rest] = argv;
  if (group === 'estado') return { cmd: 'estado', args: [] };
  if (group === 'contas' && action) return { cmd: `${group}.${action}`, args: rest };
  return null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'rodar') return run();
  const request = requestFromArgv(argv);
  if (!request) {
    console.error('uso: donel-servico rodar | estado | contas colher|adotar|trocar|remover ...');
    process.exit(64);
  }
  try {
    const result = await sendToSocket(socketPath, request);
    console.log(JSON.stringify(result, null, 2));
    process.exit((result as { ok?: unknown }).ok === true ? 0 : 1);
  } catch (error) {
    console.error(`[donel-servico] não falei com o serviço (${error instanceof Error ? error.message : 'erro'}). Ele está rodando? systemctl status donel-servico`);
    process.exit(3);
  }
}

void main();
