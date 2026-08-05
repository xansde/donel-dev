Type: task
Status: open

# Sanitize com passthrough no config.json compartilhado (canal antigo apaga chave nova)

Achado da validação manual e2e da etapa 2 (011, `wi-demolicao-perfis-migracao`,
2026-08-04 — BF-1 da fase Validar, **desclassificado de bloqueante pelo dono**:
cenário de gatilho era artificial, três canais abertos porque a validação
rodava num canal enquanto o teste rodava em outro; corrigir no futuro).

## O problema

Os canais instalados (alfa/beta/stable/dev) compartilham o mesmo `userData`
(decisão de 2026-07-28) e cada um reescreve o `config.json` **inteiro** a
partir da sua cópia em memória:

1. **Sanitize sem passthrough**: chave que o canal não conhece (ex.:
   `migration`, da etapa 2) é dropada na primeira gravação de um canal antigo.
2. **Last-writer-wins sem merge**: chave que ambos conhecem (ex.:
   `accounts.localAccounts`) volta ao estado velho da cópia em memória do
   outro canal.

Reprodução real: MigrationWizard rodado no dev com alfa+beta abertos — as 8
credenciais chegaram ao cofre (`accounts-vault.json`), mas o persist de outro
canal apagou `migration` e zerou `localAccounts`. As 8 entradas ficaram
**órfãs** (payload cifrado não guarda label; inatribuíveis). Agravante:
`generateAccountId` é `randomUUID()` por import — reimportar duplica entradas
no cofre em vez de reaproveitar.

## Correção proposta (decidir na hora de implementar)

- **(a) Passthrough + read-merge-write** (correção de verdade, mata o item de
  produto pendente do CLAUDE.md): sanitize preserva chaves desconhecidas;
  gravação relê o arquivo e faz merge da própria fatia em vez de despejar a
  cópia inteira da memória.
- **(b) Guarda de instância única na migração** (paliativo focado): o wizard
  detecta outra instância viva no mesmo `userData` e recusa rodar.
- Em qualquer caminho: tornar o import idempotente (accountId determinístico
  por slug/credencial, ou reconciliar com entradas existentes) e definir
  limpeza/reaproveitamento de entradas órfãs do cofre.

## Estado da máquina do dono (2026-08-04)

- 8 entradas órfãs no cofre (UUIDs, sem label) — limpar antes de refazer a
  migração real.
- `~/.claude-profiles` intacto (nenhum arquivamento rodou); backup em
  `~/.claude-profiles.backup-2026-08-04`.

## Referências

- `tasks/lessons.md`, seção 2026-08-04 (commit 855bbf7) — narrativa completa.
- `.esteira/validar/handoffs/wi-demolicao-perfis-migracao/validar-result.json`
  — manifesto da fase que registrou o achado.
- `CLAUDE.md` → riscos aceitos da coexistência de canais ("sanitize com
  passthrough", item de produto).
- Relacionado: B10 do `specs/backlog.md` (userData por canal) — o isolamento
  completo também resolveria, por outro ângulo.
