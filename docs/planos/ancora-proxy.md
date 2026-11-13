# Âncora do proxy: qual PC de casa as VPS usam para sair

**Pedido do dono (08/11, noite), literal:** "Sobr eo proxy, eu tenho dois pcs em casa. Quero deixar um ligado 24/7 e
poder definir, de alguma maneria, qual PC será a âncora do proxy".

**Regra que não muda:** fechamento em falha. Sem âncora, as VPS param o tráfego do Claude e nunca saem pelo IP da
nuvem (#336, já na staging).

**Efeito:** o dono escolhe no app qual dos dois PCs é a âncora, troca quando quiser, e as duas VPS passam a sair por
ela. O PC que fica desligado deixa de fazer falta.

## 1. Levantamento (08/11, 20h40, feito da VPS de homologações)

### Como as VPS apontam para o PC hoje

| O quê | Onde | Aponta para |
|---|---|---|
| Relay do proxy (`donel-proxy-saida.service`, 127.0.0.1:3128) | `~/.config/donel-proxy-saida/vps.json`, campo `upstream` (host, porta, usuário, senha) | `100.76.108.30:3128`, o IP da Tailscale do **seazone173**, usuário `donel-vps` |
| Sessões do Claude | `~/.donel/proxy-saida.env`, lido pelo `claude.sh` de cada sessão | `HTTPS_PROXY=127.0.0.1:3128`, o relay |
| Chamadas de modelo | `~/.donel/claude-gateway.env` e o `settings.json` (`ANTHROPIC_BASE_URL`) | `http://seazone173.tail8629f1.ts.net:8317`, o gateway CLIProxyAPI **no seazone173**, pela Tailscale e fora do relay (`NO_PROXY`) |
| Gateway da VPS (`cliproxyapi.service`, 100.117.181.15:8327) | `/etc/cliproxyapi/config.yaml` | sai pelo relay, portanto pela âncora. **Hoje sem login válido** (`/v1/models` vazio, skill `atualizar-gateway-cliproxy`) |
| Porta local `claude-front` (127.0.0.1:8316) | `front.mjs` | tenta o gateway da VPS primeiro e repete no do PC |

A VPS pessoal tem o mesmo relay e o mesmo upstream (skill `proxy-saida-fechado`, nota de 08/11). Se ela também aponta
o `ANTHROPIC_BASE_URL` para o seazone173, **não verifiquei**: daqui o ssh até ela trava.

**O nome seazone173 está fixo em dois lugares por VPS** (o upstream do relay e a URL do gateway). Desligar o seazone173
hoje para tudo o que é do Claude nas VPS: o relay recusa (503, como deve ser) e as chamadas de modelo não acham o
gateway.

### Na rede

`tailscale status` mostra **um PC Windows só** na tailnet: o `seazone173` (ativo, saída direta `186.236.19.220`). O
segundo PC ainda não está nela. Pela âncora atual, a saída é `186.236.19.220` (conferido com `curl -x` no relay);
direto da VPS, seria `20.114.48.171` (Azure).

### O que o segundo PC precisa ter

1. **Tailscale** na mesma conta (`xansde`), com "Run unattended" ligado (sem isso a Tailscale cai quando ninguém está
   logado no Windows) e com a expiração da chave desligada para esse aparelho.
2. **Node LTS** (o proxy é um arquivo `.mjs` sem dependência).
3. **O proxy em modo PC** (`scripts/proxy-saida/instalar-pc.ps1`): escuta só no IP da Tailscale dele, aceita só
   clientes da tailnet e só abre túnel para Anthropic/Claude, com o mesmo usuário e **a mesma senha** do seazone173.
   Com a mesma senha, nenhuma senha nova precisa viajar até as VPS: elas só aprendem um endereço novo.
   - A senha está no item "Donel proxy de saida (PC)" do cofre do dono (o instalador do seazone173 a guardou com
     `-SoBitwarden`). Falta ao instalador um `-SenhaDoCofre`, que a lê de lá em vez de gerar outra. Esse trabalho é
     meu.
4. **Ligado 24/7 de verdade:** energia em "nunca suspender". A tarefa agendada de hoje sobe só **no logon**, e no PC
   24/7 ela precisa subir **na inicialização**, sem ninguém logado. O instalador ganha `-NaInicializacao` (tarefa
   como SYSTEM; pede PowerShell de administrador uma vez).
5. **Túnel:** nenhum além da Tailscale. As VPS chegam ao PC pelo IP da tailnet; nada de porta aberta no roteador.

### Mesmo IP de casa?

Se os dois PCs estão na mesma rede de casa (mesmo roteador e mesmo provedor), saem pelo mesmo IP público
(`186.236.19.220` hoje). **Não dá para conferir antes de o segundo PC entrar na tailnet.** Depois, a conferência é
automática: a VPS pede `api.ipify.org` pela âncora candidata (o único destino fora da Anthropic que o proxy do PC
aceita é justamente esse) e compara com o IP da âncora atual. IP diferente vira aviso, e a troca pede confirmação.

### Ferramentas que dependem do IP de casa

O proxy do PC só aceita Anthropic/Claude, então o que o IP de casa protege é isto:

- **As contas do Claude** (CLI das sessões, renovação de token, `claude.ai`, `mcp-proxy.anthropic.com`): o motivo do
  #336 ("se não algumas ferramentas minhas caem"). Uma conta vista ora de um IP de datacenter, ora de casa, é o padrão
  que o dono quer evitar.
- **Os logins dos gateways CLIProxyAPI** (PC e VPS): cada um renova os próprios tokens e sai pelo IP de quem o roda.
- git, npm e os MCP da Seazone **não** passam pelo PC (decisão de 06/11) e não dependem da âncora.

Se alguma outra ferramenta do dono olha o IP (algum serviço com lista de IP liberado), **não está no repo**. A
pergunta fica em aberto, mas não muda o desenho: com o mesmo IP público, qualquer âncora serve.

### O gateway de contas acompanha a âncora?

**Sim, no efeito; não, no lugar.** Se o seazone173 for o PC que desliga, as chamadas de modelo param com ele, mesmo
com a âncora no outro PC. Há dois jeitos de resolver:

- **(recomendado) O modelo vai pelo gateway da VPS** (8327, pela porta local 8316), que já sai pelo relay e portanto
  **segue a âncora sozinho**. Nada de gateway no segundo PC. Depende do login das contas no gateway da VPS, que é a
  frente do `cadastrar-conta` (VPS pessoal), não desta.
- Um CLIProxyAPI no segundo PC com **logins próprios** (token de renovação é de uso único: nunca copiar o arquivo de
  login entre máquinas). A URL do gateway nas VPS trocaria junto com a âncora. É mais peça para o dono cuidar.

Até o gateway da VPS ter login, **o seazone173 não pode desligar**, seja qual for a âncora. Esse é o ponto que a carta
precisa deixar claro.

## 2. Desenho

### Nas VPS (relay)

`vps.json` ganha uma lista de âncoras e a escolhida. Uma só senha, a mesma de hoje:

```json
{
  "modo": "vps",
  "porta": 3128,
  "ancoras": {
    "seazone173": { "host": "100.76.108.30", "porta": 3128 },
    "pc-24h":     { "host": "100.x.y.z",     "porta": 3128 }
  },
  "ancora": "pc-24h",
  "credencial": { "usuario": "donel-vps", "senha": "…" },
  "log": "~/.donel/proxy-saida.log",
  "estado": "~/.donel/proxy-saida.estado.json"
}
```

- Config antiga (`upstream`) continua valendo, como âncora única.
- `ancora` ausente ou fora da lista: o relay **recusa** a lista do Claude (503) e grava `sem-ancora` no log. Nunca
  escolhe outra sozinho, nunca vai direto.
- Sem troca automática entre PCs na V1: a âncora é a que o dono escolheu. Quando ela cai, as VPS param, e o app
  mostra o aviso com o botão de trocar (um clique do dono).

### No app (PC)

- Lê de cada VPS, por ssh, **só** `ancoras` (nome, host, porta), `ancora` e o estado do relay, nunca a senha.
- "Tornar âncora": para cada VPS, (1) testa a candidata pela própria VPS (`curl -x` até `api.ipify.org` passando por
  ela) e compara o IP com o da âncora atual; (2) grava `ancora` com compare-and-swap; (3) reinicia o relay;
  (4) confere o IP de saída. Uma VPS que falha fica parada (fechamento em falha) e aparece assim na tela.
- "Acrescentar PC": entra só com nome e IP da Tailscale (a lista vem da tailnet). A senha já está nas VPS.

### Testes (regra de testes enxutos)

- O relay com `ancora` ausente, desconhecida ou fora do ar dá 503 e nunca sai direto (estende o teste do #336).
- O script de troca grava `ancora` só se o valor lido ainda é o esperado, e nunca toca a credencial.

## 3. Protótipo

`docs/prototipos/ancora-proxy/index.html`: três jeitos de escolher e trocar a âncora, com o switcher no rodapé (← →).

- **A. Uma linha em Preferências:** um select "Âncora do proxy" com o estado de cada VPS embaixo.
- **B. Mapa das máquinas:** os PCs lado a lado, cada um com o caminho até as VPS desenhado, e "Tornar âncora" no
  cartão.
- **C. Chip na barra de status:** "Âncora: seazone173 ●", com um popover para trocar e a faixa vermelha quando a
  âncora cai.

A escolha é do dono. A recomendação vai na carta.

## 4. Ordem de entrega (depois do #337 e do #340)

1. `instalar-pc.ps1 -SenhaDoCofre -NaInicializacao`, mais o relay com `ancoras`/`ancora` e o teste. Um PR.
2. O que o dono faz no segundo PC (a carta).
3. Na UI escolhida: leitura das âncoras pelas VPS e a troca com conferência. Um PR.
4. Prova: trocar a âncora para o PC 24/7, desligar o seazone173, ver as VPS saindo por `186.236.19.220` pelo PC 24/7
   e, com o gateway da VPS logado, as sessões respondendo.

## 5. A carta ao dono (uma só)

> **Para escolher qual PC é a âncora do proxy**
>
> Recomendo deixar o PC que vai ficar ligado 24/7 como âncora fixa, escolhida no app, sem troca automática. Se ele
> cair, as VPS param (nunca saem pela nuvem) e o app mostra um botão para passar ao outro PC.
>
> Só isto precisa da sua mão, no segundo PC, uma vez:
> 1. Instalar a Tailscale e entrar com a mesma conta. No painel da Tailscale, ligar "Run unattended" e desligar a
>    expiração da chave desse PC.
> 2. Em Energia, "nunca suspender".
> 3. Instalar o Node LTS.
> 4. Copiar do PC atual a pasta `scripts\proxy-saida` (pen drive ou OneDrive). Abrir o PowerShell como administrador,
>    destrancar o cofre e rodar o comando que eu deixo pronto. Ele usa a mesma senha do proxy de hoje e não cria outra.
> 5. Me dizer qual dos dois PCs fica ligado 24/7 e o nome dele na Tailscale.
>
> Um aviso: até as contas estarem logadas no gateway da VPS (outra frente, já em andamento), o PC atual (seazone173)
> ainda é quem atende os modelos, e por isso não pode ser o que desliga.
>
> E, se alguma ferramenta sua libera acesso por IP fora do Claude, me diga qual: os dois PCs devem sair pelo mesmo IP
> de casa, e o app confere isso antes de trocar.
