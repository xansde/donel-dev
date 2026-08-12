# Bancada — protótipo do mapa de grafos

Código descartável do item `wi-esteira4-mapa-grafos-prototipo`. Renderiza o
MESMO grafo (`.esteira/plano/pln-esteira4-catalogo-e-grafo/grafo-mesa.json`)
em 3 abordagens node-based diferentes, lado a lado, para o dono comparar e
decidir qual entra no Modo Dev de verdade.

Não faz parte de `src/` do app — não é buildado, empacotado nem versionado
como produto. Fica fora do escopo de `design-system/` (só lê `tokens.css`).

## Abas

- **A — React Flow retrabalhado**: `@xyflow/react` v12 + auto-layout `elkjs`.
- **B — Cytoscape.js**: `cytoscape` + `cytoscape-dagre`.
- **C — Reaflow**: `reaflow` com layout automático nativo.

## Como rodar

```bash
cd prototypes/mapa-grafos
npm install
npm run dev       # abre a bancada em modo dev
npm test          # roda os testes do adapter (vitest)
npm run typecheck # tsc --noEmit
npm run build     # build de produção — usado só para medir o peso de cada lib
```

## Critérios de avaliação

Ver a régua fixa na coluna direita da UI (mesma em toda aba): Identifica,
Navega, Bonito, Auto-layout, Integração, Peso. Anotações por aba salvam em
`localStorage`.
