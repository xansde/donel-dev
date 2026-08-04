// Skill `e2e-visual` — gera o relatório HTML a partir do manifesto que a
// captura deixou. Um arquivo só, com os prints embutidos: abre com duplo
// clique, viaja por anexo, não depende de servidor nem de pasta ao lado.
//
//   node .claude/skills/e2e-visual/lib/relatorio.mjs <roteiro> [--titulo "…"]
//
// O relatório não decide nada: ele desenha o que o roteiro registrou. Passo sem
// print é passo que não aconteceu — e roteiro que morreu no meio aparece com o
// passo e o motivo, em vez de sumir.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SAIDA_RAIZ = process.env.E2E_VISUAL_OUT ?? path.join(REPO_ROOT, '.e2e-visual');

const [, , roteiroArg, ...rest] = process.argv;
const tituloIndex = rest.indexOf('--titulo');
const tituloCustom = tituloIndex >= 0 ? rest[tituloIndex + 1] : null;

// Sem argumento, gera para TODOS os roteiros que deixaram manifesto. Assim
// acrescentar um roteiro novo não exige tocar no `package.json` — o ato é
// "escrever o roteiro", e o resto se vira.
const roteiros = roteiroArg
  ? [roteiroArg]
  : existsSync(SAIDA_RAIZ)
    ? readdirSync(SAIDA_RAIZ).filter((nome) => existsSync(path.join(SAIDA_RAIZ, nome, 'manifest.json')))
    : [];

if (roteiros.length === 0) {
  console.error(`nenhum roteiro capturado em ${SAIDA_RAIZ} — rode os roteiros antes`);
  process.exit(2);
}

for (const roteiro of roteiros) gerar(roteiro);

