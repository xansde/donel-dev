// Quadro de tarefas (t-1e354d15) — the board cron of the VPS, one self-contained Node file
// (`out/board-cron/board-cron.mjs`), copied to ~/.donel/board/bin/ on the VPS. No Electron, no
// dependency from node_modules.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: resolve(__dirname, 'src/board-cron/main.ts'),
    outDir: 'out/board-cron',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'board-cron.mjs' } },
  },
  ssr: { noExternal: true },
});
