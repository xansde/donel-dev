// Livro F5 + F7 — relatório das simulações (docs/planos/ledger-bom.md). Só lê: a lista do dia (saída de
// `tarefa_listar` com "todos": true e "situacao": "todas") e uma cópia v4 do ledger.json. Não grava em ledger nenhum;
// o único arquivo escrito é o relatório (--saida), e o script confere que as entradas saíram intactas.
//
//   npx vite-node scripts/livro-simular.ts -- --lista ~/seazone/_scratch/ledger-2026-11-08.json \
//     --copia ~/seazone/_scratch/ledger-copia-2026-11-07.json [--agora 2026-11-09T01:30:00Z] [--saida relatorio.md]

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLedgerDoc, type LedgerDoc } from '../src/shared/ledger/contract';
import { simularFaxina, type FaxinaView } from '../src/shared/ledger/faxina-simulada';
import { repeatGroups, type PedidoView, type RepeatGroup } from '../src/shared/ledger/repetidas';
import { copyInstant, pedidosFromLedger, viewsFromListing } from '../src/shared/ledger/simulacao-entrada';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const listaPath = arg('lista');
const copiaPath = arg('copia');
if (!listaPath || !copiaPath) {
  console.error('uso: livro-simular --lista <tarefa_listar.json> --copia <ledger.json v4> [--agora ISO] [--saida arquivo.md]');
  process.exit(2);
}
const now = arg('agora') ? Date.parse(arg('agora')!) : Date.now();
const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const before = { lista: sha(listaPath), copia: sha(copiaPath) };

const listing = JSON.parse(readFileSync(listaPath, 'utf8')) as { faixa?: Record<string, unknown> };
const copyRaw = JSON.parse(readFileSync(copiaPath, 'utf8')) as unknown;
const copy: LedgerDoc | null = parseLedgerDoc(copyRaw);
if (!copy) throw new Error('A cópia não é um ledger.json v4 legível.');

