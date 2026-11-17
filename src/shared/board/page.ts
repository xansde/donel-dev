// Quadro de tarefas (t-1e354d15), PR 3 — the page the cron writes to the VPS's deliveries folder every round: the
// overview (one line per project, by id) and, below, one table per project grouped by front. Pure: it gets the rows of
// the views `board.overview` and `board.project_cards` and returns a self-contained HTML (no script, no external file).

import { STAGES, STAGE_LABELS, type Stage } from './rules';

export interface OverviewRow {
  readonly project_id: string;
  readonly name: string;
  readonly host: string;
  readonly inbox: number;
  readonly todo: number;
  readonly doing: number;
  readonly blocked: number;
  readonly waiting_owner: number;
  readonly done: number;
  readonly overdue: number;
  readonly last_change: string | null;
}

export interface PageCard {
  readonly id: string;
  readonly project_id: string;
  readonly front: string | null;
  readonly title: string;
  readonly stage: Stage;
  readonly stage_since: string;
  readonly note: string | null;
  readonly place_id: string | null;
  readonly justification: string | null;
  readonly justification_link: string | null;
  readonly justification_due: string | null;
  readonly due: string | null;
}

const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const when = (iso: string | null, tz: string): string =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const safeLink = (link: string | null): string | null => (link && /^https?:\/\/\S+$/.test(link) ? link : null);

export function renderBoardPage(overview: readonly OverviewRow[], cards: readonly PageCard[], now: number, tz = 'America/Sao_Paulo'): string {
  const rows = overview
    .filter((p) => p.inbox + p.todo + p.doing + p.blocked + p.waiting_owner + p.done > 0)
    .map(
      (p) => `<tr><td><a href="#${esc(p.project_id)}">${esc(p.project_id)}</a><div class="sub">${esc(p.name)} · ${esc(p.host)}</div></td>${STAGES.map(
        (s) => `<td class="n${p[s] ? '' : ' zero'}${s === 'waiting_owner' && p[s] ? ' you' : ''}">${p[s]}</td>`,
      ).join('')}<td class="n${p.overdue ? ' late' : ' zero'}">${p.overdue}</td></tr>`,
    )
    .join('\n');

  const byProject = new Map<string, PageCard[]>();
  for (const card of cards) byProject.set(card.project_id, [...(byProject.get(card.project_id) ?? []), card]);
  const sections = [...byProject]
    .map(([project, list]) => {
      const fronts = new Map<string, PageCard[]>();
      for (const card of list) fronts.set(card.front ?? 'Sem frente', [...(fronts.get(card.front ?? 'Sem frente') ?? []), card]);
      const groups = [...fronts]
        .map(
          ([front, items]) => `<h3>${esc(front)}</h3><div class="cards">${items
            .map((c) => {
              const link = safeLink(c.justification_link);
              const why = c.justification
                ? `<div class="why">parado: ${esc(c.justification)}${link ? ` · <a href="${esc(link)}">link</a>` : ''} · até ${esc(when(c.justification_due, tz))}</div>`
                : '';
              return `<div class="card"><div class="tag s-${c.stage}">${esc(STAGE_LABELS[c.stage])}</div><div class="main"><div class="title">${esc(c.title)}</div>${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}${why}</div><div class="who">${esc(c.place_id ?? '')}<div class="sub">desde ${esc(when(c.stage_since, tz))} · <span class="id">${esc(c.id)}</span></div></div></div>`;
            })
            .join('\n')}</div>`,
        )
        .join('\n');
      return `<section id="${esc(project)}"><h2>${esc(project)}</h2>${groups}</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="300"><title>Quadro de tarefas</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--mute:#6b6a65;--line:#e4e1d8;--you:#b4441c;--late:#a1261c;--chip:#efece4}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--mute:#9a988f;--line:#2e2d29;--you:#f08a5d;--late:#f07167;--chip:#26251f}}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.45 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px}
h1{font-size:26px;margin:8px 0 2px}h2{font-size:21px;margin:28px 0 4px;border-top:1px solid var(--line);padding-top:16px}h3{font-size:16px;color:var(--mute);margin:14px 0 4px}
.sub,.note,.why{color:var(--mute);font-size:14px}.why{color:var(--late)}
table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:13px;color:var(--mute);font-weight:600}.n{text-align:center;font-variant-numeric:tabular-nums}.zero{color:var(--mute);opacity:.5}
.you{color:var(--you);font-weight:700}.late{color:var(--late);font-weight:700}.id{font-family:ui-monospace,monospace;font-size:12px;color:var(--mute);white-space:nowrap}
.tag{justify-self:start;padding:1px 8px;border-radius:10px;background:var(--chip);font-size:13px;white-space:nowrap}
.card{display:grid;grid-template-columns:130px minmax(0,1fr) 220px;gap:4px 12px;padding:8px 0;border-bottom:1px solid var(--line);align-items:start}
.title{font-weight:500}.main,.who{min-width:0;overflow-wrap:anywhere}
@media (max-width:640px){.card{grid-template-columns:minmax(0,1fr)}.who{font-size:13px}}
.s-waiting_owner{color:var(--you);font-weight:700}.s-blocked{color:var(--late)}.who{font-size:14px}
.wrap{overflow-x:auto}a{color:inherit}
</style></head><body><main>
<h1>Quadro de tarefas</h1><div class="sub">Atualizado ${esc(when(new Date(now).toISOString(), tz))} · a cada 15 min</div>
<h2>Quadro geral</h2><div class="wrap"><table><thead><tr><th>Projeto</th>${STAGES.map((s) => `<th class="n">${esc(STAGE_LABELS[s])}</th>`).join('')}<th class="n">Prazo vencido</th></tr></thead><tbody>
${rows || `<tr><td colspan="${STAGES.length + 2}" class="sub">Nenhum cartão ainda.</td></tr>`}
</tbody></table></div>
${sections}
</main></body></html>
`;
}
