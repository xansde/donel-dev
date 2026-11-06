---
name: Contas das VPS sem o PC
type: adr
status: accepted (itens 1 e 4 substituídos pelo ADR 0009)
created: 2026-11-05
updated: 2026-11-06
tags: [adr, contas, credenciais, vps, servico, 011-contas-e-provedores]
aliases: [ADR-0008, serviço da VPS, conjunto de contas das VPS, switcher sem o PC]
---

# ADR 0008: Contas das VPS sem o PC

> **Emendado em 06/11 pelo [ADR 0009](0009-um-motor-de-contas-por-vps.md):**
> "cada VPS deve ter sua própria ferramenta de troca de conta". O motor deixa
> de ser um só, na VPS pessoal, e passa a rodar em cada VPS, só com a conta
> dela. Nos itens 1 e 4 abaixo, vale o que está no 0009.

Sucede em parte o [ADR 0005](0005-contas-em-lugares-remotos.md). O contrato do
lugar remoto continua o mesmo. O que muda é **quem** o chama.

## Contexto

Pelo ADR 0005, o motor de contas do PC controla o `~/.claude` das VPS por ssh.
Em 05/11/2026 isso falhou de dois jeitos:

1. **PC desligado = VPS parada na conta cheia.** Fora do horário do PC, ninguém
   troca nada.
2. **A VPS de Homologações não trocou nem com o PC ligado.** Ela ficou na Conta
   8 a 98% da semana. O diagnóstico está em
   `docs/handoffs/2026-11-05-switcher-remoto.md` (branch `fix/switcher-remoto`):
   - Causa 1: o PC pegou a única conta livre antes da VPS.
   - Causa 2: com o par copiado vencido, a carga da conta da VPS fica
     desconhecida, e a troca automática nunca dispara.

Palavras do dono em 05/11/2026:

> "O VPS pessoal também deve ser autonomo sem depender do meu pc ligado hein.
> E o oráculo deve migrar pra lá também."

> "Quero ela com o switcher e tudo." / "Ela não pode ficar parada."

> "Prefiro preferência no meu pc, amigão."

O Líder repassou a primeira frase como o OK literal que o handoff pedia para
abrir um segundo perímetro de credencial. A terceira frase decide quem escolhe
primeiro.

## Decisão

1. **Um segundo lugar com credenciais: o serviço Donel na VPS pessoal.** É um
   processo Node sem tela (`donel-servico`), por systemd, com `Restart=always`.
   Ele roda o **mesmo** `AccountEngine`, o mesmo mod local, a mesma política
   (troca a 90%, folga de 20) e a mesma ordem invariante de troca
   (`claude-state.ts`; do outro lado do ssh, `remote-claude-state.ts`). O código
   fica em `src/main/accounts/servico/`, dentro do perímetro de sempre. A
   exceção de credencial não ganha um módulo novo, ganha um segundo processo.
2. **Conjuntos de contas separados.** O PC tem as contas dele, e as VPS têm o
   conjunto delas, no cofre da VPS (`~/.donel/accounts-vault.json`). Uma conta
   pertence a um só conjunto. Nenhum refresh token existe nos dois cofres.
   Passar uma conta de um conjunto para o outro é um gesto explícito do dono
   (passo a passo em `docs/servico-vps.md`).
3. **O PC tem a preferência.** As contas que o PC usa continuam dele. O serviço
   da VPS nunca pega conta do PC sozinho. Quando houver uma conta para dividir,
   o PC escolhe primeiro. Por isso o PR #245 (que punha a VPS antes do PC no
   motor do PC) **não entra**. No motor do PC, a ordem segue: esta máquina
   primeiro, lugares depois.
4. **Dentro do conjunto das VPS, Homologações escolhe primeiro.** No serviço, a
   "esta máquina" é a VPS pessoal e Homologações é um lugar remoto. A opção
   `remotePlacesFirst` (só no serviço) avalia os lugares antes, porque
   Homologações é a que menos pode parar.
5. **Carga cega vira cheia (Causa 2).** Se a carga da conta de um lugar fica
   desconhecida por 10 minutos, ela conta como cheia na decisão daquele lugar,
   **desde que** exista candidata com carga conhecida. Isso não vale para lugar
   sem ssh. A regra está no motor, então também vale no PC.
6. **Cifra do cofre sem Electron.** AES-256-GCM, com uma chave de 32 bytes
   cifrada pelo systemd do host (`/etc/donel/vault-key.cred`,
   `LoadCredentialEncrypted`). Ela só chega ao processo do serviço. Sem chave, o
   cofre recusa gravar e nunca cai para texto plano. O fallback `~/.donel/vault.key`
   (0600) existe só para rodar à mão e para teste.
7. **Comandos do dono por socket local.** `donel-servico estado | contas ... |
   lugar ...` falam com o processo por `~/.donel/servico.sock`, numa pasta 0700.
   Pedido e resposta levam pasta, rótulo, lugar e id. Nunca levam par. O
   cadastro é por login isolado **na VPS** (`CLAUDE_CONFIG_DIR` numa pasta
   própria). Depois o serviço colhe o par para o cofre e apaga o
   `.credentials.json` da pasta. Nunca `/logout`, porque ele revoga o token.
8. **Fora da V1:** pool Seazone nas VPS (posse e heartbeat são por máquina), o
   PC como painel do serviço, o gesto de mover conta pelo app, e o aviso de
   "todas cheias" no Oráculo. Cada um vira uma fatia.

## Consequências

- Com o PC desligado, as VPS trocam de conta sozinhas, 24h.
- A Causa 1 some por construção: o PC e as VPS não disputam mais a mesma conta.
- Para a troca chegar a Homologações, a VPS pessoal precisa de ssh até ela. Hoje
  a política da tailnet recusa esse acesso, e liberar é passo do dono.
- O `CLAUDE.md` (seção Credenciais) ganha a emenda que cita este ADR.
- Enquanto o dono não fizer a passagem, nada muda: o serviço sobe sem contas e
  não toca em nenhum `~/.claude`. O PC segue dono dos lugares que já tem.
