# Convivência com a 010 em voo

Type: grilling
Status: resolved
Blocked by: 01

## Question

A 010 (Esteira do Donel) está em dogfooding no alfa e toca arquivos do main
process. Qual é a ordem de entrega entre as duas frentes e as fronteiras de
arquivo (quem espera quem, o que pode andar em paralelo sem recriar o
desencontro de contrato que originou a 010)?

## Answer

Sequenciamento aprovado pelo Alexandre (04/08):

1. **Especificar já, implementar depois**: o `/speckit.specify` de Contas &
   Provedores roda imediatamente; o CÓDIGO só começa quando os batches da 010
   fecharem em staging (dois refactors simultâneos em `index.ts` recriariam o
   desencontro que originou a 010).
2. **Fronteiras**: Contas & Provedores não toca `esteira-*`; a 010 não toca
   perfil/quota/credenciais; `openPhaseSession`/`commandBuilder` pertencem a
   Contas & Provedores — e a v1 não precisa mudá-los (classe A = mesmo binário
   `claude`; classe B vazia; Modo Dev segue Claude-only). Único arquivo de
   risco compartilhado: `src/main/index.ts`.
3. **Ordem interna da implementação**: (1) motor + mod Seazone → (2) demolição
   de perfis + migração → (3) registry classe A + OpenRouter. Cada etapa
   entregável e testável sozinha.
