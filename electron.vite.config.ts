import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * 015-jobu-pet (T028): the click test of the pet reads the alpha of the art from a canvas, and a
 * `file://` page treats every file as another origin, so a PNG served as a file would make the canvas
 * unreadable. The poses are inlined as `data:` URIs (same origin by definition); every other asset
 * keeps the default limit. New art is one more PNG in that folder.
 *
 * It is a plugin and not `renderer.build.assetsInlineLimit` because the types of electron-vite
 * (`RendererBuildOptions`) assume the Environment API of vite 6+ and do not know that option under the
 * vite 5 this repo pins: the same reason as the note below about `rollupOptions`.
 */
function inlinePetArt(): Plugin {
  return {
    name: 'donel:inline-pet-art',
    config: () => ({
      build: {
        assetsInlineLimit: (filePath: string) => (/\/src\/pet\/assets\/poses\//.test(filePath.replace(/\\/g, '/')) ? true : undefined),
      },
    }),
  };
}

/**
 * B33 — the commit this build came from, so the app can tell whether the installers folder holds a newer one.
 * `DONEL_BUILD_COMMIT` wins (a build outside git); without git or env it is `null` and the update stays quiet.
 */
function buildCommit(): string | null {
  const fromEnv = process.env.DONEL_BUILD_COMMIT?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim() || null;
  } catch {
    return null;
  }
}

// Sem `build.rollupOptions.input` explícito: electron-vite resolve por
// convenção `src/main/index.ts`, `src/preload/index.ts` e
// `src/renderer/index.html` — exatamente a estrutura alvo do plan.md
// ("Estrutura do repositório"). Especificar rollupOptions aqui quebra o
// typecheck com electron-vite 5.0.0 + vite 5.x (tipos do pacote assumem a
// Environment API do vite 6+; a build em si roda igual, só o `tsc --noEmit`
// falha) — e usar vite 6/7 no app quebraria o build do `design-system`
// (Storybook 8 fixa vite ^3–^6 e o workspace deixaria de compartilhar uma
// única instalação de vite, gerando dois tipos `Plugin` incompatíveis).
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-updater'] })],
    define: {
      __DONEL_BUILD_COMMIT__: JSON.stringify(buildCommit()),
      __DONEL_BUILT_AT__: JSON.stringify(Date.now()),
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), inlinePetArt()],
  },
});
