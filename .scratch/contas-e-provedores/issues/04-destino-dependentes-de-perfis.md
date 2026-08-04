# Destino de cada dependente de perfis

Type: grilling
Status: resolved
Blocked by: 01

## Question

Para cada dependente inventariado no ticket 01 — dropdown de headroom (spec
002, entregue), `profile-manager`, rótulos de conta por sessão, smoke de
perfis, e os itens de backlog B8/US-12 (painel de cotas), B10 (userData por
canal) e auto-switch — qual é o destino no mundo switcher: morre, migra para o
motor de contas, ou reaponta (ex.: perfis viram isolamento de providers
externos, como no T3)?

## Answer

Decidido com o Alexandre (04/08) — tabela de destinos aprovada integralmente:

| Dependente | Destino |
|---|---|
| `profile-manager` + junctions + doctor/repair + 4 suítes | **Morre inteiro** — provider externo usa diretório comum para `CLAUDE_CONFIG_DIR`, junction nunca foi necessária |
| Dropdown de headroom (spec 002) | **Vira a UI do motor de contas** (lista do mod ativo, duas janelas direto do endpoint OAuth) |
| `sessionAccountLabel` | **Muda de fonte**: conta ativa no momento do disparo, gravada como fato da sessão |
| B8/US-12 painel de cotas | **Absorvido no motor** (tela do pool = painel); sai do backlog |
| auto-switch (P1) | **Absorvido no motor** (política 90/20 do ticket 03); sai do backlog |
| B10 userData por canal | **Fica e simplifica** (sem junctions entre canais) |
| Spec 002 + histórico 001 (spikes T001/T002, análise switch-account) | **Registro histórico**; a spec nova declara supersede |
