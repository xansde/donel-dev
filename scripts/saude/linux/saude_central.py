#!/usr/bin/env python3
"""Central da saúde (t-16393812), só na VPS pessoal, pelo cron de 1 min via saude_central.sh.

- Grava ~/entregas/saude/dados/atual.json a cada minuto e serie-24h (5 min), serie-7d (15 min), serie-30d (60 min).
- Compacta (saude.compactar): 3 h a cada 5 min; 192 h na 1ª vez e às 03:17.
- Alertas: abre/fecha em saude.alerta e avisa o Líder do quadro da máquina (Donel Dev; Homologação para a Homologações).
  Nunca o dono: quando falta conta com cota em todos os gateways, o aviso ao Líder diz que é caso de levar ao dono.
uso: saude_central.py [--seco] [--forcar-series]
Lê o Supabase como saude_gravador (senha em ~/.config/donel-saude/gravador); nada de senha em argv, log ou saída.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
DIR = HOME / ".donel" / "saude"
ESTADO = DIR / "central.json"
SAIDA = HOME / "entregas" / "saude"
DADOS = SAIDA / "dados"
SENHA = HOME / ".config" / "donel-saude" / "gravador"
REF = "hotkktdvbjpibkigpopq"
HOST = "aws-1-sa-east-1.pooler.supabase.com"
AQUI = Path(__file__).resolve().parent
PAGINA = "https://vps-alexandrelentz.tail8629f1.ts.net/entregas/saude/"
TAREFA = "[t-16393812] Saúde das máquinas: alerta automático do coletor."

NOMES = {"pc": "PC", "vps-pessoal": "VPS pessoal", "homologacoes": "Homologações", "people": "vps-people",
         "gw:pc": "Gateway do PC", "gw:homolog": "Gateway da Homologações", "gw:people": "Gateway da People"}
ORDEM = ["pc", "vps-pessoal", "homologacoes", "people"]
LIMITES = {"cpu_pct": 90, "ram_pct": 85, "swap_pct": 80, "disco_pct": 90, "carga_por_cpu": 2, "silencio_s": 600, "cota_min": 5}
QUADRO = {"homologacoes": "Homologação"}  # o resto vai ao Líder do quadro Donel Dev


def psql(sql: str, timeout: int = 90) -> str:
    senha = SENHA.read_text(encoding="utf-8").strip()
    p = subprocess.run(
        ["psql", f"host={HOST} port=6543 user=saude_gravador.{REF} dbname=postgres sslmode=require connect_timeout=15",
         "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
        input=sql, env={"PATH": "/usr/bin:/bin", "PGPASSWORD": senha, "HOME": str(HOME)},
        capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or "").replace(senha, "***").strip()[:300])
    return p.stdout.strip()


def lit(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def gravar(nome: str, dado) -> None:
    DADOS.mkdir(parents=True, exist_ok=True)
    tmp = DADOS / f".{nome}.tmp"
    tmp.write_text(json.dumps(dado, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, DADOS / nome)


SQL_ATUAL = """
select json_build_object(
 'gerado_em', now(),
 'maquinas', (select coalesce(json_agg(m), '[]') from (
    select maquina, em, idade_s, cpu_pct, carga1, carga5, carga15, ncpu, ram_pct, ram_usada_mb, ram_total_mb, swap_pct,
           swap_usada_mb, swap_total_mb, disco_pct, disco_usado_gb, disco_total_gb, rede_rx_kb_s, rede_tx_kb_s,
           sessoes_claude, coletor_rss_mb, extra->'top' as top from saude.v_maquina_atual) m),
 'gateways', (select coalesce(json_agg(g), '[]') from (
    select a.gateway, a.em, a.idade_s, a.alcancavel, a.contas, a.ativas, a.com_cota, a.em_429, a.com_erro, a.desligadas,
           a.req_ok, a.req_falha, a.contas_no_minuto, a.conta_ativa, a.erro, a.esgotadas, a.fora, a.proxima_volta,
           a.voltam_1h, h.req_ok_1h, h.req_falha_1h
    from saude.v_gateway_atual a left join (
      select gateway, sum(req_ok)::bigint req_ok_1h, sum(req_falha)::bigint req_falha_1h from saude.gateway_minuto
      where em > now() - interval '1 hour' group by 1) h using (gateway)) g),
 'contas', (select coalesce(json_agg(c order by c.gateway, c.tem_cota desc, c.uso5h nulls last), '[]') from saude.v_conta_atual c),
 'janela', (select coalesce(json_agg(w), '[]') from (
    select maquina, count(*) n, min(ram_pct) ram_min, max(ram_pct) ram_max, min(swap_pct) swap_min, max(disco_pct) disco_max,
           min(carga1 / nullif(ncpu, 0)) carga_min from saude.maquina_minuto where em > now() - interval '15 minutes' group by 1) w),
 'janela_gw', (select coalesce(json_agg(w), '[]') from (
    select gateway, count(*) n, max(com_cota) com_cota_max, max(contas) contas, bool_or(alcancavel) algum_alcancavel
    from saude.gateway_minuto where em > now() - interval '10 minutes' group by 1) w),
 'abertos', (select coalesce(json_agg(a), '[]') from saude.v_alerta_aberto a),
 'fora', (select coalesce(json_agg(f), '[]') from saude.alvo_fora f)
);
"""


def serie(janela: str) -> dict:
    sql = f"""
