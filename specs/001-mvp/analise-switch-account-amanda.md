# Análise — switch_account.py (Amanda Gois) × perfis do Donel Dev

> **SUPERSEDED (2026-08-04, C32 — 011-contas-e-provedores, etapa 2).** O
> mecanismo de perfis (`~/.claude-profiles`, `CLAUDE_CONFIG_DIR` por perfil,
> dropdown `ProfileSwitcher`) descrito abaixo foi DEMOLIDO na etapa 2 da 011
> (T1222/T1225): o único caminho de conta hoje é o motor
> (`src/main/accounts/`), documentado em `specs/011-contas-e-provedores/`.
> Marcação apenas — nada abaixo foi apagado ou reescrito (mesma regra do
> `backlog.md`, itens riscados com nota, nunca deletados).


**Data:** 2026-07-23 · **Método:** análise estática multi-lente (mecanismo /
confronto / adversarial), script NUNCA executado. Fonte: `switch_account.zip`
no Drive (link na thread Slack #C0AMDQTDFGF, ts 1784558098). Insumo direto da
spec `002-auto-switch`.

## Como o script realmente funciona (com linhas)

1. **Mede uso real via API oficial**: `GET api.anthropic.com/api/oauth/usage`
   com o access token local (L82–94), score = max(`five_hour`, `seven_day`,
   `weekly_scoped`) (L114–127); dispara quando ≥ `THRESHOLD` (env, default 90).
2. **Pool de contas em Supabase compartilhado** (`monitor_geral_accounts`,
   com `access_token`/`refresh_token` em texto; uso cacheado em
   `monitor_geral_usage_latest` por processo externo "monitorador-geral"):
   filtra prefixo `tecnologia.claude`, exclui tag `"exclusiva"` e a conta
   atual; escolhe a de MENOR uso (L153–181).
3. **Troca = sobrescrever `~/.claude/.credentials.json` in-place** (merge do
   bloco `claudeAiOauth`, backup timestampado em texto plano no mesmo dir,
   `chmod 600`, escrita NÃO atômica; L184–194, L260–264). Não toca
   `~/.claude.json`; ZERO referências a `CLAUDE_CONFIG_DIR`.
4. Execução única (sem loop) — agendada por cron EXTERNO; lock via `fcntl`
   (**POSIX-only: o script não roda em Windows como está**, L12).

## "Troca no meio da sessão viva?" — INDETERMINADO

O script não interage com nenhum processo `claude` (sem subprocess/kill/IPC
em 272 linhas) — só troca o arquivo. Se uma sessão viva passa a usar a conta
nova depende de o CLI reler `.credentials.json` em runtime: o binário tem
infra de file-watching e 98 refs a `accessToken` (sugestivo, inconclusivo).
Protocolo de experimento controlado (com backup/restauração e conta de
teste) documentado no dossiê adversarial — NÃO executado. Efeito colateral
objetivo: quando troca, troca A MÁQUINA INTEIRA (todas as sessões da conta
global), o que é incompatível com N sessões simultâneas em N contas — o
caso central do Donel Dev.

## Correções às alegações do orquestrador (auditoria adversarial)

- A1 **PARCIAL**: o script faz mesmo swap do `.credentials.json` global; mas
  "só é possível assim" era exagero — `CLAUDE_CONFIG_DIR` e `claude auth
  login` por diretório são alternativas nativas.
- A2 **EM ABERTO**: "CLI pode cachear token em memória" segue não provado.
- A3 **PARCIAL**: resume cross-perfil funciona NO DONEL DEV porque o
  ProfileManager cria `projects/` como junction compartilhada (transcripts
  visíveis de todos os perfis) — mas não vale para um config dir avulso sem
  junction, e o fluxo nunca foi validado empiricamente (entra como spike da
  spec 002).

## O que ABSORVER na spec 002-auto-switch

- Algoritmo de escolha: score = max das janelas de uso; menor score vence
  (L169–181) — aplicado aos perfis locais via quota-axi/HeadroomCache.
- Limiar configurável de alerta (conceito do `THRESHOLD`).
- Tag de exclusão por perfil ("exclusiva" → perfil não-elegível pra
  auto-seleção).
- Padrão "avisar quando a automação não conseguiu agir" (nenhuma conta
  alternativa / todas no limite → notificação explícita).
- Avaliar complementar o quota-axi com o endpoint oficial de uso OAuth
  (dado ao vivo five_hour/seven_day por conta).

## O que NÃO absorver (fato, não opinião)

- Swap in-place de `.credentials.json`: viola a regra escrita do projeto
  ("o app NUNCA lê/grava credenciais", CLAUDE.md) e o modelo de N sessões
  em N contas.
- Pool central de tokens em Supabase: blast radius alto; sem requisito no
  produto (perfis são contas do próprio usuário na própria máquina).
- Lock `fcntl` (não-portável) e `expiresAt` estimado em 8h fixas (limitação
  confessa do próprio script).
