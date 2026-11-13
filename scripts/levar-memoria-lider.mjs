#!/usr/bin/env node
// Memória do Líder no PC (#413): o Líder passa a rodar na pasta da orquestradora, e o Claude guarda a memória por
// pasta de trabalho. Este script leva a memória do projeto antigo para a pasta nova sem perder nada e sem duplicar
// nada (dono). Passo 6 de docs/alfa/gerar-alfa-no-pc.md.
//
//   node scripts/levar-memoria-lider.mjs <pastaAntiga> <pastaNova>            # só mostra o plano
//   node scripts/levar-memoria-lider.mjs <pastaAntiga> <pastaNova> --aplicar  # grava
//
// Regras:
// - arquivo que só existe na antiga: copia;
// - mesmo nome e mesmo conteúdo: nada (.md em UTF-8 válido compara o texto sem BOM, com \r\n como \n e sem o branco
//   do fim; o resto, e .md que não é UTF-8 válido, sha256 byte a byte);
// - mesmo nome e conteúdo diferente: não sobrescreve; a versão antiga fica ao lado como <nome>.do-projeto-antigo.md
//   (já guardada igual: nada; esse nome com outra coisa, esse nome também na pasta antiga ou já reservado por outra
//   cópia: lista e não grava NADA, sai com 1). Nomes comparam sem diferença de maiúsculas, como no Windows;
// - MEMORY.md só na antiga: vai igual, byte a byte (BOM e fim de linha também), só com os links dos arquivos em
//   conflito "(a.md)" trocados por "(a.do-projeto-antigo.md)";
// - MEMORY.md nos dois: acrescenta, no fim, as linhas não vazias da antiga que faltam na nova. Entrada de índice
//   ("- [Nome](arquivo.md) — ...", um link só) falta quando a nova não tem entrada com esse link; qualquer outra
//   linha, quando a nova não tem esse texto (sem os espaços do fim). O que a nova já tinha fica byte a byte; o
//   acrescentado vai no fim de linha dela, em UTF-8 sem BOM;
// - antes de gravar, confere cada destino (pasta que é arquivo, MEMORY.md que é pasta): um falhando, PARADO e nada
//   gravado;
// - a pasta antiga só é lida; rodar de novo não muda nada.
// Node puro, sem dependências: roda no PC antes de qualquer build.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX = 'MEMORY.md';
const OLD_SUFFIX = '.do-projeto-antigo';
const BOM = '﻿';

const LINK = /\]\(([^)\s]+)\)/;
const LINKS = /\]\(([^)\s]+)\)/g;
// The same links over a latin1 view of the bytes (one char per byte): only ASCII blanks end a target, so a UTF-8
// continuation byte (0xA0, 0x85…) never cuts one.
const RAW_LINKS = /\]\(([^)\t\n\v\f\r ]+)\)/g;

