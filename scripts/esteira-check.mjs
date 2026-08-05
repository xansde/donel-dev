#!/usr/bin/env node
// A12 — validador de `result.json` de esteira por linha de comando.
//
// Roda o PARSER REAL do app (`parseEsteiraResultText`, de
// `src/shared/esteira/contract/resultContract.ts` — puro, sem Electron) contra
// um arquivo do disco. Validar so por JSON-schema nao bastaria: as regras
// cruzadas do parser (ex.: fase "concluir" com outcome "done" exige uma
// `verification.recorded` com state "passed" — D-4) sao o valor deste
// comando. Mesmo contrato que o app usa para ingerir, sem reimplementa-lo.
//
// Sem dependencia nova: o TypeScript e compilado EM MEMORIA com esbuild, que
// ja esta em node_modules como dependencia transitiva do vite (nunca listado
// em package.json aqui de proposito — ver README do batch).
//
// Uso:
//   npm run esteira:check -- <arquivo.json>
//
// Saida:
//   exit 0 — result valido: resumo de run/actor/subject/facts no stdout.
//   exit 1 — result invalido (ou arquivo ilegivel/ausente): um erro por
//            linha no stderr, com codigo + caminho + mensagem.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const RESULT_CONTRACT_ENTRY = resolve(REPO_ROOT, 'src/shared/esteira/contract/resultContract.ts');

/**
 * Compila `resultContract.ts` (+ o `parsing.ts` que ele importa) para um unico
 * modulo ESM em memoria e o carrega. Nenhum arquivo temporario toca o disco:
 * o bundle vira uma data: URL importada direto.
 */
async function loadParser() {
  const esbuild = await import('esbuild');
  const built = esbuild.buildSync({
    entryPoints: [RESULT_CONTRACT_ENTRY],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const code = built.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  return import(dataUrl);
}

function printUsage() {
  console.error('Uso: npm run esteira:check -- <arquivo.json>');
}

/** Uma linha por fato, com os campos que identificam o que foi declarado. */
function factSummaryLine(fact) {
  switch (fact.type) {
    case 'discovery.recorded':
      return `discovery.recorded  discovery_id=${fact.discovery_id}`;
    case 'plan.recorded':
      return `plan.recorded  plan_id=${fact.plan_id} discovery_id=${fact.discovery_id}`;
    case 'work_item.recorded':
      return `work_item.recorded  work_item_id=${fact.work_item_id} item_type=${fact.item_type}`;
    case 'relation.recorded':
      return `relation.recorded  ${fact.relation}: ${fact.from.entity}:${fact.from.id} -> ${fact.to.entity}:${fact.to.id}`;
    case 'artifact.recorded':
      return `artifact.recorded  ${fact.owner.entity}:${fact.owner.id} kind=${fact.artifact_kind} location=${fact.location} path=${fact.path}`;
    case 'verification.recorded':
      return `verification.recorded  ${fact.subject.entity}:${fact.subject.id} kind=${fact.verification_kind} state=${fact.state}`;
    case 'phase.completed':
      return `phase.completed  ${fact.subject.entity}:${fact.subject.id} phase=${fact.phase} outcome=${fact.outcome}`;
    case 'lock.acquired':
      return `lock.acquired  ${fact.subject.entity}:${fact.subject.id} phase=${fact.phase} holder=${fact.holder.kind}`;
    case 'lock.released':
      return `lock.released  ${fact.subject.entity}:${fact.subject.id} phase=${fact.phase}`;
    case 'note.recorded':
      return `note.recorded  ${fact.subject.entity}:${fact.subject.id}`;
    default:
      return fact.type;
  }
}

function printValid(filePath, result) {
  console.log(`esteira:check — result valido: ${filePath}`);
  console.log(`  contract_version: ${result.contract_version}`);
  console.log(`  run: phase=${result.run.phase} status=${result.run.status} run_id=${result.run.run_id}`);
  console.log(`  janela: ${result.run.started_at} -> ${result.run.finished_at}`);
  const actorBits = [`tool=${result.actor.tool}@${result.actor.tool_version}`];
  if (result.actor.model) actorBits.push(`model=${result.actor.model}`);
  if (result.actor.effort) actorBits.push(`effort=${result.actor.effort}`);
  console.log(`  actor: ${actorBits.join(' ')}`);
  const subjectBits = [`discovery_id=${result.subject.discovery_id}`];
  if (result.subject.plan_id) subjectBits.push(`plan_id=${result.subject.plan_id}`);
  if (result.subject.work_item_id) subjectBits.push(`work_item_id=${result.subject.work_item_id}`);
  console.log(`  subject: ${subjectBits.join(' ')}`);
  if (result.workspace) {
    console.log(`  workspace: target_repo=${result.workspace.target_repo}${result.workspace.branch ? ` branch=${result.workspace.branch}` : ''}`);
  }
  console.log(`  facts (${result.facts.length}):`);
  for (const fact of result.facts) console.log(`    - ${factSummaryLine(fact)}`);
}

function printIssues(filePath, issues) {
  console.error(`esteira:check — result invalido (${issues.length} problema${issues.length === 1 ? '' : 's'}): ${filePath}`);
  for (const issue of issues) {
    console.error(`  [${issue.code}] ${issue.path || '(raiz)'} — ${issue.message}`);
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const filePath = resolve(process.cwd(), arg);
  if (!existsSync(filePath)) {
    console.error(`esteira:check — arquivo nao encontrado: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`esteira:check — nao foi possivel ler o arquivo: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const { parseEsteiraResultText } = await loadParser();
  const parsed = parseEsteiraResultText(text);

  if (!parsed.ok) {
    printIssues(filePath, parsed.issues);
    process.exitCode = 1;
    return;
  }

  printValid(filePath, parsed.result);
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(`esteira:check — erro inesperado: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
