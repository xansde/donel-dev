# Lessons learned — donel-dev

Registro append-only de trade-offs e decisões que custaram análise. Uma seção
por fase/entrega; nunca reescrever entrada antiga.

## 2026-08-04 — pln-motor-contas-mods (motor-contas-mods)

### Refresh token de uso único proíbe clonar o heartbeat

A tentação era portar o `daemon.py` do claude-switcher inteiro para o main
process — heartbeat de 15 min renovando tokens, igual ao original. O research
mostrou que o refresh acontece no **servidor** deles e que existe ainda um
monitor externo coordenado por `refresh_owner`/`token_version`. Como o refresh
token da Anthropic é de **uso único**, um segundo renovador local queimaria o
par debaixo do primeiro. A alternativa rejeitada (clone do heartbeat) foi
trocada por **switch-time-only**: renova só na hora do switch, só como
fallback, e só para contas próprias. Custo aceito: conta parada meses pede
re-login uma vez.

**Lesson:** antes de clonar um mecanismo de renovação de credencial, descubra
QUEM mais renova aquele mesmo par — com refresh token de uso único, dois
renovadores não coexistem, e o segundo é sempre o que quebra.

### Interface extraída de dois mods, não projetada antes deles

Havia espaço para desenhar um framework de mods (loader, manifesto, sandbox)
antes de existir qualquer backend. Rejeitado: a interface nasce com exatamente
os quatro membros que os dois mods concretos exigem, e o motor escolhe entre
dois construtores com um `switch`. Corolário que só apareceu no plano: com **um
mod só** não há de onde extrair — a interface sairia sendo a API da Seazone com
outro nome, exatamente o acoplamento que a frente existe para evitar. Foi o que
obrigou o mod local a entrar na mesma etapa do mod Seazone.

**Lesson:** "extrair a interface de N implementações" implica entregar as N
juntas — cortar a etapa em uma implementação só transforma a abstração no
formato do primeiro backend.

### A escrita de credencial mora fora dos mods

O caminho óbvio era cada mod escrever `.credentials.json` e limpar
`oauthAccount`. Rejeitado: a sequência é uma invariante de correção (inverter a
ordem perde o par rotacionado da conta que sai) e duplicá-la por mod garante
que o terceiro mod a implemente errado. `switchTo()` passou a **devolver** o
par; a escrita ficou num módulo só, com o teste da ordem num lugar só.

**Lesson:** quando uma sequência de passos é invariante de correção, ela é
responsabilidade do orquestrador — plugin que a reimplementa é bug esperando
o próximo plugin.

### Motor inerte por default destrava a etapa

A etapa 1 convive com perfis vivos e com a 010 em voo. Em vez de sequenciar por
espera, o motor nasce desligado (`accounts.mod = null`): sem mod configurado, o
comportamento é byte a byte o de hoje. Isso torna a etapa mergeável e
reversível por config, sem depender da demolição de perfis.

**Lesson:** feature que substitui um mecanismo vivo entra desligada por config
— assim ela pode ser integrada e testada em dogfooding antes de o mecanismo
antigo morrer.
