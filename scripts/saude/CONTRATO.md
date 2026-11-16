# Saúde das máquinas e das contas — contrato de leitura (t-16393812)

Para quem lê a série: a página `~/entregas/saude/` e o app do celular (tela de contas e saúde no mapa do rig).
Tudo aqui é **só leitura**. Quem grava são os coletores e o central (ver `README.md`).

## Máquinas e gateways

| `maquina` | nome na tela | onde roda o coletor |
|---|---|---|
| `pc` | PC | binário C# em tarefa agendada oculta; manda por ssh à VPS pessoal |
| `vps-pessoal` | VPS pessoal | cron de 1 min (`~/bin/rotinas/saude/`) |
| `homologacoes` | Homologações | cron de 1 min (root) |
| `people` | vps-people | **fora desde 16/11 18:29** (saída da VPS de People, t-2abb614a): sem coletor nem alerta |

| `gateway` | o que é |
|---|---|
| `pc` | CLIProxyAPI do PC (`seazone173:8317`), o pool de contas do dono |
| `homolog` | CLIProxyAPI da Homologações (`:8327`); hoje sem contas (a máquina sai pelo Portal IA) |

A vps-people saiu do escopo em 16/11 18:29 (t-2abb614a); `saude.alvo_fora` e `atual.json` → `fora` listam o que saiu e desde quando. Gateway novo entra por `~/.donel/contas/gateways.json`
na VPS pessoal, sem mudar o contrato.

## Caminho 1 — arquivos JSON na tailnet (o mais simples para o app)

Base: `https://vps-alexandrelentz.tail8629f1.ts.net/entregas/saude/dados/` (só na tailnet, sem login).
O central regrava a cada 5 min (`atual.json` a cada 1 min). Horas em ISO 8601 UTC; séries com `t` em segundos epoch.

### `atual.json`
```json
{
  "gerado_em": "2026-11-16T21:00:05Z",
  "limites": {"cpu_pct": 90, "ram_pct": 85, "swap_pct": 80, "disco_pct": 90, "carga_por_cpu": 2, "silencio_s": 600, "cota_min": 5},
  "maquinas": [
    {"maquina": "vps-pessoal", "nome": "VPS pessoal", "em": "…", "idade_s": 42, "cpu_pct": 71.2, "carga1": 29.1, "carga5": 25.0,
     "carga15": 20.3, "ncpu": 4, "ram_pct": 61.0, "ram_usada_mb": 9750, "ram_total_mb": 15983, "swap_pct": 50.0,
     "swap_usada_mb": 4096, "swap_total_mb": 8191, "disco_pct": 55.0, "disco_usado_gb": 160.1, "disco_total_gb": 290.0,
     "rede_rx_kb_s": 120.5, "rede_tx_kb_s": 80.1, "sessoes_claude": 19, "coletor_rss_mb": 14.2,
     "top": [{"nome": "claude", "mb": 5200}, {"nome": "node", "mb": 1800}]}
  ],
  "gateways": [
    {"gateway": "pc", "nome": "Gateway do PC", "em": "…", "idade_s": 40, "alcancavel": true, "contas": 295, "ativas": 29,
     "com_cota": 28, "em_429": 265, "com_erro": 0, "desligadas": 1, "req_ok": 12, "req_falha": 0,
     "contas_no_minuto": 3, "conta_ativa": "tecnologia.claude176@seazone.com.br", "req_ok_1h": 640, "req_falha_1h": 2, "erro": null,
     "esgotadas": 257, "fora": 3, "proxima_volta": "…", "voltam_1h": 26}
  ],
  "contas": [
    {"gateway": "pc", "conta": "…@seazone.com.br", "em": "…", "estado": "active", "disponivel": true, "tem_cota": true,
     "uso5h": 4.0, "volta5h": "…", "uso7d": 95.0, "volta7d": "…", "status_cota": "allowed_warning",
     "em_429": false, "cooldown_ate": null, "motivo": "", "req_ok_24h": 310, "req_falha_24h": 1, "ultimo_uso": "…",
     "classe": "com_cota"}
  ],
  "alertas": [
    {"chave": "ram:vps-pessoal", "nivel": "aviso", "alvo": "vps-pessoal", "inicio": "…", "texto": "RAM acima de 85% há 10 min (91%)"}
  ]
}
```
- `idade_s` > 600 numa máquina = coletor parado ou máquina desligada (o PC desligado aparece assim, sem erro).
- `uso5h`/`uso7d` em % (0–100). `volta5h`/`volta7d` = quando a janela renova. `tem_cota` = disponível e as duas < 100%.
- `em_429` = a conta está em espera por cota ou 429 até `cooldown_ate`.
- `classe` (desde 16/11 18h): `com_cota` (pode atender), `esgotada` (em espera; renova em `cooldown_ate`, `volta5h` ou
  `volta7d`) ou `fora` (desligada ou login morto: precisa Reconectar). No gateway: `com_cota` + `esgotadas` + `fora` = `contas`;
  `proxima_volta` = a esgotada que renova primeiro; `voltam_1h` = quantas renovam na próxima hora.
