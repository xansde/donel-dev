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
//   conflito "(a.md)" / "(a.md#sec)" trocados por "(a.do-projeto-antigo.md)" / "(a.do-projeto-antigo.md#sec)";
// - MEMORY.md nos dois: acrescenta, no fim, as linhas não vazias da antiga que faltam na nova. Entrada de índice é a
//   linha de lista ("- [", "* [" ou "1. [") cujo primeiro link aponta um .md; o link compara sem maiúsculas e sem
//   âncora. Entrada cujo link a nova não tem: entra. Mesmo link e mesmo texto: nada. Mesmo link com outro texto: não
//   entra (não duplica) e vai aos conflitos, com as duas linhas, para o dono decidir. Qualquer outra linha entra
//   quando a nova não tem esse texto (sem os espaços do fim). O que a nova já tinha fica byte a byte; o acrescentado
//   vai no fim de linha dela, em UTF-8 sem BOM. MEMORY.md antigo que não é UTF-8 válido: PARADO, nada gravado;
// - antes de gravar, confere cada destino (pasta que é arquivo, MEMORY.md que é pasta): um falhando, PARADO e nada
//   gravado. Se mesmo assim uma gravação falhar no meio (permissão, arquivo preso), GRAVAÇÃO PARCIAL: lista o gravado
//   e o que faltou e sai com 2; o MEMORY.md é o último, e rodar de novo depois de corrigir completa sem duplicar;
// - link simbólico na pasta antiga não é seguido: aparece como ignorado;
// - a pasta antiga só é lida; rodar de novo não muda nada. Limite: bloco de código (```) no índice é lido como texto.
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

/** A link target without its anchor, normalized and folded: the file it points to, as names compare. */
function fileKey(target) {
  const hash = target.indexOf('#');
  return fold(normalizeLink(hash < 0 ? target : target.slice(0, hash)));
}

/**
 * An index entry: a list item ("- [", "* [" or "1. [") whose first link points to a `.md`. Answers the file it points
 * to (folded, without anchor) and the line as compared (without the list marker and the blank at the end, with the
 * link folded); `null` when the line is no entry.
 */
function entryOf(line) {
  const marker = /^\s*(?:[-*]|\d+\.) (?=\[)/.exec(line);
  if (!marker) return null;
  const match = LINK.exec(line);
  if (!match) return null;
  const key = fileKey(match[1]);
  if (!key.endsWith('.md')) return null;
  const rest = line.slice(marker[0].length).trimEnd();
  const at = match.index - marker[0].length;
  return { key, text: `${rest.slice(0, at)}](${fold(normalizeLink(match[1]))})${rest.slice(at + match[0].length)}` };
}

function stripBom(text) {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

function linesOf(text) {
  return stripBom(text)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));
}

/** `renamed` by folded name: a link finds its file whatever the case, as on Windows. */
function foldRenamed(renamed) {
  return new Map(Object.entries(renamed).map(([name, savedAs]) => [fold(name), savedAs]));
}

/** The target a link takes when its file was renamed (anchor kept); `null` when it stays. */
function renamedTarget(target, byFold) {
  const savedAs = byFold.get(fileKey(target));
  if (savedAs === undefined) return null;
  const hash = target.indexOf('#');
  return hash < 0 ? savedAs : `${savedAs}${target.slice(hash)}`;
}

