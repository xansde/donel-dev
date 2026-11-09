#!/usr/bin/env node
// F6 do ledger bom (docs/planos/ledger-bom.md) — the `livro` command that crons, workflows and bots use to read and
// append to the journal on the Oráculo daemon (route `/v1/livro`, src/oraculo/livro.ts), with a service credential
// (`scripts/oraculo-vps.sh servico <nome>`). Plain Node, no dependency: `scripts/oraculo-vps.sh` copies it next to the
// daemon as `~/.donel/oraculo/bin/livro.mjs`.
//
//   livro ler [--ultimos N | --desde SEQ] [--limite N]
//   livro lancar --tipo criar|assumir|entregar --tarefa ID --chave CHAVE [--dados '{"...": ...}']
//
// Where:  --url URL               or DONEL_LIVRO_URL, else the daemon's `url` file (DONEL_ORACULO_DIR or ~/.donel/oraculo)
// Who:    --servico NOME          reads ~/.donel/servicos/NOME.token
//         --token-arquivo CAMINHO or DONEL_LIVRO_TOKEN_ARQUIVO
// The token is only ever read from a file: never an argument (it would show in `ps`) nor printed.
//
// Prints the daemon's JSON. Exit 0 = done (a repeated key is done: `"novo": false`), 1 = refused (the reason in
// `error`), 2 = usage, missing credential or the daemon unreachable.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const USAGE = 'uso: livro ler [--ultimos N | --desde SEQ] [--limite N] | livro lancar --tipo T --tarefa ID --chave K [--dados JSON]  (--url URL) (--servico NOME | --token-arquivo CAMINHO)';

function fail(code, message) {
  process.stderr.write(`livro: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (!flag.startsWith('--') || i + 1 >= rest.length) fail(2, USAGE);
    flags[flag.slice(2)] = rest[(i += 1)];
  }
  return { command, flags };
}

function readText(path, what) {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return fail(2, `não consegui ler ${what} em ${path}`);
  }
}

const { command, flags } = parseArgs(process.argv.slice(2));
if (command !== 'ler' && command !== 'lancar') fail(2, USAGE);

const oracleDir = process.env.DONEL_ORACULO_DIR || join(homedir(), '.donel', 'oraculo');
const url = (flags.url || process.env.DONEL_LIVRO_URL || readText(join(oracleDir, 'url'), 'o endereço do Oráculo')).replace(/\/+$/, '');
const tokenFile = flags['token-arquivo'] || process.env.DONEL_LIVRO_TOKEN_ARQUIVO || (flags.servico ? join(homedir(), '.donel', 'servicos', `${flags.servico}.token`) : '');
if (!tokenFile) fail(2, 'falta a credencial: --servico NOME ou --token-arquivo CAMINHO');
if (flags.servico && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(flags.servico)) fail(2, 'nome do serviço: minúsculas, números e hífen');
const token = readText(tokenFile, 'a credencial');

let request;
if (command === 'ler') {
  const query = new URLSearchParams();
  for (const name of ['ultimos', 'desde', 'limite']) {
    if (flags[name] === undefined) continue;
    if (!/^\d{1,9}$/.test(flags[name])) fail(2, `--${name} é um número`);
    query.set(name, flags[name]);
  }
  request = { method: 'GET', path: `/v1/livro${String(query) ? `?${query}` : ''}` };
} else {
  for (const name of ['tipo', 'tarefa', 'chave']) if (!flags[name]) fail(2, `falta --${name}`);
  let dados = {};
  if (flags.dados !== undefined) {
    try {
      dados = JSON.parse(flags.dados);
    } catch {
      fail(2, '--dados não é JSON');
    }
  }
  request = { method: 'POST', path: '/v1/livro', body: JSON.stringify({ tipo: flags.tipo, tarefa: flags.tarefa, chave: flags.chave, dados }) };
}

let response;
try {
  response = await fetch(`${url}${request.path}`, {
    method: request.method,
    headers: { Authorization: `Bearer ${token}`, ...(request.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(request.body ? { body: request.body } : {}),
    signal: AbortSignal.timeout(15_000),
  });
} catch (error) {
  fail(2, `o Oráculo não respondeu em ${url} (${error instanceof Error ? error.message : String(error)})`);
}
const text = await response.text();
process.stdout.write(`${text}\n`);
if (response.status === 401) fail(1, 'credencial recusada (revogada ou errada)');
process.exit(response.ok ? 0 : response.status >= 500 ? 2 : 1);