function normalizeLink(target) {
  return target.replace(/^\.\//, '').replace(/\\/g, '/');
}

/** Names compare as Windows does: without case. */
function fold(name) {
  return name.toLowerCase();
}

/** The target of the first markdown link of a line, normalized; `null` when the line has none. */
function linkOf(line) {
  const match = LINK.exec(line);
  return match ? normalizeLink(match[1]) : null;
}

/** An index entry: a list item that opens with its one link ("- [Nome](arquivo.md) — ..."). */
function entryLinkOf(line) {
  if (!/^\s*[-*] \[/.test(line)) return null;
  const all = line.match(LINKS) ?? [];
  return all.length === 1 ? linkOf(line) : null;
}

function stripBom(text) {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

function linesOf(text) {
  return stripBom(text)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));
}

/** Every link to a renamed file, swapped for the name its old version was saved as. */
function relink(line, renamed) {
  return line.replace(LINKS, (whole, target) => {
    const link = normalizeLink(target);
    return Object.hasOwn(renamed, link) ? `](${renamed[link]})` : whole;
  });
}

/** `regra.md` → `regra.do-projeto-antigo.md`; `sub/nota` → `sub/nota.do-projeto-antigo`. */
function savedName(name) {
  const ext = path.posix.extname(name);
  return `${name.slice(0, name.length - ext.length)}${OLD_SUFFIX}${ext}`;
}

/**
 * Pure — the old index as it goes to a new folder that has none: the same bytes (BOM, line endings and any encoding
 * kept), only the links to files in conflict pointing to the old version saved beside them.
 */
export function copyMemoryIndex(oldBytes, renamed = {}) {
  if (Object.keys(renamed).length === 0) return Buffer.from(oldBytes);
  const raw = Buffer.from(oldBytes).toString('latin1');
  const out = raw.replace(RAW_LINKS, (whole, target) => {
    const link = normalizeLink(Buffer.from(target, 'latin1').toString('utf8'));
    return Object.hasOwn(renamed, link) ? `](${Buffer.from(renamed[link], 'utf8').toString('latin1')})` : whole;
  });
  return Buffer.from(out, 'latin1');
}

/**
 * Pure — the index of the new folder with the lines of the old one that it lacks. `renamed` maps a file of the old
 * folder to the name its old version was saved as (a conflict): its old lines come in pointing there. Lines are
 * checked against the new index only, never against each other: two old lines both missing in the new one both go.
 * Answers the new text and the lines added (empty: the text is the new one, byte for byte).
 */
export function mergeMemoryIndex(oldText, newText, renamed = {}) {
  const links = new Set();
  const texts = new Set();
  for (const line of linesOf(newText)) {
    const link = entryLinkOf(line);
    if (link !== null) links.add(link);
    texts.add(line.trimEnd());
  }
  const added = [];
  for (const raw of linesOf(oldText)) {
    if (raw.trim() === '') continue;
    const line = relink(raw, renamed);
    const link = entryLinkOf(line);
    if (link !== null ? links.has(link) : texts.has(line.trimEnd())) continue;
    added.push(line);
  }
  if (added.length === 0) return { text: newText, added };
  const eol = (newText === '' ? oldText : newText).includes('\r\n') ? '\r\n' : '\n';
  const base = newText === '' || newText.endsWith('\n') ? newText : `${newText}${eol}`;
  return { text: `${base}${added.join(eol)}${eol}`, added };
}

function sha(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

/** The text of a memory note as compared: without BOM, `\r\n` as `\n`, without the blank at the end; `null` when the
 * bytes are not valid UTF-8 (then only the bytes can tell). */
function normalizedText(file) {
  let text;
  try {
    text = STRICT_UTF8.decode(readFileSync(file));
  } catch {
    return null;
  }
  return stripBom(text).replace(/\r\n/g, '\n').trimEnd();
}

/** Same content: `.md` by normalized text (line ending or BOM alone is no conflict), anything else byte for byte. */
function sameContent(a, b) {
  if (!statSync(b).isFile()) return false;
  if (path.extname(a).toLowerCase() === '.md') {
    const left = normalizedText(a);
    const right = normalizedText(b);
    if (left !== null && right !== null) return left === right;
  }
  return sha(a) === sha(b);
}

/** Every file under `dir`, relative, with `/`, sorted. */
function filesOf(dir) {
  const out = [];
  const walk = (at, rel) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const key = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(at, entry.name), key);
      else if (entry.isFile()) out.push(key);
    }
  };
  walk(dir, '');
  return out.sort();
}

function isDir(file) {
  return existsSync(file) && statSync(file).isDirectory();
}

