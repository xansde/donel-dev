# Entregador do Oráculo à parte: implantação e volta (passo 9, t-5358d400)

Desenho: opção B do passo 9 (o registro fica sozinho no `donel-oraculo`; o portão das sessões, os recados e o chat do
celular vão para o `donel-entregador`). Este é o roteiro que o `scripts/oraculo-vps.sh separar|juntar` executa.

## O que cada unidade roda

| Unidade | Portas | Arquivos que só ela grava |
|---|---|---|
| `donel-oraculo` (registro) | 47816 (PC, serviços, Homologação), 47818 (servidor do celular, atrás do 47815) | `ledger.sqlite`, `fila.json`, `celular.json`, `celular-local.json` (decisões e tarefas pedidas) |
| `donel-entregador` (`DONEL_ORACULO_MODO=entregador`) | 47817 (portão das sessões), 47815 (chat do celular; o resto vai por proxy à 47818) | `recados.json`, `retrato.json`, `avisos-pendentes.json`, `chat-local.json` |

A separação liga e desliga pela marca `~/.donel/oraculo/entregador.separado`. **Sem a marca, o `donel-oraculo` sobe
tudo num processo, como antes**, e o systemd nem sobe o entregador (`ConditionPathExists`).

## Antes

1. PRs 1 a 4 do passo 9 na `staging`; clone em dia.
2. `scripts/oraculo-vps.sh atualizar` com a marca ausente (o bundle novo roda como hoje). Conferir `ss -ltnp`: as
   mesmas 4 escutas, um pid. Esperar algumas horas.
3. Combinar com o dono um horário sem conversa no celular e avisar o Líder único: a virada dá ~30 s sem chat e sem
   registro.

## `separar`

O script recusa se a marca já existe ou se o bundle em `~/.donel/oraculo/bin/oraculo.mjs` não conhece a separação.

1. Credencial do portão `vps-pessoal` (reusada se o token já confere com o sha256): token em
   `~/.donel/portoes/vps-pessoal.token`, cópia em `~/.donel/oraculo/portao.token` (de onde o entregador lê) e a marca
   `portoes/vps-pessoal.local` (só esse portão leva o Líder único; o da Homologação segue recusando).
2. `systemctl --user stop donel-oraculo`.
3. `oraculo.mjs --separar-chat`: as mensagens do chat vão para `chat-local.json`; o original fica como
   `celular-local.json.antes-separar-<hora>`. Se falhar, o `donel-oraculo` volta como estava e nada mais muda.
4. `touch entregador.separado`.
5. Grava `~/.config/systemd/user/donel-entregador.service`: o mesmo `ExecStart` e o mesmo `DONEL_ORACULO_DIR`,
   `DONEL_ORACULO_MODO=entregador`, `Restart=always`, `RestartSec=15`, `UMask=0077`,
   `ConditionPathExists=<dir>/entregador.separado`.
6. `start donel-oraculo` (47816 e 47818), depois `enable --now donel-entregador` (47815 e 47817).

## Conferência

- `ss -ltnp`: 47816 e 47818 num pid, 47815 e 47817 noutro (`scripts/oraculo-vps.sh status` mostra).
- `lsof ~/.donel/oraculo/ledger.sqlite`: só o pid do `donel-oraculo`.
- Uma `tarefa_criar` de uma sessão da VPS; um recado entre sessões; ida e volta de uma mensagem do celular; um
  `tarefa_ver` da Homologação; o PC recebendo eventos.
- Depois, o critério do passo 9 (parar cada unidade 5 min) e a prova na tarefa.

## Volta: `juntar`

1. `systemctl --user disable --now donel-entregador`.
2. `systemctl --user stop donel-oraculo` (o `--juntar-chat` recusa com qualquer um dos dois no ar).
3. `oraculo.mjs --juntar-chat`: as mensagens novas voltam a `celular-local.json` (mesmo id = a cópia nova, nunca
   duas). Se falhar, as duas unidades sobem de novo, separadas, e nada mais muda.
4. `rm entregador.separado portoes/vps-pessoal.local` (a credencial fica, para separar de novo).
5. `systemctl --user start donel-oraculo`: tudo num processo, como antes.

Só depois disso, se o bundle estiver ruim, `scripts/oraculo-vps.sh voltar` ou reverter os PRs. A ordem importa: um
bundle antigo com o entregador no ar briga pelas portas 47815/47817 e fica reiniciando sem registro. Por isso o
`voltar` recusa enquanto a marca existir.

Com a marca, `atualizar` reinicia as duas unidades (o mesmo bundle) e `parar` desliga as duas. Homologação e crontab
não mudam: o satélite segue em `100.110.135.26:47816`.
