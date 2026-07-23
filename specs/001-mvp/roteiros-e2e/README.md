# Roteiros E2E — Donel Dev MVP (P0)

Roteiros de validação **manual** para o Alexandre executar do lado dele e
confirmar que cada batch da esteira funciona de verdade — a automação
(vitest + smoke Playwright em `tests/`) já garante correção de módulos
isolados; estes roteiros cobrem o que só um humano rodando o app real
percebe (login concorrente, qualidade de terminal, empacotamento, jornada
completa).

Fontes: [`spec.md`](../spec.md) (critérios de aceite CA-1..CA-6, FRs),
[`tasks.md`](../tasks.md) (DoD por task), [`ui-spec.md`](../ui-spec.md)
(telas), [`spike-t001-resultado.md`](../spike-t001-resultado.md) e
[`spike-t002-resultado.md`](../spike-t002-resultado.md) (o que a automação
já provou vs. o que ficou "Não verificado").

## Índice

| Batch | Arquivo | Tempo estimado | Estado |
|---|---|---|---|
| 1 — Spikes (perfis + semáforo) | [batch-1-spikes-perfis-semaforo.md](batch-1-spikes-perfis-semaforo.md) | ~20 min | ✅ pronto para validar |
| 2 — Fundação (terminal + spawn) | [batch-2-fundacao-terminal.md](batch-2-fundacao-terminal.md) | ~25 min | ✅ pronto para validar |
| 3 — Cockpit (sidebar, launcher, semáforo, abas) | [batch-3-cockpit-sidebar-launcher-semaforo.md](batch-3-cockpit-sidebar-launcher-semaforo.md) | ~40 min | 🚧 em implementação — aguardar conclusão |
| 4 — Sessões anteriores + Perfis | [batch-4-sessoes-perfis.md](batch-4-sessoes-perfis.md) | ~30 min | ⏳ aguardando implementação |
| 5 — Acabamento + Empacotamento + Smoke final | [batch-5-acabamento-empacotamento-smoke.md](batch-5-acabamento-empacotamento-smoke.md) | ~50 min | ⏳ aguardando implementação |

Tempos são estimativas de execução manual atenta (não incluem tempo de
espera de build/instalação).

## Como usar

1. Rode os roteiros **na ordem dos batches** — batch 4 depende do gate
   humano do batch 1 (login real concorrente); batch 5 repete parte dos
   critérios de aceite (CA-1..CA-6) dentro da jornada completa, então
   validar 1-3 primeiro evita retrabalho de diagnóstico.
2. Cada roteiro tem checkboxes `- [ ]` por passo — marque ao validar.
3. Se um passo falhar, a seção "Se falhar" de cada roteiro aponta o
   módulo/arquivo provável para investigar.
4. Passos que abrem sessões `claude` reais indicam explicitamente o uso de
   `--model haiku`/prompt trivial para não queimar cota das contas
   compartilhadas.
5. Nenhum roteiro pede para digitar credencial fora do fluxo oficial
   `/login` do CLI — se algum passo parecer pedir isso, é uma falha de
   segurança do app, não um passo válido do roteiro.

## Convenções

- **"(confirmar na implementação)"** marca um passo que não pôde ser
  verificado com segurança neste roteiro (ex.: exige quebrar
  deliberadamente o executável numa máquina de produção) — não bloqueia a
  aprovação do batch, mas deve ficar registrado como pendente.
- Passos repetidos entre batches (ex.: CA-1 aparece no batch 3 e de novo
  no batch 5) são intencionais — o batch 3 valida a feature isolada, o
  batch 5 valida que ela sobrevive à jornada completa/empacotamento.