/** Why a file cannot be written at `target` (the nearest existing folder above it is a file); `null` when it can. */
function unwritable(target) {
  let dir = path.dirname(target);
  while (!existsSync(dir)) {
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return statSync(dir).isDirectory() ? null : `${dir} é um arquivo, não uma pasta`;
}

/**
 * Plans and (with `apply`) carries the memory of `oldDir` into `newDir`. Never writes in `oldDir`; never overwrites a
 * file of `newDir` (only the index grows). Anything it cannot keep (`blocked`) stops everything: nothing is written.
 */
export function carryMemory(oldDir, newDir, { apply }) {
  const copied = [];
  const same = [];
  const conflicts = [];
  const stopped = [];
  const renamed = {};
  const toWrite = [];
  const oldFiles = existsSync(oldDir) ? filesOf(oldDir) : [];
  const oldFolded = new Set(oldFiles.map(fold));
  // The new folder as Windows sees it: a name finds its file whatever the case.
  const newByFold = new Map(isDir(newDir) ? filesOf(newDir).map((name) => [fold(name), name]) : []);
  const inNew = (name) => newByFold.get(fold(name)) ?? name;
  const at = (dir, rel) => path.join(dir, ...rel.split('/'));
  const newIndex = at(newDir, inNew(INDEX));
  const hasOldIndex = oldFiles.includes(INDEX);
  const newIndexExists = existsSync(newIndex);
  const hadNewIndex = newIndexExists && statSync(newIndex).isFile();
  // Every target already promised to a write (folded): a second write there would erase the first one.
  const reserved = new Set();

  for (const name of oldFiles) {
    if (name === INDEX) {
      if (!hadNewIndex) copied.push(name);
      continue;
    }
    const source = at(oldDir, name);
    const target = at(newDir, inNew(name));
    if (!existsSync(target)) {
      if (reserved.has(fold(name))) {
        stopped.push({ name, why: 'outro arquivo da pasta antiga vai para o mesmo nome (sem diferença de maiúsculas)' });
        continue;
      }
      copied.push(name);
      toWrite.push({ name, source, target });
      reserved.add(fold(name));
      continue;
    }
    if (sameContent(source, target)) {
      same.push(name);
      continue;
    }
    const savedAs = savedName(name);
    const savedPath = at(newDir, inNew(savedAs));
    renamed[name] = savedAs;
    if (reserved.has(fold(savedAs)) || oldFolded.has(fold(savedAs))) {
      // The old folder has a file with that name too: both would go to the same place, and one would be lost.
      conflicts.push({ name, savedAs, status: 'blocked', reason: 'collision' });
    } else if (!existsSync(savedPath)) {
      conflicts.push({ name, savedAs, status: 'save' });
      toWrite.push({ name: savedAs, source, target: savedPath });
      reserved.add(fold(savedAs));
    } else if (sameContent(source, savedPath)) {
      conflicts.push({ name, savedAs, status: 'already-saved' });
    } else {
      conflicts.push({ name, savedAs, status: 'blocked' });
    }
  }

  let index = null;
  if (hasOldIndex) {
    const oldBytes = readFileSync(at(oldDir, INDEX));
    if (newIndexExists && !hadNewIndex) {
      stopped.push({ name: INDEX, why: `${newIndex} existe e não é um arquivo` });
    } else if (!hadNewIndex) {
      index = { bytes: copyMemoryIndex(oldBytes, renamed), added: [] };
    } else {
      const currentBytes = readFileSync(newIndex);
      const current = currentBytes.toString('utf8');
      const merged = mergeMemoryIndex(oldBytes.toString('utf8'), current, renamed);
      // What the new index had stays byte for byte; only the lines added are encoded.
      if (merged.added.length > 0) {
        index = { bytes: Buffer.concat([currentBytes, Buffer.from(merged.text.slice(current.length), 'utf8')]), added: merged.added };
      }
    }
  }

  // Every write is checked before the first one: either all of them fit, or none happens.
  for (const { name, target } of [...toWrite, ...(index ? [{ name: INDEX, target: newIndex }] : [])]) {
    const why = unwritable(target);
    if (why) stopped.push({ name, why });
  }

  const blocked = stopped.length > 0 || conflicts.some((conflict) => conflict.status === 'blocked');
  const applied = apply && !blocked;
  if (applied) {
    for (const { source, target } of toWrite) {
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    if (index) {
      mkdirSync(path.dirname(newIndex), { recursive: true });
      writeFileSync(newIndex, index.bytes);
    }
  }
  // A fresh index is reported as copied, not line by line.
  return { copied, same, conflicts, stopped, addedLines: index ? index.added : [], blocked, applied };
}
const COLLISION_WORDS = 'PARADO: a pasta antiga também tem um arquivo chamado';

const STATUS_WORDS = {
  save: 'a versão antiga fica ao lado como',
  'already-saved': 'a versão antiga já está guardada como',
  blocked: 'PARADO: já existe outro conteúdo em',
};

/** The report in the owner's words. */
export function formatReport(report) {
  const out = [];
  const list = (title, items) => {
    out.push(`${title} (${items.length})${items.length ? ':' : ''}`);
    for (const item of items) out.push(`  ${item}`);
  };
  list('Copiados', report.copied);
  list('Iguais, nada a fazer', report.same);
  list(
    'Conflitos (mesmo nome, conteúdo diferente; o da pasta nova fica)',
    report.conflicts.map(
      (conflict) => `${conflict.name}: ${conflict.reason === 'collision' ? COLLISION_WORDS : STATUS_WORDS[conflict.status]} ${conflict.savedAs}`,
    ),
  );
  list(`Linhas acrescentadas ao ${INDEX}`, report.addedLines);
  const stopped = report.stopped ?? [];
  if (stopped.length) list('Destinos impossíveis', stopped.map((stop) => `${stop.name}: PARADO: ${stop.why}`));
  if (report.blocked) out.push('Nada foi gravado: resolva os itens PARADO acima e rode de novo.');
  else if (report.applied) {
    const wrote = report.copied.length > 0 || report.addedLines.length > 0 || report.conflicts.some((conflict) => conflict.status === 'save');
    out.push(wrote ? 'Gravado. A pasta antiga ficou intacta.' : 'Nada a gravar: a pasta nova já tem tudo. A pasta antiga ficou intacta.');
  }
  else out.push('Só o plano: nada foi gravado. Confira e rode de novo com --aplicar.');
  return out.join('\n');
}

function main(args) {
  const apply = args.includes('--aplicar');
  const [oldDir, newDir] = args.filter((arg) => arg !== '--aplicar');
  if (!oldDir || !newDir) {
    console.error('uso: node scripts/levar-memoria-lider.mjs <pastaAntiga> <pastaNova> [--aplicar]');
    return 2;
  }
  if (!existsSync(oldDir) || filesOf(oldDir).length === 0) {
    console.log('Sem memória antiga para copiar.');
    return 0;
  }
  let report;
  try {
    report = carryMemory(oldDir, newDir, { apply });
  } catch (error) {
    console.error(`PARADO: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  console.log(formatReport(report));
  return report.blocked ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