/** Every link to a renamed file, swapped for the name its old version was saved as. */
function relink(line, renamed) {
  const byFold = foldRenamed(renamed);
  return line.replace(LINKS, (whole, target) => {
    const next = renamedTarget(target, byFold);
    return next === null ? whole : `](${next})`;
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
  const byFold = foldRenamed(renamed);
  const raw = Buffer.from(oldBytes).toString('latin1');
  const out = raw.replace(RAW_LINKS, (whole, target) => {
    const next = renamedTarget(Buffer.from(target, 'latin1').toString('utf8'), byFold);
    return next === null ? whole : `](${Buffer.from(next, 'utf8').toString('latin1')})`;
  });
  return Buffer.from(out, 'latin1');
}

/**
 * Pure — the index of the new folder with the lines of the old one that it lacks. `renamed` maps a file of the old
 * folder to the name its old version was saved as (a conflict): its old lines come in pointing there. Lines are
 * checked against the new index only, never against each other: two old lines both missing in the new one both go.
 * An old entry for a file the new index has an entry for, with another text, is not added: it is a conflict (`old`
 * and the first `new` entry of that file), for the owner to decide. Answers the new text, the lines added (empty:
 * the text is the new one, byte for byte) and those conflicts.
 */
export function mergeMemoryIndex(oldText, newText, renamed = {}) {
  const entries = new Map();
  const texts = new Set();
  for (const line of linesOf(newText)) {
    const entry = entryOf(line);
    if (entry !== null) {
      if (!entries.has(entry.key)) entries.set(entry.key, { line: line.trimEnd(), texts: new Set() });
      entries.get(entry.key).texts.add(entry.text);
    }
    texts.add(line.trimEnd());
  }
  const added = [];
  const conflicts = [];
  for (const raw of linesOf(oldText)) {
    if (raw.trim() === '') continue;
    const line = relink(raw, renamed);
    const entry = entryOf(line);
    if (entry !== null && entries.has(entry.key)) {
      const known = entries.get(entry.key);
      if (!known.texts.has(entry.text)) conflicts.push({ link: entry.key, old: line.trimEnd(), new: known.line });
      continue;
    }
    if (entry === null && texts.has(line.trimEnd())) continue;
    added.push(line);
  }
  if (added.length === 0) return { text: newText, added, conflicts };
  const eol = (newText === '' ? oldText : newText).includes('\r\n') ? '\r\n' : '\n';
  const base = newText === '' || newText.endsWith('\n') ? newText : `${newText}${eol}`;
  return { text: `${base}${added.join(eol)}${eol}`, added, conflicts };
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

/** Every file under `dir`, relative, with `/`, sorted. Symbolic links are not followed: they go to `links`. */
function filesOf(dir, links = []) {
  const out = [];
  const walk = (at, rel) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const key = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) links.push(key);
      else if (entry.isDirectory()) walk(path.join(at, entry.name), key);
      else if (entry.isFile()) out.push(key);
    }
  };
  walk(dir, '');
  links.sort();
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
  const ignored = [];
  const oldFiles = existsSync(oldDir) ? filesOf(oldDir, ignored) : [];
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
  let indexConflicts = [];
  if (hasOldIndex) {
    const oldBytes = readFileSync(at(oldDir, INDEX));
    if (newIndexExists && !hadNewIndex) {
      stopped.push({ name: INDEX, why: `${newIndex} existe e não é um arquivo` });
    } else if (!hadNewIndex) {
      index = { bytes: copyMemoryIndex(oldBytes, renamed), added: [] };
    } else {
      let oldText = null;
      try {
        oldText = STRICT_UTF8.decode(oldBytes);
      } catch {
        stopped.push({ name: INDEX, why: 'o MEMORY.md antigo não é UTF-8: converta-o para UTF-8 (ou junte à mão) e rode de novo' });
      }
      if (oldText !== null) {
        const currentBytes = readFileSync(newIndex);
        const current = currentBytes.toString('utf8');
        const merged = mergeMemoryIndex(oldText, current, renamed);
        indexConflicts = merged.conflicts;
        // What the new index had stays byte for byte; only the lines added are encoded.
        if (merged.added.length > 0) {
          index = { bytes: Buffer.concat([currentBytes, Buffer.from(merged.text.slice(current.length), 'utf8')]), added: merged.added };
        }
      }
    }
  }

  // Every write is checked before the first one: either all of them fit, or none happens.
  for (const { name, target } of [...toWrite, ...(index ? [{ name: INDEX, target: newIndex }] : [])]) {
    const why = unwritable(target);
    if (why) stopped.push({ name, why });
  }

  const blocked = stopped.length > 0 || conflicts.some((conflict) => conflict.status === 'blocked');
  let applied = apply && !blocked;
  let partial;
  if (applied) {
    // One at a time, the index last: a write that fails midway leaves no index line pointing to a missing file.
    const writes = [
      ...toWrite.map(({ name, source, target }) => ({ name, run: () => copyFileSync(source, target), target })),
      ...(index ? [{ name: INDEX, run: () => writeFileSync(newIndex, index.bytes), target: newIndex }] : []),
    ];
    const written = [];
    for (const [at, write] of writes.entries()) {
      try {
        mkdirSync(path.dirname(write.target), { recursive: true });
        write.run();
        written.push(write.name);
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        partial = { written, missing: writes.slice(at).map(({ name }) => name), failed: write.name, why };
        applied = false;
        break;
      }
    }
  }
  // A fresh index is reported as copied, not line by line.
  return { copied, same, conflicts, indexConflicts, stopped, ignored, addedLines: index ? index.added : [], blocked, applied, ...(partial ? { partial } : {}) };
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
  list('Conflitos (o da pasta nova fica; o dono decide)', [
    ...report.conflicts.map(
      (conflict) => `${conflict.name}: ${conflict.reason === 'collision' ? COLLISION_WORDS : STATUS_WORDS[conflict.status]} ${conflict.savedAs}`,
    ),
    ...(report.indexConflicts ?? []).map(
      (conflict) =>
        `${INDEX}, entrada de ${conflict.link} com outro texto (nada acrescentado; junte à mão se quiser o da antiga):\n` +
        `      antiga: ${conflict.old}\n      nova:   ${conflict.new}`,
    ),
  ]);
  list(`Linhas acrescentadas ao ${INDEX}`, report.addedLines);
  const ignored = report.ignored ?? [];
  if (ignored.length) list('Ignorados', ignored.map((name) => `${name}: ignorado (link simbólico)`));
  const stopped = report.stopped ?? [];
  if (stopped.length) list('Destinos impossíveis', stopped.map((stop) => `${stop.name}: PARADO: ${stop.why}`));
  if (report.partial) {
    const { written, missing, failed, why } = report.partial;
    out.push(`GRAVAÇÃO PARCIAL: a gravação de ${failed} falhou (${why}).`);
    list('Gravados', written);
    list('Faltaram', missing);
    out.push('Corrija a causa (permissão, arquivo aberto em outro programa) e rode de novo com --aplicar: o que já foi gravado aparece como igual, e nada duplica. A pasta antiga ficou intacta.');
  } else if (report.blocked) out.push('Nada foi gravado: resolva os itens PARADO acima e rode de novo.');
  else if (report.applied) {
    const wrote = report.copied.length > 0 || report.addedLines.length > 0 || report.conflicts.some((conflict) => conflict.status === 'save');
    const pending = (report.indexConflicts ?? []).length > 0 ? ' Os conflitos do MEMORY.md acima ficam para o dono decidir.' : '';
    out.push(`${wrote ? 'Gravado.' : 'Nada a gravar: a pasta nova já tem tudo.'}${pending} A pasta antiga ficou intacta.`);
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
  const links = [];
  if (!existsSync(oldDir) || (filesOf(oldDir, links).length === 0 && links.length === 0)) {
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
  if (report.partial) return 2;
  return report.blocked ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