select json_build_object(
 'm', (select coalesce(json_agg(x), '[]') from saude.maquina_serie({lit(janela)}) x),
 'g', (select coalesce(json_agg(x), '[]') from saude.gateway_serie({lit(janela)}) x),
 'c', (select coalesce(json_agg(x), '[]') from saude.conta_serie({lit(janela)}, 60) x),
 'nc', (select count(distinct (gateway, conta)) from saude.conta_amostra where em > now() - interval '1 day')
);"""
    bruto = json.loads(psql(sql, timeout=120))
    passo = {"24h": 300, "7d": 3600, "30d": 14400}[janela]
    out = {"janela": janela, "passo_s": passo, "gerado_em": datetime.now(timezone.utc).isoformat(), "limites": LIMITES,
           "maquinas": {}, "gateways": {}, "contas": {}, "picos": []}
    campos_m = ["cpu", "cpu_max", "carga1", "carga1_max", "ram_pct", "ram_pct_max", "swap_pct", "swap_pct_max", "disco_pct",
                "rx", "rx_max", "tx", "tx_max", "sessoes", "sessoes_max", "coletor_rss_mb"]
    for r in bruto["m"]:
        m = out["maquinas"].setdefault(r["maquina"], {"nome": NOMES.get(r["maquina"], r["maquina"]), "ncpu": r["ncpu"],
                                                      "ram_total_mb": r["ram_total_mb"], "t": [], **{k: [] for k in campos_m}})
        m["t"].append(int(datetime.fromisoformat(r["t"]).timestamp()))
        for k in campos_m:
            v = r.get(k)
            m[k].append(round(v, 2) if isinstance(v, float) else v)
        m["ncpu"] = r["ncpu"] or m["ncpu"]
        m["ram_total_mb"] = r["ram_total_mb"] or m["ram_total_mb"]
    campos_g = ["alcancavel_pct", "contas", "com_cota", "com_cota_min", "ativas", "em_429", "em_429_max", "req_ok", "req_falha",
                "esgotadas", "fora"]
    for r in bruto["g"]:
        g = out["gateways"].setdefault(r["gateway"], {"nome": NOMES.get("gw:" + r["gateway"], r["gateway"]), "t": [],
                                                      **{k: [] for k in campos_g}})
        g["t"].append(int(datetime.fromisoformat(r["t"]).timestamp()))
        for k in campos_g:
            v = r.get(k)
            g[k].append(round(v, 2) if isinstance(v, float) else v)
    vistas = set()
    for r in bruto["c"]:
        c = out["contas"].setdefault(r["gateway"], {}).setdefault(
            r["conta"], {"t": [], "uso5h": [], "uso7d": [], "req_ok": [], "req_falha": [], "teve_429": []})
        vistas.add((r["gateway"], r["conta"]))
        c["t"].append(int(datetime.fromisoformat(r["t"]).timestamp()))
        for k in ("uso5h", "uso7d", "req_ok", "req_falha", "teve_429"):
            c[k].append(r.get(k))
    out["contas_omitidas"] = max(0, int(bruto.get("nc") or 0) - len(vistas))
    out["picos"] = picos(out["maquinas"])
    return out


def picos(maquinas: dict) -> list[dict]:
    """Um pico por trecho contínuo acima do limite: o ponto mais alto do trecho."""
    res = []
    for nome, m in maquinas.items():
        regras = [("cpu_pct", "cpu_max", LIMITES["cpu_pct"]), ("ram_pct", "ram_pct_max", LIMITES["ram_pct"]),
                  ("swap_pct", "swap_pct_max", LIMITES["swap_pct"]), ("disco_pct", "disco_pct", LIMITES["disco_pct"]),
                  ("carga1", "carga1_max", LIMITES["carga_por_cpu"] * (m.get("ncpu") or 1))]
        for metrica, serie_k, lim in regras:
            melhor = None
            for i, v in enumerate(m[serie_k] + [None]):
                if v is not None and v > lim:
                    if melhor is None or v > melhor[1]:
                        melhor = (i, v)
                elif melhor is not None:
                    res.append({"alvo": nome, "metrica": metrica, "t": m["t"][melhor[0]], "valor": melhor[1], "limite": lim})
                    melhor = None
    return res


# --------------------------------------------------------------------------------------------- alertas
# Regra do Líder do quadro (16/11): cada condição avisa ao abrir, ao piorar de faixa e ao fechar; repetição da mesma
# condição na mesma faixa no máximo 1 vez por hora. Faixas: 1 = aviso, 2 = grave, 3 = esgotado (só cota).

def hora_br(iso_ts) -> str:
    if not iso_ts:
        return "?"
    try:
        from zoneinfo import ZoneInfo
        return datetime.fromisoformat(str(iso_ts).replace("Z", "+00:00")).astimezone(ZoneInfo("America/Sao_Paulo")).strftime("%d/%m %H:%M")
    except ValueError:
        return str(iso_ts)


def faixa(v, f1, f2) -> int:
    return 0 if v is None else (2 if v > f2 else 1 if v > f1 else 0)


def condicoes(atual: dict, est_429: dict | None = None) -> dict[str, dict]:
    """chave -> {faixa, alvo, texto} das condições verdadeiras agora (sustentadas na janela)."""
    out: dict[str, dict] = {}
    est_429 = {} if est_429 is None else est_429
    maq = {m["maquina"]: m for m in atual["maquinas"]}
    jan = {w["maquina"]: w for w in atual["janela"]}
    gws = {g["gateway"]: g for g in atual["gateways"]}
    jg = {w["gateway"]: w for w in atual["janela_gw"]}
    fora = {f["alvo"] for f in atual.get("fora") or []}  # saíram do escopo: sem alerta
    for nome in ORDEM:
        if nome in fora:
            continue
        m, w = maq.get(nome), jan.get(nome)
        rot = NOMES[nome]
        if m is None or m["idade_s"] > LIMITES["silencio_s"]:
            if nome == "pc":
                # PC desligado é normal; alerta só se o gateway do PC (que roda no PC) responde e o coletor não
                g = jg.get("pc")
                if g and g.get("algum_alcancavel") and m is not None and m["idade_s"] > 900:
                    out["silencio:pc"] = {"faixa": 1, "alvo": nome, "texto": "PC ligado (o gateway responde) mas o coletor do PC não manda dados há mais de 15 min"}
            elif m is not None:
                out[f"silencio:{nome}"] = {"faixa": 2, "alvo": nome, "texto": f"{rot} sem dados do coletor há {m['idade_s'] // 60} min: máquina ou cron parados"}
            continue
        if not w or w["n"] < 10:
            continue
        f = faixa(w["ram_min"], 90, 95)
        if f:
            out[f"ram:{nome}"] = {"faixa": f, "alvo": nome, "texto": f"{rot}: RAM acima de {90 if f == 1 else 95}% há 15 min (agora {m['ram_pct']}%)"}
        f = faixa(w["swap_min"], LIMITES["swap_pct"], 95)
        if f:
            out[f"swap:{nome}"] = {"faixa": f, "alvo": nome, "texto": f"{rot}: swap acima de {LIMITES['swap_pct'] if f == 1 else 95}% há 15 min (agora {m['swap_pct']}%)"}
        f = faixa(w["disco_max"], LIMITES["disco_pct"], 95)
        if f:
            out[f"disco:{nome}"] = {"faixa": f, "alvo": nome, "texto": f"{rot}: disco em {m['disco_pct']}%"}
        f = faixa(w["carga_min"], 4, 8)
        if f:
            out[f"carga:{nome}"] = {"faixa": f, "alvo": nome,
                                    "texto": f"{rot}: carga acima de {4 if f == 1 else 8} por núcleo há 15 min (agora {m['carga1']} em {m['ncpu']} núcleos)"}
    # Contas (regra do Líder do quadro, 16/11): só (a) menos de 5 com cota no gateway, (b) a conta ativa em 429 ou acima
    # de 95%, (c) uma conta que estava em uso e caiu (login morto/desligada). Esgotada que renova não é alerta.
    contas = atual.get("contas") or []
    com_contas = []
    for gid, g in gws.items():
        w = jg.get(gid)
        if not w or f"gw:{gid}" in fora:
            continue
        rot = NOMES.get("gw:" + gid, gid)
        if (w.get("contas") or 0) > 0 and g.get("alcancavel"):
            com_contas.append(gid)
            cota = w["com_cota_max"] or 0
            if cota < LIMITES["cota_min"]:
                volta = f", a próxima volta {hora_br(g.get('proxima_volta'))} ({g.get('voltam_1h') or 0} voltam em 1 h)" if g.get("proxima_volta") else ""
                out[f"cota:{gid}"] = {"faixa": 3 if cota == 0 else 2, "alvo": f"gw:{gid}",
                                      "texto": f"{rot}: só {g.get('com_cota')} contas com cota; {g.get('esgotadas')} esgotadas{volta}; {g.get('fora')} fora (Reconectar)"}
            # (b) só 429 sustentado: a conta ativa do minuto em 429 em 3 dos últimos 5 minutos (os 95% ficam só na página)
            ativa = next((c for c in contas if c["gateway"] == gid and c["conta"] == g.get("conta_ativa")), None)
            hist = (est_429.setdefault(gid, []) + [bool(ativa and ativa.get("em_429"))])[-5:]
            est_429[gid] = hist
            if sum(hist) >= 3 and ativa and ativa.get("em_429"):
                out[f"ativa:{gid}"] = {"faixa": 2, "alvo": f"gw:{gid}",
                                       "texto": f"{rot}: a conta ativa {ativa['conta']} está em 429 até {hora_br(ativa.get('cooldown_ate'))} (3 dos últimos 5 min)"}
            for c in contas:
                if c["gateway"] == gid and c.get("classe") == "fora" and (c.get("req_ok_24h") or 0) > 0:
                    out[f"caiu:{gid}:{c['conta']}"] = {"faixa": 2, "alvo": f"gw:{gid}",
                                                       "texto": f"{rot}: a conta {c['conta']}, em uso nas últimas 24 h, caiu ({(c.get('motivo') or c.get('estado') or '')[:60]}): precisa Reconectar"}
        if gid == "pc" and not w.get("algum_alcancavel") and maq.get("pc") and maq["pc"]["idade_s"] < 300:
            out["gateway:pc"] = {"faixa": 2, "alvo": "gw:pc", "texto": "PC ligado mas o gateway do PC não responde há 10 min"}
    if com_contas and all((gws[g].get("com_cota") or 0) == 0 for g in com_contas):
        out["cota:todas"] = {"faixa": 3, "alvo": "gw:todas",
                             "texto": "nenhuma conta com cota em nenhum gateway: caso de levar ao dono (única exceção da regra)"}
    return out


def alertas(atual: dict, est: dict, seco: bool) -> dict:
    agora = time.time()
    conds = condicoes(atual, est.setdefault("ativa429", {}))
    abertos = {a["chave"]: a for a in atual["abertos"]}
    memo = est.setdefault("faixas", {})  # chave -> {faixa, envio}
    sql, eventos = [], []
    for chave, c in conds.items():
        nivel = "grave" if c["faixa"] >= 2 else "aviso"
        m = memo.get(chave)
        if chave not in abertos:
            sql.append(f"insert into saude.alerta (chave, inicio, nivel, alvo, texto) values ({lit(chave)}, now(), "
                       f"{lit(nivel)}, {lit(c['alvo'])}, {lit(c['texto'])}) on conflict do nothing;")
            eventos.append(("abriu", c))
            memo[chave] = {"faixa": c["faixa"], "envio": agora}
        elif m is None or c["faixa"] > m["faixa"]:
            eventos.append(("piorou", c))
            memo[chave] = {"faixa": c["faixa"], "envio": agora}
        elif agora - m["envio"] >= 3600:
            eventos.append(("ainda", c))
            memo[chave] = {"faixa": c["faixa"], "envio": agora}
        else:
            m["faixa"] = c["faixa"]  # melhorou ou igual: guarda, sem avisar
    fora = est.setdefault("fora", {})
    fechados = []
    for chave, a in abertos.items():
        if chave in conds:
            fora.pop(chave, None)
            continue
        fora[chave] = fora.get(chave, 0) + 1
        if fora[chave] >= 10:  # histerese: 10 rodadas seguidas sem a condição
            sql.append(f"update saude.alerta set fim = now() where chave = {lit(chave)} and inicio = {lit(a['inicio'])};")
            fechados.append(chave)
            eventos.append(("fechou", {"alvo": a["alvo"], "texto": a["texto"]}))
            fora.pop(chave, None)
            memo.pop(chave, None)
    enviados = {}
    por_quadro: dict[str, list[str]] = {}
    for ev, c in eventos:
        q = QUADRO.get(c["alvo"], "Donel Dev")
        rot = {"abriu": "", "piorou": "piorou: ", "ainda": "ainda: ", "fechou": "resolvido: "}[ev]
        por_quadro.setdefault(q, []).append(f"- {rot}{c['texto']}")
    for q, linhas in por_quadro.items():
        texto = f"{TAREFA} Para o Líder do quadro (não ao dono):\n" + "\n".join(linhas) + f"\nSérie e picos: {PAGINA}"
        enviados[q] = "seco" if seco else enviar(q, texto)
        sql.append(f"update saude.alerta set enviado_a = {lit(q + ': ' + enviados[q])} where fim is null and enviado_a is null;")
    if sql and not seco:
        psql("\n".join(sql))
    return {"abertos": len(conds), "eventos": [(e, c["texto"][:60]) for e, c in eventos], "fechados": fechados, "envio": enviados}


def enviar(quadro: str, texto: str) -> str:
    try:
        if quadro == "Homologação":
            p = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "homologacoes-2222",
                                "python3 -I /root/bin/rotinas/saude/saude_avisar.py --quadro Homologação"],
                               input=texto, capture_output=True, text=True, timeout=90)
        else:
            p = subprocess.run([sys.executable, "-I", str(AQUI / "saude_avisar.py"), "--quadro", quadro],
                               input=texto, capture_output=True, text=True, timeout=90)
        return (p.stdout.strip() or f"rc {p.returncode}")[:40]
    except subprocess.TimeoutExpired:
        return "incerto"


# --------------------------------------------------------------------------------------------- principal

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seco", action="store_true")
    ap.add_argument("--forcar-series", action="store_true")
    a = ap.parse_args()
    DIR.mkdir(parents=True, exist_ok=True)
    try:
        est = json.loads(ESTADO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        est = {}
    agora = datetime.now()
    resumo: dict = {"em": agora.strftime("%F %T")}

    if not a.seco and (not est.get("compactou_tudo") or (agora.hour == 3 and agora.minute == 17)):
        resumo["compactar_192"] = json.loads(psql("select saude.compactar(192);", timeout=300))
        est["compactou_tudo"] = time.time()
    elif not a.seco and agora.minute % 5 == 2:
        resumo["compactar"] = json.loads(psql("select saude.compactar(3);"))

    atual = json.loads(psql(SQL_ATUAL))
    resumo["alertas"] = alertas(atual, est, a.seco)
    pub = {"gerado_em": atual["gerado_em"], "limites": LIMITES,
           "maquinas": sorted(atual["maquinas"], key=lambda m: ORDEM.index(m["maquina"]) if m["maquina"] in ORDEM else 99),
           "gateways": atual["gateways"], "contas": atual["contas"],
           "alertas": [{k: x[k] for k in ("chave", "nivel", "alvo", "inicio", "texto")} for x in atual["abertos"]],
           "fora": [dict(f, nome=NOMES.get(f["alvo"], f["alvo"])) for f in atual.get("fora") or []]}
    fora = {f["alvo"]: f for f in pub["fora"]}
    for m in pub["maquinas"]:
        m["nome"] = NOMES.get(m["maquina"], m["maquina"])
        if m["maquina"] in fora:
            m["fora"] = {"desde": fora[m["maquina"]]["desde"], "motivo": fora[m["maquina"]]["motivo"]}
    for g in pub["gateways"]:
        g["nome"] = NOMES.get("gw:" + g["gateway"], g["gateway"])
    if not a.seco:
        gravar("atual.json", pub)
        if not (SAIDA / "index.html").exists() or (AQUI / "index.html").stat().st_mtime > (SAIDA / "index.html").stat().st_mtime:
            if (AQUI / "index.html").exists():
                (SAIDA / "index.html").write_bytes((AQUI / "index.html").read_bytes())
        for janela, cada in (("24h", 5), ("7d", 15), ("30d", 60)):
            if a.forcar_series or agora.minute % cada == 0 or not (DADOS / f"serie-{janela}.json").exists():
                s = serie(janela)
                gravar(f"serie-{janela}.json", s)
                resumo[f"serie_{janela}"] = sum(len(m["t"]) for m in s["maquinas"].values())
    resumo["maquinas"] = {m["maquina"]: m["idade_s"] for m in pub["maquinas"]}
    ESTADO.write_text(json.dumps(est), encoding="utf-8")
    print(json.dumps(resumo, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
