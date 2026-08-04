import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';

// Skill `e2e-visual` — a biblioteca dos roteiros. Ela dá três coisas ao roteiro:
//
//   1. um app ISOLADO (userData e diretórios da esteira em tmpdir), para o e2e
//      nunca escrever no estado real da máquina;
//   2. `passo()`, que circula o alvo e fotografa;
//   3. um manifesto — é dele que o relatório HTML nasce, sem template por
//      roteiro.
//
// Por que existe: os defeitos deste app aparecem na TELA, não no `npm test`.
// Em 03/08, quatro bugs de estado/vocabulário passaram por 1.447 testes verdes
// e morreram no primeiro print. O roteiro descreve o passo em português; a
// captura registra; o relatório desenha.

export interface PassoManifest {
  readonly n: number;
  readonly arquivo: string;
  readonly titulo: string;
  readonly nota: string | null;
  /** O que estava circulado, para quem lê o relatório sem ver o código. */
  readonly alvo: string | null;
  readonly at: string;
}

export interface Manifest {
  roteiro: string;
  geradoEm: string;
  passos: PassoManifest[];
  /** Preenchido quando o roteiro morre no meio — o relatório mostra até onde foi. */
  falha: { readonly passo: number; readonly mensagem: string } | null;
}

export interface RoteiroContexto {
  readonly app: ElectronApplication;
  readonly win: Page;
  /** Raiz temporária com `inbox/`, `outbox/` e `store/` da esteira. */
  readonly esteiraRoot: string;
  readonly userDataDir: string;
  readonly saidaDir: string;
  /**
   * Circula o alvo e fotografa. `alvo: null` fotografa a tela inteira, sem anel
   * — use para "olha como ficou", não para "clique aqui".
   */
  passo(titulo: string, alvo: Locator | null, nota?: string): Promise<void>;
  /** Registra que o roteiro morreu aqui. O relatório mostra o passo e o motivo. */
  registraFalha(mensagem: string): void;
}

export interface AbrirOptions {
  /** Nome do roteiro — vira a pasta de saída e o título do relatório. */
  readonly roteiro: string;
  /** Env extra para o app (fixtures de board, overrides de path). */
  readonly env?: Record<string, string>;
  readonly viewport?: { readonly width: number; readonly height: number };
}

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const APP_MAIN = path.join(REPO_ROOT, 'out', 'main', 'index.js');
const SAIDA_RAIZ = process.env.E2E_VISUAL_OUT ?? path.join(REPO_ROOT, '.e2e-visual');

/** Abre o app isolado e devolve o contexto do roteiro. */
export async function abrirDonel(options: AbrirOptions): Promise<RoteiroContexto> {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), `donel-e2e-${options.roteiro}-ud-`));
  const esteiraRoot = mkdtempSync(path.join(os.tmpdir(), `donel-e2e-${options.roteiro}-`));
  mkdirSync(path.join(esteiraRoot, 'inbox'), { recursive: true });
  mkdirSync(path.join(esteiraRoot, 'outbox'), { recursive: true });

  const saidaDir = path.join(SAIDA_RAIZ, options.roteiro);
  rmSync(saidaDir, { recursive: true, force: true });
  mkdirSync(saidaDir, { recursive: true });

  const app = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      // O app nunca toca o histórico real durante um e2e.
      DONEL_ESTEIRA_STORE_DIR: path.join(esteiraRoot, 'store'),
      DONEL_ESTEIRA_INBOX_DIR: path.join(esteiraRoot, 'inbox'),
      DONEL_ESTEIRA_OUTBOX_DIR: path.join(esteiraRoot, 'outbox'),
      ...options.env,
    },
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.setViewportSize(options.viewport ?? { width: 1400, height: 860 });

  const manifest: Manifest = { roteiro: options.roteiro, geradoEm: new Date().toISOString(), passos: [], falha: null };

  function grava(): void {
    writeFileSync(path.join(saidaDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  }

  async function passo(titulo: string, alvo: Locator | null, nota?: string): Promise<void> {
    const n = manifest.passos.length + 1;
    const arquivo = `${String(n).padStart(2, '0')}.png`;
    let descricaoAlvo: string | null = null;

    if (alvo !== null) {
      const box = await alvo.first().boundingBox();
      if (box === null) throw new Error(`passo ${n} ("${titulo}"): o alvo não está na tela`);
      // Só a primeira linha, curta: a legenda diz O QUE foi circulado, não
      // reproduz o conteúdo — um comando longo estoura a linha do relatório.
      const texto = (await alvo.first().innerText().catch(() => ''))?.trim().split('\n')[0] ?? '';
      descricaoAlvo = texto.length === 0 ? null : texto.length > 72 ? `${texto.slice(0, 72)}…` : texto;

      // O anel é um elemento REAL, posicionado pelo bounding box — não uma
      // anotação chutada por cima da imagem depois.
      await win.evaluate(
        ({ x, y, width, height }) => {
          const ring = document.createElement('div');
          ring.id = '__e2e_ring__';
          Object.assign(ring.style, {
            position: 'fixed',
            left: `${x - 10}px`,
            top: `${y - 10}px`,
            width: `${width + 20}px`,
            height: `${height + 20}px`,
            border: '3px solid #f0684c',
            borderRadius: `${Math.min(width, height) > 60 ? 12 : 999}px`,
            boxShadow: '0 0 0 4px rgba(240,104,76,0.22), 0 0 22px rgba(240,104,76,0.5)',
            pointerEvents: 'none',
            zIndex: '9999',
          });
          document.body.appendChild(ring);
        },
        { x: box.x, y: box.y, width: box.width, height: box.height },
      );
    }

    await win.screenshot({ path: path.join(saidaDir, arquivo) });
    await win.evaluate(() => document.getElementById('__e2e_ring__')?.remove());

    manifest.passos.push({ n, arquivo, titulo, nota: nota ?? null, alvo: descricaoAlvo, at: new Date().toISOString() });
    grava();
  }

  function registraFalha(mensagem: string): void {
    manifest.falha = { passo: manifest.passos.length, mensagem };
    grava();
  }

  grava();
  return { app, win, esteiraRoot, userDataDir, saidaDir, passo, registraFalha };
}

/** Fecha o app e apaga os temporários. A saída (prints + manifesto) fica. */
export async function fecharDonel(ctx: RoteiroContexto): Promise<void> {
  await ctx.app?.close();
  rmSync(ctx.userDataDir, { recursive: true, force: true });
  rmSync(ctx.esteiraRoot, { recursive: true, force: true });
}

/**
 * Fecha a porta de entrada do Modo Dev antigo. Ela abre sozinha ao ligar o modo
 * e — além de cobrir a tela — mostra os CARDS REAIS do board, que não podem
 * vazar num relatório. Todo roteiro que liga o Modo Dev chama isto.
 */
export async function fecharPortaDeEntrada(win: Page): Promise<void> {
  await win.keyboard.press('Escape');
  await win
    .locator('div[class*="overlay"]')
    .first()
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => undefined);
}

export { REPO_ROOT, SAIDA_RAIZ };
