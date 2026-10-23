// 016-jobu-faxina (T005) - the `resumo.html` that lives inside the sweep folder: one self-contained file (inline CSS,
// the tokens on `:root` with a dark theme through `prefers-color-scheme`, no script, no external address) that tells
// the owner what is in the folder to review and what the sweep already did. Pure: the report goes in, a string comes
// out. Every text that did not come from this file is escaped. Visual reference: the approved prototype of 23/10.

import { formatBytes } from '../../shared/format-bytes';
import { formatDate } from './names';
import type { ExecutedItem, PlanItem, RepoReport, SweepReport } from './types';

type SeparateItem = Extract<PlanItem, { kind: 'separate' }>;
type DeleteItem = Extract<PlanItem, { kind: 'delete' }>;
type WorktreeItem = Extract<PlanItem, { kind: 'removeWorktree' }>;
type BranchItem = Extract<PlanItem, { kind: 'deleteBranch' }>;

export interface SweepTotals {
  readonly freedBytes: number;
  readonly separatedBytes: number;
  readonly separatedItems: number;
  readonly branchesDeleted: number;
  readonly worktreesRemoved: number;
  /** Items left alone on purpose. */
  readonly kept: number;
  /** Items the sweep tried and could not do. */
  readonly failed: number;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const e = escapeHtml;

/** What an executed item of a given kind, that went well, is. */
function done<K extends PlanItem['kind']>(repo: RepoReport, kind: K): Extract<PlanItem, { kind: K }>[] {
  return repo.executed.flatMap((entry) => (entry.ok && entry.item.kind === kind ? [entry.item as Extract<PlanItem, { kind: K }>] : []));
}

/** The totals of a sweep: only what really happened counts (a failed deletion frees nothing). */
export function totalsOf(report: SweepReport): SweepTotals {
  let freedBytes = 0;
  let separatedBytes = 0;
  let separatedItems = 0;
  let branchesDeleted = 0;
  let worktreesRemoved = 0;
  let kept = 0;
  let failed = 0;
  for (const repo of report.repos) {
    for (const item of done(repo, 'delete')) freedBytes += item.bytes;
    for (const item of done(repo, 'separate')) {
      separatedBytes += item.bytes;
      separatedItems += 1;
    }
    branchesDeleted += done(repo, 'deleteBranch').length;
    worktreesRemoved += done(repo, 'removeWorktree').length;
    kept += repo.kept.length;
    failed += repo.executed.filter((entry) => !entry.ok).length;
  }
  return { freedBytes, separatedBytes, separatedItems, branchesDeleted, worktreesRemoved, kept, failed };
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The sentence at the top of the page: facts only, the way the bubble of the Jobu would say them at length. */
export function summaryText(totals: SweepTotals): string {
  const sentences: string[] = [];
  const first: string[] = [];
  if (totals.freedBytes > 0) first.push(`${formatBytes(totals.freedBytes)} liberados`);
  if (totals.separatedItems > 0) first.push(`${count(totals.separatedItems, 'item separado', 'itens separados')} na pasta (${formatBytes(totals.separatedBytes)})`);
  const removed: string[] = [];
  if (totals.branchesDeleted > 0) removed.push(count(totals.branchesDeleted, 'branch', 'branches'));
  if (totals.worktreesRemoved > 0) removed.push(count(totals.worktreesRemoved, 'worktree', 'worktrees'));

  if (first.length === 0 && removed.length === 0) sentences.push('nada a limpar.');
  if (first.length > 0) sentences.push(`${first.join('; ')}.`);
  if (removed.length > 0) sentences.push(`${removed.join(' e ')} removidas.`);
  const left: string[] = [];
  if (totals.kept > 0) left.push(`Ficaram ${count(totals.kept, 'item', 'itens')} de lado`);
  if (totals.failed > 0) left.push(totals.failed === 1 ? '1 não pôde ser feito' : `${totals.failed} não puderam ser feitos`);
  if (left.length > 0) sentences.push(`${left.join(' e ')}.`);
  return `Faxina: ${sentences.join(' ')}`;
}

// ---------------------------------------------------------------------------
// Pieces of the page
// ---------------------------------------------------------------------------

const STYLE = `:root{--bg:#f6f5f2;--fg:#1d1c1a;--mut:#6b6862;--card:#fff;--line:#e4e1da;--acc:#6b46c1;--ok:#2f7d4f;--warn:#a65e17;--bad:#b3261e;--chip:#efecf9}
@media (prefers-color-scheme:dark){:root{--bg:#15141a;--fg:#ecebe8;--mut:#9a978f;--card:#1f1e25;--line:#34323a;--acc:#b39af0;--ok:#6cc58f;--warn:#e3a463;--bad:#f2867f;--chip:#2a2638}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 "Segoe UI",system-ui,sans-serif}
main{max-width:1040px;margin:0 auto;padding:32px 16px 72px}h1{margin:0 0 4px;font-size:26px}h2{font-size:18px;margin:32px 0 10px}h3{font-size:15px;margin:18px 0 8px}
.mut{color:var(--mut)}.note{background:var(--chip);border-radius:10px;padding:10px 14px;margin:16px 0;font-size:14px}
.resumo{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--acc);border-radius:10px;padding:12px 16px;margin:18px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px}.kpi b{display:block;font-size:22px}.kpi span{color:var(--mut);font-size:13px}
details{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:0 0 10px;padding:2px 16px}
summary{cursor:pointer;padding:10px 0;font-weight:600}summary span{font-weight:400;color:var(--mut);margin-left:8px}
p.why{margin:0 0 10px;color:var(--mut);font-size:14px}.wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px}td,th{text-align:left;padding:6px 8px;border-top:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:500}td.n{text-align:right;white-space:nowrap}code{font:12px Consolas,monospace;word-break:break-all}
.tag{display:inline-block;font-size:11px;padding:1px 8px;border-radius:99px;background:var(--chip)}.warn{color:var(--warn)}.bad{color:var(--bad)}`;

function table(headers: readonly { readonly text: string; readonly numeric?: boolean }[], rows: readonly (readonly string[])[]): string {
  const head = headers.map((header) => `<th${header.numeric === true ? ' class="n"' : ''}>${e(header.text)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell, index) => `<td${headers[index]?.numeric === true ? ' class="n"' : ''}>${cell}</td>`).join('')}</tr>`)
    .join('\n');
  return `<div class="wrap"><table><tr>${head}</tr>\n${body}</table></div>`;
}

function section(title: string, meta: string, why: string | null, content: string, open: boolean): string {
  const lead = why === null ? '' : `<p class="why">${e(why)}</p>`;
  return `<details${open ? ' open' : ''}><summary>${e(title)}<span>${e(meta)}</span></summary>${lead}${content}</details>`;
}

const code = (text: string): string => `<code>${e(text)}</code>`;

function separatedBlock(repo: RepoReport): string {
  const separated = done(repo, 'separate');
  const sessions = separated.filter((item) => item.group === 'sessoes-claude');
  const esteira = separated.filter((item) => item.group === 'esteira');
  const rows = (items: readonly SeparateItem[]): string[][] =>
    items.map((item) => [code(item.from), formatDate(item.mtimeMs), e(item.restore), e(formatBytes(item.bytes))]);
  const headers = [{ text: 'Origem' }, { text: 'Data' }, { text: 'Como restaurar' }, { text: 'Tamanho', numeric: true }];
  const parts: string[] = [];
  if (sessions.length > 0) {
    parts.push(
      section(
        'Sessões antigas do Claude',
        `${sessions.length} · ${formatBytes(sessions.reduce((sum, item) => sum + item.bytes, 0))}`,
        'A pasta de trabalho delas não existe mais, e elas saíram de "Sessões anteriores" do Donel. Para restaurar uma, mova a pasta de volta para ~/.claude/projects/.',
        table(headers, rows(sessions)),
        true,
      ),
    );
  }
  if (esteira.length > 0) {
    parts.push(
      section(
        'Arquivos da Esteira',
        `${esteira.length} · ${formatBytes(esteira.reduce((sum, item) => sum + item.bytes, 0))}`,
        'Arquivos não versionados de .esteira/. Para restaurar, copie de volta para o caminho de origem no repo.',
        table(headers, rows(esteira)),
        true,
      ),
    );
  }
  return parts.join('\n');
}

function deletedBlock(repo: RepoReport): string {
  const deleted: DeleteItem[] = done(repo, 'delete');
  if (deleted.length === 0) return '';
  const size = deleted.reduce((sum, item) => sum + item.bytes, 0);
  return section(
    'Apagado direto',
    `${deleted.length} ${deleted.length === 1 ? 'item' : 'itens'} · ${formatBytes(size)}`,
    'Regenerável pelo build, pelos testes ou pelo npm install, ou temporário por definição.',
    table([{ text: 'Origem' }, { text: 'Motivo' }, { text: 'Tamanho', numeric: true }], deleted.map((item) => [code(item.label), e(item.reason), e(formatBytes(item.bytes))])),
    false,
  );
}

function worktreesBlock(repo: RepoReport): string {
  const removed: WorktreeItem[] = done(repo, 'removeWorktree');
  if (removed.length === 0) return '';
  return section(
    'Worktrees removidas',
    String(removed.length),
    null,
    table([{ text: 'Pasta' }, { text: 'Branch' }, { text: 'Motivo' }], removed.map((item) => [code(item.path), item.branch === null ? '<span class="mut">HEAD solto</span>' : code(item.branch), e(item.reason)])),
    false,
  );
}

function branchesBlock(repo: RepoReport): string {
  const removed: BranchItem[] = done(repo, 'deleteBranch');
  if (removed.length === 0) return '';
  const target = repo.integrationRef === null ? 'sem branch de integração' : `conteúdo já em ${repo.integrationRef} ou publicado no remoto`;
  return section(
    'Branches apagadas',
    `${removed.length} · ${target}`,
    `Para recriar uma, rode o comando da linha dentro de ${repo.repoName}. Funciona enquanto o git não coletar os objetos (semanas). O recibo completo está em branches-apagadas.txt, na subpasta do repo.`,
    table([{ text: 'Branch' }, { text: 'Recriar' }, { text: 'Motivo' }], removed.map((item) => [code(item.name), code(`git branch ${item.name} ${item.sha}`), e(item.reason)])),
    false,
  );
}

function keptBlock(repo: RepoReport): string {
  if (repo.kept.length === 0) return '';
  return section(
    'Não foi tocado',
    'decida você',
    null,
    table([{ text: 'Item' }, { text: 'Tipo' }, { text: 'Motivo' }], repo.kept.map((item) => [code(item.name), `<span class="tag">${e(item.what)}</span>`, e(item.reason)])),
    true,
  );
}

function failedBlock(repo: RepoReport): string {
  const failures: ExecutedItem[] = repo.executed.filter((entry) => !entry.ok);
  if (failures.length === 0) return '';
  return section(
    'Não foi possível',
    String(failures.length),
    'O resto da faxina seguiu. Estes itens ficaram como estavam.',
    table([{ text: 'Item' }, { text: 'O que houve' }], failures.map((entry) => [code(describeItem(entry.item)), `<span class="bad">${e(entry.error ?? 'erro desconhecido')}</span>`])),
    true,
  );
}

function describeItem(item: PlanItem): string {
  switch (item.kind) {
    case 'delete':
      return item.label;
    case 'removeWorktree':
      return item.path;
    case 'deleteBranch':
      return item.name;
    case 'separate':
      return item.from;
    case 'keep':
      return item.name;
  }
}

/** One block per repo for a section of the page, skipping the repos with nothing to show in it. */
function perRepo(report: SweepReport, blockOf: (repo: RepoReport) => string): string {
  return report.repos
    .map((repo) => ({ repo, html: blockOf(repo) }))
    .filter((entry) => entry.html !== '')
    .map((entry) => `<h3>${e(entry.repo.repoName)}</h3>\n${entry.html}`)
    .join('\n');
}

function tile(value: string, label: string, warn = false): string {
  return `<div class="kpi"><b${warn ? ' class="warn"' : ''}>${e(value)}</b><span>${e(label)}</span></div>`;
}

/** `AAAA-MM-DD` as `dd/mm/aaaa`. */
function readableDay(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

/** The whole `resumo.html`. `generatedAt` is only used to date the footer. */
export function renderSummary(report: SweepReport, generatedAt: number): string {
  const totals = totalsOf(report);
  const day = readableDay(report.day);
  const repoNames = report.repos.map((repo) => code(repo.repoName)).join(', ');
  const folderLine = report.folder === null ? '' : ` · pasta da faxina: ${code(report.folder)}`;

  const notes = [
    ...report.notes,
    ...report.repos.flatMap((repo) => (repo.fetchError === null ? [] : [`${repo.repoName}: git fetch falhou (${repo.fetchError}); a faxina seguiu com o que havia localmente.`])),
  ];
  const notesHtml = notes.length === 0 ? '' : `<div class="note">${notes.map((note) => e(note)).join('<br>')}</div>`;

  const review = perRepo(report, separatedBlock);
  const resolved = [perRepo(report, deletedBlock), perRepo(report, worktreesBlock), perRepo(report, branchesBlock)].filter((part) => part !== '').join('\n');
  const left = perRepo(report, keptBlock);
  const failures = perRepo(report, failedBlock);

  const parts: string[] = [];
  parts.push(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`);
  parts.push(`<title>Faxina ${e(day)}</title><style>${STYLE}</style></head><body><main>`);
  parts.push(`<h1>Faxina de ${e(day)}</h1>`);
  parts.push(`<div class="mut">${count(report.repos.length, 'repo varrido', 'repos varridos')} (${repoNames})${folderLine}</div>`);
  parts.push(notesHtml);
  parts.push(`<div class="resumo"><b>Resumo</b><br>${e(summaryText(totals))}</div>`);
  parts.push(
    `<div class="kpis">${[
      tile(formatBytes(totals.separatedBytes), 'separado nesta pasta, para você apagar'),
      tile(formatBytes(totals.freedBytes), 'apagado direto (regenerável)'),
      tile(String(totals.branchesDeleted), 'branches apagadas, com recibo'),
      tile(String(totals.worktreesRemoved), 'worktrees removidas'),
      tile(String(totals.kept), 'itens deixados de lado de propósito', totals.kept > 0),
    ].join('')}</div>`,
  );
  if (review !== '') parts.push(`<h2>Nesta pasta, para você revisar e apagar</h2>\n${review}`);
  if (resolved !== '') parts.push(`<h2>Já resolvido, só para registro</h2>\n${resolved}`);
  if (left !== '') parts.push(`<h2>Deixado de lado de propósito</h2>\n${left}`);
  if (failures !== '') parts.push(`<h2>Com problema</h2>\n${failures}`);
  parts.push(`<p class="mut">Gerado em ${e(formatDate(generatedAt))}. O Donel nunca apaga esta pasta: apague à mão o que quiser, quando quiser.</p>`);
  parts.push('</main></body></html>');
  return parts.filter((part) => part !== '').join('\n');
}
