# Saúde das máquinas e das contas (t-16393812)

Série contínua de saúde do PC, da VPS pessoal, da Homologações e da vps-people, e das contas Claude de cada gateway,
guardada no Supabase oraculo-harrow (schema `saude`) e mostrada em `~/entregas/saude/`
(https://vps-alexandrelentz.tail8629f1.ts.net/entregas/saude/, só na tailnet). Leitura para o app: `CONTRATO.md`.

## Peças

| peça | onde roda | o que faz |
|---|---|---|
| `sql/001_saude.sql`, `sql/002_classes_de_conta.sql` | Supabase, uma vez (`linux/aplicar_schema.py <arquivo>`) | schema `saude`, tabelas, funções de série, compactação, papéis `saude_gravador` e `saude_leitor` |
| `linux/saude_coletor.py` + `.sh` | cron de 1 min nas 3 VPS | mede `/proc`; na VPS pessoal também lê as contas dos gateways (`--gateways`) e grava o que o PC mandou (`--entrada`) |
| `linux/saude_receber.sh` | VPS pessoal, chamado por ssh pelo PC | guarda as linhas do PC em `~/.donel/saude/entrada/` |
| `pc/saude-coletor.cs` + `pc/instalar-saude-pc.ps1` | PC, tarefa agendada oculta `DonelSaudeColetor` | mesmo que o coletor Linux, em C#; manda por ssh (ver `pc/INSTALAR-PC.md`) |
| `linux/saude_central.py` + `.sh` | cron de 1 min na VPS pessoal | grava os JSON da página, compacta, abre/fecha alertas e avisa o Líder do quadro |
| `linux/saude_avisar.py` | VPS pessoal e Homologações | manda o aviso ao Líder do quadro por uma sessão local (como o despertador) |
| `linux/trocar_senha.py` | VPS pessoal | troca a senha de um papel sem eco e espalha o arquivo 600 |
| `pagina/index.html` | `~/entregas/saude/index.html` (o central copia) | gráficos 24 h / 7 d / 30 d, picos, contas |

Credenciais: `~/.config/donel-saude/gravador` (3 VPS) e `~/.config/donel-saude/leitor` (VPS pessoal), 600, uma linha.
O dono do banco (`~/.config/donel-espelho/db-password`) só é usado por `aplicar_schema.py` e `trocar_senha.py`.
Estado local: `~/.donel/saude/` (estado, pendente, entrada, logs).

## Instalar numa VPS (já feito em 16/11)
```
install -m 755 linux/saude_coletor.py linux/saude_coletor.sh ~/bin/rotinas/saude/
(crontab -l; echo '* * * * * /home/<usuario>/bin/rotinas/saude/saude_coletor.sh --maquina <nome> >> /home/<usuario>/.donel/saude/coletor.log 2>&1') | crontab -
```
Na VPS pessoal: `--maquina vps-pessoal --gateways --entrada`, mais `saude_receber.sh`, `saude_central.*`,
`saude_avisar.py` e `index.html` em `~/bin/rotinas/saude/` e a linha do `saude_central.sh`.

## Alertas (regra do Líder do quadro, 16/11)
Ao Líder do quadro da máquina (Homologações → quadro Homologação; o resto → Donel Dev), nunca ao dono. Cada condição
avisa ao abrir, ao piorar de faixa e ao fechar; a mesma condição na mesma faixa no máximo 1 vez por hora.
- Máquina (sustentado 15 min): RAM > 90/95%, swap > 80/95%, disco > 90/95%, carga > 4/8 por núcleo, VPS sem dados > 10 min,
  PC ligado (gateway responde) sem dados > 15 min.
- Contas: (a) menos de 5 com cota no gateway; (b) a conta ativa em 429 em 3 dos últimos 5 min; (c) conta que atendeu nas
  últimas 24 h e caiu (fora). Nenhuma conta com cota em nenhum gateway = aviso que pede levar ao dono.

## Desfazer tudo
```
# 1. crons (um comando por máquina)
crontab -l | grep -v '/rotinas/saude/saude_' | crontab -                                   # VPS pessoal (coletor e central)
ssh vps-people "crontab -l | grep -v '/rotinas/saude/saude_' | crontab -"
ssh homologacoes-2222 "crontab -l | grep -v '/rotinas/saude/saude_' | crontab -"            # ou por um claude -p lá
# 2. PC (sessão no PC)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\saude\pc\instalar-saude-pc.ps1 -Desinstalar
# 3. Supabase (como dono do banco, na VPS pessoal)
#    drop schema saude cascade; drop role saude_gravador; drop role saude_leitor;
# 4. arquivos: ~/bin/rotinas/saude, ~/.donel/saude, ~/.config/donel-saude (3 VPS), ~/entregas/saude
```