- `top` = os 5 nomes de processo que mais somam RAM (MB).

### `serie-24h.json`, `serie-7d.json`, `serie-30d.json`
Passo: 24h = 5 min (300 s), 7d = 1 h, 30d = 4 h. Cada série é um conjunto de arrays alinhados por índice com `t`;
valor ausente = `null`.
```json
{
  "janela": "24h", "passo_s": 300, "gerado_em": "…",
  "limites": { … igual ao atual … },
  "maquinas": {
    "vps-pessoal": {"nome": "VPS pessoal", "ncpu": 4, "ram_total_mb": 15983,
      "t": [1794870000, …], "cpu": [], "cpu_max": [], "carga1": [], "carga1_max": [], "ram_pct": [], "ram_pct_max": [],
      "swap_pct": [], "swap_pct_max": [], "disco_pct": [], "rx": [], "rx_max": [], "tx": [], "tx_max": [],
      "sessoes": [], "sessoes_max": [], "coletor_rss_mb": []}
  },
  "gateways": {
    "pc": {"nome": "Gateway do PC", "t": [], "alcancavel_pct": [], "contas": [], "com_cota": [], "com_cota_min": [],
           "ativas": [], "em_429": [], "em_429_max": [], "req_ok": [], "req_falha": [], "esgotadas": [], "fora": []}
  },
  "contas": {
    "pc": {"tecnologia.claude176@seazone.com.br": {"t": [], "uso5h": [], "uso7d": [], "req_ok": [], "req_falha": [], "teve_429": []}}
  },
  "contas_omitidas": 0,
  "picos": [
    {"alvo": "vps-pessoal", "metrica": "ram_pct", "t": 1794870000, "valor": 93.1, "limite": 85}
  ]
}
```
- `*_max` = o pior minuto do intervalo (é ele que marca pico); o sem sufixo é a média.
- `contas` traz só as que atenderam ou tiveram 429 na janela (até 60, as de mais tráfego); `contas_omitidas` diz quantas ficaram de fora.
- `picos` = intervalos em que um `*_max` passou do limite (RAM > 85%, CPU > 90%, swap > 80%, disco > 90%,
  carga1 > 2 × ncpu), um por trecho contínuo (o ponto mais alto do trecho).

## Caminho 2 — Postgres, papel só-leitura (Supabase oraculo-harrow, schema `saude`)

- Host `aws-1-sa-east-1.pooler.supabase.com`, porta `6543` (transação) ou `5432` (sessão), banco `postgres`,
  usuário `saude_leitor.hotkktdvbjpibkigpopq`, `sslmode=require`. A senha fica na VPS pessoal em
  `~/.config/donel-saude/leitor` (600): peça ao Líder do quadro; não vai em código, log nem chat.
- O schema `saude` **não** está exposto no PostgREST (API REST do Supabase): leitura por SQL, ou pelo caminho 1.
- Permissões do `saude_leitor`: `select` em todas as tabelas e visões do schema e `execute` nas funções de série. Nada mais.

| objeto | o que dá |
|---|---|
| `saude.v_maquina_atual` | última amostra de cada máquina + `idade_s` |
| `saude.v_gateway_atual` | última amostra de cada gateway + `idade_s` |
| `saude.v_conta_atual` | estado de cada conta (últimas 3 h) + tráfego de 24 h + `tem_cota` |
| `saude.v_alerta_aberto` | alertas abertos |
| `saude.maquina_serie(janela)` | série por máquina; janela `'24h'`, `'7d'`, `'30d'` ou `'90d'` |
| `saude.gateway_serie(janela)` | série por gateway |
| `saude.conta_serie(janela, limite)` | série das contas com tráfego ou 429 na janela |
| `saude.maquina_minuto`, `gateway_minuto`, `conta_amostra` | bruto de 1 min (7 dias) |
| `saude.maquina_hora`, `gateway_hora`, `conta_hora` | agregado por hora (90 dias) |
| `saude.alerta` | histórico de alertas |
| `saude.alvo_fora` | máquinas e gateways fora do escopo (`alvo`, `desde`, `motivo`) |

Exemplo: `select * from saude.maquina_serie('24h') where maquina = 'pc';`

## Garantias e limites
- Amostra de 1 min; o PC some da série quando está desligado (sem linha, não zero).
- Bruto 7 dias; hora 90 dias. Uma amostra atrasada (PC que volta) entra com a hora em que foi medida.
- `conta_amostra` grava uma linha quando a conta muda e uma foto de todas a cada hora; para o estado atual use `v_conta_atual`.
- Contadores de pedidos zeram quando o gateway reinicia; o coletor trata isso (delta negativo vira 0).