const cell = (text: string, max = 70): string => {
  const line = text.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
const iso = (at: number | null): string => (at === null ? '?' : new Date(at).toISOString().slice(0, 16).replace('T', ' '));
const boardName = (board: string | null): string => (board === null ? '(desconhecido)' : board.split(/[\\/]/).at(-1) ?? board);

const out: string[] = [];
const say = (line = ''): void => {
  out.push(line);
};

// --- F5 -----------------------------------------------------------------------------------------------------------
const views = viewsFromListing(listing, copy);
const faxina = simularFaxina(views, { now });
const byId = new Map(views.map((view) => [view.id, view]));
const c = faxina.contagens;

say(`# Livro — simulação da faxina (F5) e dos pedidos repetidos (F7)`);
say();
say(`Gerado em ${new Date().toISOString()} · "agora" da simulação: ${new Date(now).toISOString()}. **Nada foi gravado**: só leitura das entradas abaixo.`);
say();
say(`- Lista do dia: \`${listaPath}\` (sha256 ${before.lista.slice(0, 16)}…), ${views.length} tarefas.`);
say(`- Cópia v4: \`${copiaPath}\` (sha256 ${before.copia.slice(0, 16)}…), ${Object.keys(copy.tasks).length} tarefas, último movimento ${iso(copyInstant(copy))} UTC.`);
say(`- Tarefas da lista que não estão na cópia (nasceram depois dela; quadro e data de criação desconhecidos): ${views.filter((v) => v.board === null).length}.`);
say();
say(`## F5 — faxina por lançamento`);
say();
say(`### Contagens`);
say();
say(`| | hoje (esta lista) | faixa do Oráculo nesta lista | plano (08/11 21:10) |`);
say(`|---|---|---|---|`);
say(`| órfãs | ${c.orfas} | ${String(listing.faixa?.orfas ?? '?')} | 83 |`);
say(`| abertas | ${c.abertas} | ${String(listing.faixa?.abertas ?? '?')} | 74 |`);
say(`| entregues sem decisão | ${c.entregues} | ${String(listing.faixa?.entreguesSemDecisao ?? '?')} | — |`);
say();
say(`Soma: ${c.orfas} órfãs + ${c.entreguesParadas} entregues paradas + ${c.abertasVelhas} abertas velhas (dono vivo) = **${faxina.propostas.length} destinos propostos**; ficam ${faxina.ficam.length} (${c.entreguesRecentes} entregues recentes, ${c.abertasRecentes} abertas recentes).`);
say(`Abertas: ${c.abertas} = ${c.abertasOrfas} órfãs + ${c.abertasVelhas} velhas + ${c.abertasRecentes} recentes. Entregues: ${c.entregues} = ${c.entreguesParadas} paradas + ${c.entreguesRecentes} recentes.`);
say();
const tally = new Map<string, number>();
for (const p of faxina.propostas) tally.set(`${p.categoria} → ${p.destino}`, (tally.get(`${p.categoria} → ${p.destino}`) ?? 0) + 1);
say(`| categoria → destino | tarefas |`);
say(`|---|---|`);
for (const [key, n] of [...tally].sort()) say(`| ${key} | ${n} |`);
say();
say(`Sem o Mindscape e as sessões vivas do dia, "o primeiro vivo acima" não é conhecido: a órfã que não se junta nem se arquiva volta ao Líder do quadro. Ligada de verdade (T4), a faxina recebe o quadro e repassa pela regra de hoje.`);
say();
say(`### Cada item`);
say();
say(`| tarefa | título ou pedido | quadro | estado | risco | categoria | destino | para | motivo |`);
say(`|---|---|---|---|---|---|---|---|---|`);
for (const p of faxina.propostas) {
  const v = byId.get(p.id)!;
  say(`| ${p.id} | ${cell(v.title ?? v.request, 60)} | ${boardName(v.board)} | ${v.state} | ${v.risk} | ${p.categoria} | ${p.destino} | ${p.para || '—'} | ${cell(p.motivo, 140)} |`);
}
say();
say(`### Ficam como estão`);
say();
say(`| tarefa | título ou pedido | motivo |`);
say(`|---|---|---|`);
for (const f of faxina.ficam) say(`| ${f.id} | ${cell(byId.get(f.id)!.title ?? byId.get(f.id)!.request, 60)} | ${f.motivo} |`);
say();

// --- F7 -----------------------------------------------------------------------------------------------------------
function groupReport(title: string, items: readonly (PedidoView & { readonly title?: string; readonly closed?: boolean })[], groups: readonly RepeatGroup[]): void {
  const item = new Map(items.map((i) => [i.id, i]));
  const total = groups.reduce((n, g) => n + 1 + g.children.length, 0);
  const sizes = new Map<number, number>();
  for (const g of groups) sizes.set(g.children.length + 1, (sizes.get(g.children.length + 1) ?? 0) + 1);
  say(`### ${title}`);
  say();
  say(`**${groups.length} grupos, ${total} tarefas** (${[...sizes].sort((a, b) => a[0] - b[0]).map(([size, n]) => `${n}× de ${size}`).join(', ')}); ${groups.filter((g) => g.sameText).length} com o texto inteiro igual, ${groups.filter((g) => !g.sameText).length} só com o começo igual.`);
  say();
  const fives = groups.filter((g) => g.children.length + 1 === 5);
  if (fives.length) {
    say(`Pedidos repetidos 5 vezes: ${fives.map((g) => `${g.root} (raiz) + ${g.children.length} filhas`).join('; ')}.`);
    say();
  }
  say(`| raiz proposta | criada | quadro | pedido | filhas | texto |`);
  say(`|---|---|---|---|---|---|`);
  for (const g of [...groups].sort((a, b) => b.children.length - a.children.length || a.root.localeCompare(b.root))) {
    const root = item.get(g.root)!;
    say(`| ${g.root} | ${iso(root.createdAt)} | ${boardName(g.board)} | ${cell(root.title ?? root.request, 70)} | ${g.children.join(', ')} | ${g.sameText ? 'igual' : 'começo igual'} |`);
  }
  say();
}

say(`## F7 — pedidos repetidos e tarefa-pai`);
say();
say(`Mesmo pedido = os primeiros 240 caracteres iguais depois de normalizar (caixa, acento, pontuação), no mesmo quadro, até 72 h depois da raiz; a raiz é a mais antiga. Juntar seria o lançamento \`agrupar\` da F9.`);
say();
const copyPedidos = pedidosFromLedger(copy);
groupReport('Sobre a cópia v4', copyPedidos, repeatGroups(copyPedidos));
const viewGroups = repeatGroups(views as readonly FaxinaView[]);
groupReport('Sobre a lista do dia (tarefas novas sem quadro conhecido entram no grupo do mesmo texto)', views, viewGroups);

const after = { lista: sha(listaPath), copia: sha(copiaPath) };
say(`## Conferência`);
say();
say(`Entradas intactas depois da simulação: lista ${after.lista === before.lista ? 'igual' : 'MUDOU'}, cópia ${after.copia === before.copia ? 'igual' : 'MUDOU'}. Lançamentos propostos (não gravados): ${faxina.propostas.length}.`);

const report = `${out.join('\n')}\n`;
const saida = arg('saida');
if (saida) writeFileSync(saida, report);
else process.stdout.write(report);
if (after.lista !== before.lista || after.copia !== before.copia) process.exit(1);
