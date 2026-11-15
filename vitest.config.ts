// T006 — config mínima do vitest para os módulos puros de src/shared
// (ver plan.md: "TDD com escopo" — CommandBuilder/SessionIndexer/perfis).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `.test.mjs` cobre os scripts standalone de `scripts/` (ex.:
    // esteira-custo-fase.mjs) — eles rodam via `node` puro, sem passar pelo
    // build TS, então o teste também é JS puro (fora do grafo do `tsc`).
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs', 'scripts/claude-guard/**/*.test.mjs'],
    environment: 'node',
  },
});
