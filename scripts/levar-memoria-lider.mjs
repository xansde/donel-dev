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
// - mesmo nome e mesmo conteúdo (sha256): nada;
// - mesmo nome e conteúdo diferente: não sobrescreve; a versão antiga fica ao lado como <nome>.do-projeto-antigo.md
//   (já guardada igual: nada; esse nome com outra coisa: lista e não grava NADA);
// - MEMORY.md nos dois: acrescenta só as entradas da antiga cujo link "(arquivo.md)" a nova não tem (linha sem link:
//   pelo texto exato), com quebra de linha antes, no fim de linha do destino, em UTF-8 sem BOM;
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

/** The target of the first markdown link of a line, normalized; `null` when the line has none. */
function linkOf(line) {
  const match = LINK.exec(line);
  return match ? match[1].replace(/^\.\//, '').replace(/\\/g, '/') : null;
}

function stripBom(text) {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

function linesOf(text) {
  return stripBom(text)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));
}

/** `regra.md` → `regra.do-projeto-antigo.md`; `sub/nota` → `sub/nota.do-projeto-antigo`. */
function savedName(name) {
  const ext = path.posix.extname(name);
  return `${name.slice(0, name.length - ext.length)}${OLD_SUFFIX}${ext}`;
}

/**
 * Pure — the index of the new folder with the entries of the old one that it lacks. `renamed` maps a file of the old
 * folder to the name its old version was saved as (a conflict): its old entry comes in pointing there.
 * Answers the new text and the lines added (empty: the text is the new one, byte for byte).
 */
export function mergeMemoryIndex(oldText, newText, renamed = {}) {
  const have = linesOf(newText);
  const links = new Set();
  const texts = new Set();
  for (const line of have) {
    const link = linkOf(line);
    if (link !== null) links.add(link);
    else texts.add(line);
  }
  const added = [];
  for (const raw of linesOf(oldText)) {
    if (raw.trim() === '') continue;
    let line = raw;
    let link = linkOf(line);
    if (link !== null && Object.hasOwn(renamed, link)) {
      link = renamed[link];
      line = line.replace(LINK, `](${link})`);
    }
    if (link !== null) {
      if (links.has(link)) continue;
      links.add(link);
    } else {
      if (texts.has(line)) continue;
      texts.add(line);
    }
    added.push(line);
  }
  if (added.length === 0) return { text: newText, added };
  const eol = newText.includes('\r\n') ? '\r\n' : '\n';
  const base = newText === '' || newText.endsWith('\n') ? newText : `${newText}${eol}`;
  return { text: `${base}${added.join(eol)}${eol}`, added };
}

function sha(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
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

/**
 * Plans and (with `apply`) carries the memory of `oldDir` into `newDir`. Never writes in `oldDir`; never overwrites a
 * file of `newDir` (only the index grows). A conflict it cannot keep (`blocked`) stops everything: nothing is written.
 */
export function carryMemory(oldDir, newDir, { apply }) {
  const copied = [];
  const same = [];
  const conflicts = [];
  const renamed = {};
  const toWrite = [];
  const oldFiles = existsSync(oldDir) ? filesOf(oldDir) : [];
  const at = (dir, rel) => path.join(dir, ...rel.split('/'));
  const newIndex = at(newDir, INDEX);
  const mergesIndex = oldFiles.includes(INDEX) && existsSync(newIndex);

  for (const name of oldFiles) {
    if (name === INDEX && mergesIndex) continue;
    const source = at(oldDir, name);
    const target = at(newDir, name);
    if (!existsSync(target)) {
      copied.push(name);
      toWrite.push({ source, target });
      continue;
    }
    if (statSync(target).isFile() && sha(source) === sha(target)) {
      same.push(name);
      continue;
    }
    const savedAs = savedName(name);
    const savedPath = at(newDir, savedAs);
    renamed[name] = savedAs;
    if (!existsSync(savedPath)) {
      conflicts.push({ name, savedAs, status: 'save' });
      toWrite.push({ source, target: savedPath });
    } else if (statSync(savedPath).isFile() && sha(source) === sha(savedPath)) {
      conflicts.push({ name, savedAs, status: 'already-saved' });
    } else {
      conflicts.push({ name, savedAs, status: 'blocked' });
    }
  }

  let index = null;
  if (mergesIndex) {
    const current = readFileSync(newIndex, 'utf8');
    const merged = mergeMemoryIndex(readFileSync(at(oldDir, INDEX), 'utf8'), current, renamed);
    if (merged.added.length > 0) index = merged;
  }

  const blocked = conflicts.some((conflict) => conflict.status === 'blocked');
  const applied = apply && !blocked;
  if (applied) {
    for (const { source, target } of toWrite) {
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    if (index) writeFileSync(newIndex, index.text, 'utf8');
  }
  return { copied, same, conflicts, addedLines: index ? index.added : [], blocked, applied };
}

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
    report.conflicts.map((conflict) => `${conflict.name}: ${STATUS_WORDS[conflict.status]} ${conflict.savedAs}`),
  );
  list(`Linhas acrescentadas ao ${INDEX}`, report.addedLines);
  if (report.blocked) out.push('Nada foi gravado: resolva os conflitos PARADO acima (compare os dois arquivos) e rode de novo.');
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
  const report = carryMemory(oldDir, newDir, { apply });
  console.log(formatReport(report));
  return report.blocked ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
