// Serviço Donel sem tela (ADR 0008) — um bundle Node só, sem Electron, para a
// VPS pessoal. Fica fora do `out/` do app para não entrar no instalador.
import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/servico/main.ts',
    outDir: 'out-servico',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
      output: { entryFileNames: 'donel-servico.mjs', format: 'es' },
    },
  },
  ssr: { noExternal: true },
});
