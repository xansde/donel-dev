# Renovação de token e guarda de segredos no modo pool próprio

Type: grilling
Status: resolved
Blocked by: 02

## Question

No cenário pós-Seazone (pool próprio, sem servidor deles): quem renova o
refresh token de uso único, onde essa credencial vive, e como o Donel armazena
segredos de provider (padrão T3: secret no lado servidor, nunca ecoado à UI)
sem violar a regra "o app nunca lê, grava ou exibe credenciais" — a renovação
local é uma exceção consciente à regra, uma delegação ao CLI, ou um serviço
separado?

## Answer

Decidido com o Alexandre (04/08):

1. **Motor de contas vira interface; cada backend é um MOD do Donel** —
   arquitetura de mods nasce aqui. Dois mods concretos: **mod Seazone** (fala
   com a API deles: list/switch/heartbeat; nunca renova token; nenhum segredo
   além do token de sessão do switcher) e **mod local / pool próprio** (o
   "servidorzinho" solo: cofre, carga por conta, troca).
2. **A exceção à regra "o app nunca lê credenciais" fica CONFINADA no mod
   local**, atrás de fronteira nomeada — o core do Donel continua nunca
   tocando credencial. A emenda à regra entra na spec citando o módulo.
3. **Cofre**: `safeStorage` do Electron (criptografia do SO), nunca arquivo
   plano; segredo nunca ecoado à UI (padrão T3: write-only).
4. **Switch-time-only, sem heartbeat**: no switch, captura o par rotacionado
   da conta que sai e grava no cofre; escreve o par da que entra + apaga
   `oauthAccount` do `~/.claude.json`; refresh HTTP local (mesma chamada do
   `anthropic_client.py`, client_id público) SÓ como fallback de token vencido
   na hora do switch. Consequência aceita: conta meses sem uso pode expirar e
   pedir re-login uma vez. Nenhum processo periódico mexe em credencial com o
   app fechado.
5. **Carga por conta no mod local**: endpoint de uso OAuth
   (`api.anthropic.com/api/oauth/usage`, janelas 5h/7d diretas) com o token de
   cada conta — sem npx/quota-axi no caminho quente.
6. Guard-rails da conversa: interface extraída dos dois mods concretos (nada
   de framework genérico antes do 3º mod real); mods nascem IN-REPO (módulos
   TS do main process, escolhidos por config) — mod externo carregável é névoa
   futura, com sandbox pensado, nunca de graça.
