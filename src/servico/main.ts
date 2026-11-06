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
//   donel-servico oraculo token                 gera o token do Oráculo (o PC usa como cliente)
//   donel-servico oraculo importar <ledger.json> <pasta-provas> [--substituir]
//
// O Oráculo é um só e mora na VPS pessoal (fatia 02); o motor de contas é um
// por VPS (ADR 0009).

import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createServicoContas, servicoPathsFor, type ServicoContas } from '../main/accounts/servico/servico-contas';
import { createKeyCipher, loadVaultKey } from '../main/accounts/servico/vault-key-cipher';
import { createSystemConfigIoDeps } from '../main/config-store';
import { pickTailscaleAddress } from '../main/celular/tailscale';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs, type LedgerService } from '../main/ledger-store';
import { createOraculoHandler, ORACULO_PORT, readTokenHash, rotateToken, startOraculoServer } from './oraculo/api';
import { importLedger } from './oraculo/importar';
import { listenOnSocket, sendToSocket, type SocketRequest } from './socket';

const paths = servicoPathsFor(homedir(), process.env.DONEL_SERVICO_DIR || undefined);
const socketPath = join(paths.dir, 'servico.sock');
const ledgerFile = join(paths.dir, 'ledger.json');
const oraculoTokenFile = join(paths.dir, 'oraculo.json');

interface Oraculo {
  readonly service: LedgerService;
  address: string | null;
}

function oraculoEstado(oraculo: Oraculo): Record<string, unknown> {
  try {
    const snapshot = oraculo.service.load();
    return { tarefas: Object.keys(snapshot.doc.tasks).length, somenteLeitura: snapshot.readOnly, endereco: oraculo.address ? `http://${oraculo.address}:${ORACULO_PORT}` : null, token: readTokenHash(oraculoTokenFile) !== null };
  } catch {
    return { erro: 'oraculo-ilegivel' };
  }
}

async function dispatch(contas: ServicoContas, oraculo: Oraculo, request: SocketRequest): Promise<unknown> {
  const [a, b] = request.args;
  switch (request.cmd) {
    case 'estado':
      return { ...(await contas.estado()), oraculo: oraculoEstado(oraculo) };
    case 'oraculo.importar':
      // Roda dentro do processo do serviço: nenhuma escrita do Oráculo corre ao mesmo tempo.
      return importLedger({
        sourceFile: a ?? '',
        sourceProofsDir: b && b !== '--substituir' ? b : null,
        targetFile: ledgerFile,
        targetProofsDir: ledgerProofsDir(ledgerFile),
        replace: request.args.includes('--substituir'),
      });
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
  const oraculo: Oraculo = { service: createLedgerService({ filePath: ledgerFile, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs }), address: null };
  const oraculoServer = await startOraculoApi(oraculo);
  const server = await listenOnSocket(socketPath, (request) => dispatch(contas, oraculo, request));
  console.log(`[donel-servico] no ar; socket ${socketPath}`);
  const stop = (): void => {
    contas.dispose();
    server.close();
    oraculoServer?.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

/** Só no endereço Tailscale. Sem Tailscale no ar, o Oráculo segue local (socket) e o PC não alcança; o systemd reinicia e tenta de novo. */
async function startOraculoApi(oraculo: Oraculo): Promise<import('node:http').Server | null> {
  const address = pickTailscaleAddress(networkInterfaces());
  if (!address) {
    console.error('[donel-servico] sem endereço Tailscale: a API do Oráculo não subiu.');
    return null;
  }
  const handler = createOraculoHandler({ service: oraculo.service, tokenHash: () => readTokenHash(oraculoTokenFile), attachmentsDir: join(paths.dir, 'oraculo-anexos') });
  try {
    const server = await startOraculoServer({ address, handler });
    oraculo.address = address;
    console.log(`[donel-servico] Oráculo em http://${address}:${ORACULO_PORT}`);
    return server;
  } catch (error) {
    console.error(`[donel-servico] a API do Oráculo não subiu (${error instanceof Error ? error.message : 'erro'}).`);
    return null;
  }
}

function requestFromArgv(argv: readonly string[]): SocketRequest | null {
  const [group, action, ...rest] = argv;
  if (group === 'estado') return { cmd: 'estado', args: [] };
  if ((group === 'contas' || group === 'oraculo') && action) return { cmd: `${group}.${action}`, args: rest };
  return null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'rodar') return run();
  if (argv[0] === 'oraculo' && argv[1] === 'token') {
    // O token sai UMA vez, só neste terminal; do lado do serviço fica o hash. Rodar de novo invalida o anterior.
    console.log(rotateToken(oraculoTokenFile));
    return;
  }
  const request = requestFromArgv(argv);
  if (!request) {
    console.error('uso: donel-servico rodar | estado | contas colher|adotar|trocar|remover ... | oraculo token|importar ...');
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
