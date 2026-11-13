#!/usr/bin/env node
// O que chegou ao chat de uma sessão numa janela de tempo (t-5c0df1df: a prova do que o Líder único recebeu em 1 h).
// Lê o transcript JSONL em streaming e lista cada mensagem que entrou: digitada pelo app ou pelo dono, e as que
// esperaram na fila do CLI. Não lê resultado de ferramenta nem aviso de tarefa em segundo plano da própria sessão.
//
// Uso: node scripts/caixa-do-lider.mjs <transcript.jsonl> <início ISO> [fim ISO]
//   sem fim: início + 1 h. Sem transcript: o .jsonl mais novo da pasta de projetos do Claude para o cwd.

import { createReadStream, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const [argFile, argStart, argEnd] = process.argv.slice(2);
if (!argStart && !argFile) {
  console.error('uso: node scripts/caixa-do-lider.mjs <transcript.jsonl|-> <início ISO> [fim ISO]');
  process.exit(2);
}

function newestTranscript() {
  const dir = join(homedir(), '.claude', 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

const file = argFile && argFile !== '-' ? argFile : newestTranscript();
const start = new Date(argStart);
const end = argEnd ? new Date(argEnd) : new Date(start.getTime() + 3_600_000);

/** Who sent it, by the shape the app gives each kind of message. */
function kind(text) {
  if (text.startsWith('◆ De ') && /, (tarefa completa|bloqueio):/.test(text.slice(0, 400))) return 'sessao_enviar com motivo';
  if (text.startsWith('◆')) return 'aviso do app';
  if (text.startsWith('[despertador')) return 'despertador';
  return 'dono ou outro';
}

const seen = new Set();
const rows = [];
const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
  let d;
  try {
    d = JSON.parse(line);
  } catch {
    continue;
  }
  const at = new Date(d.timestamp ?? 0);
  if (!(at >= start && at < end) || d.isSidechain || d.isMeta) continue;
  let text = null;
  if (d.type === 'user' && typeof d.message?.content === 'string') text = d.message.content;
  else if (d.type === 'attachment' && d.attachment?.type === 'queued_command' && typeof d.attachment.prompt === 'string') text = d.attachment.prompt;
  if (!text || text.startsWith('<task-notification>') || text.startsWith('<system-reminder>') || text.startsWith('<command-')) continue;
  const key = text.slice(0, 500);
  if (seen.has(key)) continue; // the queued copy and the turn it opened are one message
  seen.add(key);
  rows.push({ at: at.toISOString(), kind: kind(text), text: text.replace(/\s+/g, ' ').slice(0, 300) });
}

console.log(`transcript: ${file}`);
console.log(`janela: ${start.toISOString()} a ${end.toISOString()} — ${rows.length} mensagem(ns)`);
const counts = {};
for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
console.log(`por tipo: ${JSON.stringify(counts)}`);
for (const r of rows) console.log(`${r.at} [${r.kind}] ${r.text}`);
