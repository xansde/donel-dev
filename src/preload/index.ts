// Scaffold T003 — preload vazio, só a ponte de contexto isolada. A API real
// `window.donel.*` (canais IPC pty:*/projects:*/sessions:*/profiles:*/config:*,
// plan.md "Arquitetura de processos") chega junto do PtyManager em T004+.
//
// contextIsolation: true + sem nodeIntegration (src/main/index.ts) — este
// arquivo é o único ponto por onde o renderer pode, no futuro, alcançar o
// main process.
