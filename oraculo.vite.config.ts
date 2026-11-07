// Oráculo na VPS (docs/planos/oraculo-na-vps.md) — the headless daemon, one self-contained Node file
// (`out/oraculo/oraculo.mjs`) that scripts/oraculo-vps.sh copies to the VPS's own folder. No Electron, no
// dependency from node_modules: only the ledger code the app already uses.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: resolve(__dirname, 'src/oraculo/main.ts'),
    outDir: 'out/oraculo',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'oraculo.mjs' } },
  },
  ssr: { noExternal: true },
});
