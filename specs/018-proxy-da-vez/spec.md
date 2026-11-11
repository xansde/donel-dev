# 018 — Proxy da vez

Pedido do dono (10/11/2026, literal): "Na nova versão do donel dev, quero um cadastro de proxy e um seletor para
poder escolher qual proxy é o da vez e a saúde do atual. Por exemplo, agora ativa o do Bill, mas ser fácil com um
clique trocar para o meu computador atual ou o outro pc pessoal que eu tenho, desde que esteja configurado, sacas?"

Refinamento rápido feito pelo Dev (sem carta ao dono, pedido #sem-esteira). Cada decisão aberta foi fechada pela
recomendação, com o porquê ao lado.

## O que existe hoje

As sessões de cada máquina (PC, VPS pessoal, VPS Homologações) saem para a Anthropic pelo endereço que o
`~/.claude/settings.json` daquela máquina diz: `env.ANTHROPIC_BASE_URL` + `apiKeyHelper` (o comando que imprime a
chave). Dois caminhos em uso: o gateway de contas que roda num PC do dono e o Portal IA. A troca é por script, máquina a
máquina (`virar-*.sh` / `voltar-*.sh`), e só vale para sessões novas.

## O que o app passa a fazer

1. **Cadastro de proxies** (chave `proxies` do `config.json`): nome, tipo (`gateway` de contas, em qualquer máquina: um PC, a VPS pessoal, a VPS Homologações; ou `portal`), endereço e
   em quais máquinas pode ser usado. A chave de cada proxy fica no cofre do app (`safeStorage`), **uma por máquina**
   (o portal pareia uma chave por máquina), nunca no `config.json`, no `settings.json`, em log ou no renderer.
2. **Seletor "proxy da vez"** por máquina (este computador + cada lugar remoto de `accounts.remotes`) e "todas de uma
   vez". Só oferece proxy com endereço e chave daquela máquina. A troca faz o mesmo que os scripts: grava
   `ANTHROPIC_BASE_URL`, `apiKeyHelper` e o host no `NO_PROXY` do `settings.json` da máquina; não mexe em modelo,
   hooks, proxy de saída nem nas sessões vivas.
3. **Volta automática**: antes de gravar, a própria máquina chama `GET /v1/models` com a chave pelo novo caminho (com o
   `HTTPS_PROXY` dela); sem 200, nada muda. Depois de gravar, repete a chamada pelo `apiKeyHelper` recém-gravado; sem
   200, o `settings.json` anterior volta e a troca é relatada como desfeita.
4. **Saúde**: o app sonda cada proxy cadastrado a cada minuto (`GET /v1/models`, User-Agent do CLI, sem chave):
   resposta abaixo de 500 = de pé; 5xx, timeout ou erro de rede = fora. Guarda latência, hora e último erro. A barra do
   app mostra o proxy da vez desta máquina com a cor da saúde; quando o da vez de alguma máquina cai, o app avisa e
   sugere o primeiro proxy de pé configurado para ela.
5. **Cadastro pronto**: o que as máquinas já usam aparece como "achado" e entra no cadastro com um clique, junto com a
   chave que a máquina já tem ("Importar a chave desta máquina"). Um lugar vazio "Outro PC" já vem no cadastro e fica
   "não configurado" até ter endereço e chave.

## Decisões fechadas no refinamento

| Decisão | Escolha | Por quê |
| --- | --- | --- |
| Onde a troca age | `~/.claude/settings.json` de cada máquina (camada user) | É o que os scripts fazem e o que as sessões do Donel herdam; a camada `--settings` por sessão não pode, porque o pedido é para sessões novas de qualquer origem (cron, terminal solto). |
| Fonte da verdade do "da vez" | O `ANTHROPIC_BASE_URL` lido na máquina | A troca por script continua possível; guardar no app ficaria desatualizado na primeira vez que alguém rodar o script. |
| Chave | Cofre do app, por proxy e por máquina; materializada na máquina num arquivo 600 (`~/.donel/proxy/<id>.key`) que o `apiKeyHelper` lê | A máquina remota não alcança o cofre do PC, e o `apiKeyHelper` precisa de algo local. A chave viaja só pelo stdin/stdout do `ssh`, como no ADR 0005. |
| URL do portal e do gateway no código | Nenhuma | Regra do projeto: nada da Seazone fixo no core nem em default que vaze para o repo público. O cadastro nasce do que as máquinas já usam ("achados"). |
| Sonda de saúde | Do computador do app, sem chave | Barata, não gasta cota e não expõe chave; a checagem com chave acontece na troca, na própria máquina. |
| Volta automática | Na troca (antes e depois de gravar) | O pedido fala em "volta automática se o novo não responder"; voltar sozinho depois, numa queda posterior, trocaria o caminho sem o dono ver. Queda posterior vira aviso com sugestão. |

## Fatias (um PR cada, contra `staging`)

1. **Motor** (sem tela): tipos, config `proxies`, programa da máquina (ler, importar chave, trocar com volta), sonda,
   serviço e IPC. Testes: config persistida, programa contra um HOME temporário (troca, volta, arquivo da chave 600,
   chave nunca na saída), troca em todas com falha parcial.
2. **Tela**: indicador na barra, painel de cadastro e seletor, aviso de queda; item nas novidades da versão.
3. **Prova no alfa**: trocar PC → portal → PC numa sessão de teste sem derrubar as sessões vivas, com prints.

## Onde o proxy roda e para onde cada máquina aponta (10/11, pedido do dono)

"Tem que ser versátil a ideia de escolher onde fica o proxy." O cadastro não supõe que o gateway mora no PC: cada
proxy é só um endereço, e cada máquina aponta para qualquer proxy cadastrado que tenha endereço, chave dela e a permita
(lista de máquinas vazia = todas). Dá para
combinar à vontade, inclusive o PC apontando para um gateway que roda numa VPS (ex.: `http://vps-time-homologacoes:8327`).
O que o app não faz é subir ou derrubar um gateway numa máquina; isso fica com a âncora do proxy (PR #351,
`docs/planos/ancora-proxy.md`).

## Fora

Trocar o proxy de saída (`HTTPS_PROXY`), modelo padrão por proxy, volta automática numa queda posterior, histórico de
saúde além do último erro.
