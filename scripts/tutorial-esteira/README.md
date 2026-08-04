# Captura do tutorial da Esteira

Roteiro que dirige o app buildado, circula o alvo de cada passo e fotografa.
Serve para dois fins: gerar o tutorial e — como se descobriu no caminho —
**olhar a tela**, que é onde os erros deste vertical aparecem.

```powershell
npm run build
npx playwright test -c scripts/tutorial-esteira/playwright.config.ts
```

Os PNGs saem em `.tutorial-shots/` (ignorado pelo git — saída regenerável).
Roda isolado: `--user-data-dir` temporário e
`DONEL_ESTEIRA_{STORE,INBOX,OUTBOX}_DIR` em `tmpdir`. Nada toca o histórico
real da máquina.

---

## Registro das iterações (2026-08-03)

| # | O que quebrou | Causa | Correção |
|---|---|---|---|
| 1 | Clique interceptado por `_overlay_…` | Ligar o Modo Dev abre sozinho o modal "Abrir discovery" do modelo antigo | `Escape` antes de capturar |
| 2 | Locator do card não achado após a ingestão | O emissor declarava o título **sem acentos**, e `discovery.created` faz upsert: o card foi renomeado no meio do roteiro | Mesmo texto dos dois lados |
| 3 | Print mostrou `discovery — em andamento` para fase não assumida | `phaseLine` não recebeu a correção que `lockView` já tinha | `phaseLines(card)` cruza fase × sessão |
| 4 | Print mostrou a trava presa depois da fase concluída | O app dependia da skill declarar `lock.released` | `phase.completed`/`phase.failed` liberam no reducer |

## Os erros que se repetem

**1. A mesma palavra errada, em dois lugares diferentes.** "Em andamento"
apareceu duas vezes para um estado que não começou: primeiro no bloco da trava,
depois na lista de fases. Consertar a frase onde ela aparece, sem consertar a
função que a produz, garante a terceira aparição. A correção certa desce até
quem calcula o texto — e leva teste junto.

**2. Estado que só sai por gesto de terceiro.** A trava dependia de a skill
declarar `lock.released`. Skill que morre no meio deixa o card preso para
sempre — a *trava órfã* que a divergência D-V3 proibia, reaparecendo por
omissão em vez de por arquivo. Todo estado que prende precisa de uma saída que
não dependa de quem pode sumir.

**3. Buscar por um texto que o próprio fluxo muda.** Vale para roteiro de
teste e para código: âncora estável (id, testid) em vez de conteúdo variável.

## O padrão acima dos padrões

**Nenhum dos quatro foi pego por teste.** A suíte estava verde em todas as
iterações — 1.447 casos — enquanto a tela dizia que uma fase não iniciada
estava em andamento e mantinha um card travado sem saída. Foram os PRINTS que
mostraram.

É exatamente o que o handoff da fase 1 avisava: *"as duas tentativas anteriores
de consertar o mapa passaram nos testes e falharam na tela dele"*. Aconteceu de
novo, agora comigo.

Daí a recomendação: **rodar esta captura como parte da verificação**, não só
quando alguém pedir um tutorial. Ela custa 3 segundos e olha o que o `npm test`
estruturalmente não olha — a frase que a tela escolhe para cada estado.