function gerar(roteiro) {
const dir = path.join(SAIDA_RAIZ, roteiro);
const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

const dataUri = (arquivo) => `data:image/png;base64,${readFileSync(path.join(dir, arquivo)).toString('base64')}`;

const escape = (texto) =>
  String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const orfaos = readdirSync(dir)
  .filter((nome) => nome.endsWith('.png'))
  .filter((nome) => !manifest.passos.some((passo) => passo.arquivo === nome));

const quando = new Date(manifest.geradoEm).toLocaleString('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const passosHtml = manifest.passos
  .map(
    (passo) => `
      <article class="passo" id="passo-${passo.n}">
        <div class="passo-head">
          <span class="passo-num">${String(passo.n).padStart(2, '0')}</span>
          <h2>${escape(passo.titulo)}</h2>
          <div class="corpo">
            ${passo.nota ? `<p>${escape(passo.nota)}</p>` : ''}
            <figure>
              <img src="${dataUri(passo.arquivo)}" alt="${escape(passo.titulo)}" loading="lazy" />
              ${passo.alvo ? `<figcaption>Circulado: <strong>${escape(passo.alvo)}</strong></figcaption>` : ''}
            </figure>
          </div>
        </div>
      </article>`,
  )
  .join('\n');

const falhaHtml = manifest.falha
  ? `<div class="falha">
       <h3>O roteiro parou no passo ${manifest.falha.passo || '—'}</h3>
       <pre>${escape(manifest.falha.mensagem)}</pre>
       <p>Os passos acima aconteceram. Deste ponto em diante, nada foi verificado.</p>
     </div>`
  : '';

const orfaosHtml = orfaos.length
  ? `<p class="aviso">${orfaos.length} print(s) sem passo no manifesto: ${orfaos.map(escape).join(', ')}. Provavelmente o roteiro morreu entre a foto e o registro.</p>`
  : '';

const html = `<!doctype html>
<html lang="pt-BR" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(tituloCustom ?? `e2e visual — ${manifest.roteiro}`)}</title>
<style>
  /* Paleta dos tokens do próprio app (design-system/src/tokens.css): o
     relatório e a tela que ele mostra são o mesmo objeto. */
  :root {
    --ink: #dbe2ec; --ink-soft: #98a5b8; --ink-faint: #6d7a8c;
    --ground: #0e1116; --panel: #151a21; --rule: #262f3b;
    --accent: #6fb0f5; --alarm: #f0846a; --ok: #58c898;
    --font-body: ui-sans-serif, "Segoe UI", -apple-system, system-ui, sans-serif;
    --font-mono: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    --measure: 62ch;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --ink: #131820; --ink-soft: #4a5666; --ink-faint: #78859a;
      --ground: #f4f6f9; --panel: #ffffff; --rule: #dde3ec;
      --accent: #2b6fc4; --alarm: #c8452a; --ok: #1f7a52;
    }
  }
  :root[data-theme="light"] {
    --ink: #131820; --ink-soft: #4a5666; --ink-faint: #78859a;
    --ground: #f4f6f9; --panel: #ffffff; --rule: #dde3ec;
    --accent: #2b6fc4; --alarm: #c8452a; --ok: #1f7a52;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font-family: var(--font-body); font-size: 16px; line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 3rem 1.5rem 5rem; display: flex; flex-direction: column; gap: 3rem; }
  header { display: flex; flex-direction: column; gap: .75rem; padding-bottom: 1.75rem; border-bottom: 1px solid var(--rule); }
  .eyebrow { font-family: var(--font-mono); font-size: .75rem; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); }
  h1 { margin: 0; font-size: clamp(1.8rem, 1.3rem + 2vw, 2.5rem); line-height: 1.15; letter-spacing: -.02em; font-weight: 640; text-wrap: balance; }
  .resumo { display: flex; flex-wrap: wrap; gap: 1.5rem; font-family: var(--font-mono); font-size: .8rem; color: var(--ink-faint); }
  .resumo strong { color: var(--ink); font-weight: 600; }
  .passos { display: flex; flex-direction: column; gap: 3rem; }
  .passo-head { display: grid; grid-template-columns: auto 1fr; gap: 0 1rem; align-items: baseline; }
  .passo-num { font-family: var(--font-mono); font-size: .8rem; font-weight: 600; color: var(--accent); letter-spacing: .08em; }
  .passo h2 { grid-column: 2; margin: 0; font-size: 1.3rem; line-height: 1.25; font-weight: 620; letter-spacing: -.01em; text-wrap: balance; }
  .corpo { grid-column: 2; display: flex; flex-direction: column; gap: .7rem; margin-top: .5rem; }
  .corpo p { margin: 0; max-width: var(--measure); color: var(--ink-soft); }
  figure { margin: 0; display: flex; flex-direction: column; gap: .5rem; }
  figure img { display: block; width: 100%; height: auto; border: 1px solid var(--rule); border-radius: 8px; background: #0e1116; }
  figcaption { font-family: var(--font-mono); font-size: .76rem; color: var(--ink-faint); }
  .falha { border-left: 3px solid var(--alarm); background: var(--panel); padding: 1rem 1.15rem; border-radius: 0 6px 6px 0; display: flex; flex-direction: column; gap: .5rem; }
  .falha h3 { margin: 0; font-size: .95rem; color: var(--alarm); }
  .falha p { margin: 0; color: var(--ink-soft); max-width: var(--measure); }
  .falha pre { margin: 0; overflow-x: auto; font-family: var(--font-mono); font-size: .8rem; color: var(--ink); background: var(--ground); padding: .75rem; border-radius: 6px; }
  .aviso { color: var(--alarm); font-family: var(--font-mono); font-size: .8rem; }
  .ok-linha { color: var(--ok); }
  @media (max-width: 640px) {
    .passo-head { grid-template-columns: 1fr; }
    .passo h2, .corpo { grid-column: 1; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <span class="eyebrow">Donel Dev · e2e visual · ${escape(manifest.roteiro)}</span>
      <h1>${escape(tituloCustom ?? 'O que a tela mostrou')}</h1>
      <div class="resumo">
        <span><strong>${manifest.passos.length}</strong> passos</span>
        <span>rodado em <strong>${escape(quando)}</strong></span>
        <span class="${manifest.falha ? '' : 'ok-linha'}">${manifest.falha ? 'interrompido' : 'roteiro completo'}</span>
      </div>
      ${orfaosHtml}
    </header>

    <div class="passos">
      ${passosHtml}
    </div>

    ${falhaHtml}
  </div>
</body>
</html>
`;

const destino = path.join(dir, 'relatorio.html');
writeFileSync(destino, html, 'utf8');
console.log(`${destino} — ${manifest.passos.length} passo(s), ${(html.length / 1024 / 1024).toFixed(2)} MB${manifest.falha ? ' (roteiro interrompido)' : ''}`);
}
