#!/usr/bin/env python3
"""Coletor de saúde de 1 minuto (t-16393812). Roda pelo cron, via saude_coletor.sh (nice 19 + flock).

uso: saude_coletor.py --maquina NOME [--gateways] [--entrada] [--seco]
  --maquina   pc | vps-pessoal | homologacoes | people (a linha de saude.maquina_minuto)
  --gateways  também amostra as contas dos gateways de ~/.donel/contas/gateways.json (só na VPS pessoal)
  --entrada   também grava as amostras que o PC mandou por ssh para ~/.donel/saude/entrada/ (só na VPS pessoal)
  --seco      mede e imprime, sem gravar nada no Supabase nem no estado

Só biblioteca padrão. Lê /proc uma vez, guarda o anterior em ~/.donel/saude/estado.json (CPU e rede são delta) e grava no
Supabase oraculo-harrow, schema saude, como saude_gravador (senha em ~/.config/donel-saude/gravador, 600) pelo psql.
O que não entra fica em ~/.donel/saude/pendente/<tabela>.jsonl e vai na próxima rodada.
Nenhuma senha ou chave vai para argv, log ou saída.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import resource
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
DIR = HOME / ".donel" / "saude"
ESTADO = DIR / "estado.json"
ESTADO_CONTAS = DIR / "estado-contas.json"
PENDENTE = DIR / "pendente"
ENTRADA = DIR / "entrada"
SENHA = HOME / ".config" / "donel-saude" / "gravador"
REF = "hotkktdvbjpibkigpopq"
HOST = "aws-1-sa-east-1.pooler.supabase.com"
PORTA = 6543
GW_CFG = HOME / ".donel" / "contas" / "gateways.json"
GW_KEYDIR = HOME / ".config" / "claude-proxy"
TABELAS = {
    "maquina_minuto": ["maquina", "em", "cpu_pct", "carga1", "carga5", "carga15", "ncpu", "ram_total_mb", "ram_usada_mb",
                       "ram_pct", "swap_total_mb", "swap_usada_mb", "swap_pct", "disco_total_gb", "disco_usado_gb",
                       "disco_pct", "rede_rx_kb_s", "rede_tx_kb_s", "sessoes_claude", "coletor_rss_mb", "extra"],
    "gateway_minuto": ["gateway", "em", "alcancavel", "contas", "ativas", "com_cota", "em_429", "com_erro", "desligadas",
                       "req_ok", "req_falha", "contas_no_minuto", "conta_ativa", "erro", "esgotadas", "fora", "proxima_volta",
                       "voltam_1h"],
    "conta_amostra": ["gateway", "conta", "em", "foto", "estado", "disponivel", "desligada", "uso5h", "volta5h", "uso7d",
                      "volta7d", "status_cota", "em_429", "cooldown_ate", "motivo", "req_ok", "req_falha", "ok_total",
                      "falha_total", "classe"],
}
MAX_PENDENTE_BYTES = 40 * 1024 * 1024  # por tabela; passou disso, descarta as mais antigas
REDE_FORA = ("lo", "docker", "veth", "br-", "virbr", "cni", "flannel")
# Conta "fora" é só a que precisa de login (Reconectar). Limite de uso, 429 e sobrecarga são passageiros: a conta
# renova sozinha e conta como esgotada (16/11: "rate_limit_error" marcava fora e disparou "caiu" à toa).
RE_PASSAGEIRO = re.compile(r"rate[_ ]?limit|\b429\b|overload|\b529\b|quota|too many requests|\b50[0-4]\b|api_error|timeout",
                           re.IGNORECASE)
RE_LOGIN = re.compile(r"invalid[_ ]grant|invalid[_ ]token|revok|unauthori[sz]ed|authentication_error|permission_error|"
                      r"token (?:has )?expired|refresh[_ ]token|\b401\b|\b403\b", re.IGNORECASE)
BACKOFF_CHAVE_S = 1800  # 401/403 da gestão: 5 erradas banem o IP por 30 min, então para de tentar por 30 min


def agora_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def ler_json(p: Path, padrao):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return padrao


def gravar_json(p: Path, dado) -> None:
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(dado, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)


# --------------------------------------------------------------------------------------------- máquina (/proc)

def cpu_tempos() -> tuple[int, int]:
    with open("/proc/stat", encoding="ascii") as fh:
        campos = [int(x) for x in fh.readline().split()[1:9]]
    return sum(campos), campos[3] + campos[4]  # total, ocioso (idle + iowait)


def meminfo() -> dict[str, int]:
    out = {}
    with open("/proc/meminfo", encoding="ascii") as fh:
        for ln in fh:
            k, v = ln.split(":", 1)
            out[k] = int(v.split()[0])  # kB
    return out


def rede_bytes() -> tuple[int, int]:
    rx = tx = 0
    with open("/proc/net/dev", encoding="ascii") as fh:
        for ln in fh.readlines()[2:]:
            nome, dados = ln.split(":", 1)
            nome = nome.strip()
            if nome.startswith(REDE_FORA):
                continue
            c = dados.split()
            rx += int(c[0])
            tx += int(c[8])
    return rx, tx


def processos() -> tuple[int, list[dict]]:
    """Sessões Claude (processo `claude` cujo pai não é `claude`) e os 5 nomes que mais somam RAM."""
    pagina_kb = os.sysconf("SC_PAGE_SIZE") // 1024
    info: dict[int, tuple[str, int, int]] = {}
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        try:
            with open(f"/proc/{d}/stat", encoding="utf-8", errors="replace") as fh:
                s = fh.read()
        except OSError:
            continue
        i, j = s.find("("), s.rfind(")")
        resto = s[j + 2:].split()
        info[int(d)] = (s[i + 1:j], int(resto[1]), int(resto[21]) * pagina_kb)  # comm, ppid, rss kB
    sessoes = sum(1 for comm, ppid, _ in info.values() if comm == "claude" and info.get(ppid, ("",))[0] != "claude")
    soma: dict[str, int] = {}
    for comm, _, rss in info.values():
        soma[comm] = soma.get(comm, 0) + rss
    top = sorted(soma.items(), key=lambda kv: kv[1], reverse=True)[:5]
    return sessoes, [{"nome": n, "mb": round(kb / 1024)} for n, kb in top]


def medir_maquina(maquina: str, est: dict, em: datetime) -> dict:
    t = time.time()
    total, ocioso = cpu_tempos()
    rx, tx = rede_bytes()
    ant = est.get("maquina") or {}
    if not ant or t - ant.get("t", 0) > 300 or t - ant.get("t", 0) < 5:
        # sem anterior útil: mede 1 s agora
        time.sleep(1)
        ant = {"t": t, "cpu_total": total, "cpu_ocioso": ocioso, "rx": rx, "tx": tx}
        t = time.time()
        total, ocioso = cpu_tempos()
        rx, tx = rede_bytes()
    dt = max(t - ant["t"], 0.001)
    dtot = total - ant["cpu_total"]
    cpu = round(100.0 * (1 - (ocioso - ant["cpu_ocioso"]) / dtot), 1) if dtot > 0 else None
    drx, dtx = rx - ant["rx"], tx - ant["tx"]
    est["maquina"] = {"t": t, "cpu_total": total, "cpu_ocioso": ocioso, "rx": rx, "tx": tx}

    with open("/proc/loadavg", encoding="ascii") as fh:
        l1, l5, l15 = (float(x) for x in fh.read().split()[:3])
    mi = meminfo()
    ram_tot = mi["MemTotal"] // 1024
    ram_usada = (mi["MemTotal"] - mi.get("MemAvailable", mi["MemFree"])) // 1024
    sw_tot = mi.get("SwapTotal", 0) // 1024
    sw_usada = (mi.get("SwapTotal", 0) - mi.get("SwapFree", 0)) // 1024
    vf = os.statvfs("/")
    d_tot = vf.f_blocks * vf.f_frsize
    d_usado = (vf.f_blocks - vf.f_bfree) * vf.f_frsize
    d_livre = vf.f_bavail * vf.f_frsize
    sessoes, top = processos()
    rss = max(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, est.get("rss_filhos_kb", 0)) / 1024
    return {
        "maquina": maquina, "em": iso(em), "cpu_pct": max(0.0, min(cpu, 100.0)) if cpu is not None else None,
        "carga1": l1, "carga5": l5, "carga15": l15, "ncpu": os.cpu_count(),
        "ram_total_mb": ram_tot, "ram_usada_mb": ram_usada, "ram_pct": round(100.0 * ram_usada / ram_tot, 1) if ram_tot else None,
        "swap_total_mb": sw_tot, "swap_usada_mb": sw_usada, "swap_pct": round(100.0 * sw_usada / sw_tot, 1) if sw_tot else 0.0,
        "disco_total_gb": round(d_tot / 1e9, 1), "disco_usado_gb": round(d_usado / 1e9, 1),
        "disco_pct": round(100.0 * d_usado / (d_usado + d_livre), 1) if d_usado + d_livre else None,
        "rede_rx_kb_s": round(max(drx, 0) / 1024 / dt, 1), "rede_tx_kb_s": round(max(dtx, 0) / 1024 / dt, 1),
        "sessoes_claude": sessoes, "coletor_rss_mb": round(rss, 1), "extra": {"top": top},
    }


# --------------------------------------------------------------------------------------------- gateways (contas)

def gateways() -> list[dict]:
    out = []
    for e in ler_json(GW_CFG, []):
        kf = Path(e.get("keyFile") or "")
        kf = kf if kf.is_absolute() else GW_KEYDIR / kf
        url = (e.get("baseUrl") or "").strip()
        if not url:
            try:
                url = Path(f"{kf}.url").read_text(encoding="utf-8").strip()
            except OSError:
                url = ""
        if url and kf.exists() and kf.stat().st_size > 0:
            out.append({"id": e["id"], "url": url.rstrip("/"), "chave": kf})
    return out


def auth_files(gw: dict) -> list[dict]:
    chave = gw["chave"].read_text(encoding="utf-8").lstrip("﻿").strip()
    req = urllib.request.Request(f"{gw['url']}/v0/management/auth-files", headers={"Authorization": f"Bearer {chave}"})
    # direto pela tailnet: proxy de saída do ambiente não serve para o gateway
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=25) as r:
        d = json.loads(r.read())
    files = d.get("files") or d.get("auth-files") or (d if isinstance(d, list) else [])
    return [f for f in files if "claude" in f"{f.get('provider') or ''}{f.get('type') or ''}".lower()
            or "anthropic" in f"{f.get('provider') or ''}{f.get('type') or ''}".lower()]


def _ts(x) -> datetime | None:
    if x in (None, "", 0):
        return None
    try:
        if isinstance(x, (int, float)) or str(x).isdigit():
            return datetime.fromtimestamp(int(x), timezone.utc)
        return datetime.fromisoformat(str(x).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, OSError, OverflowError):
        return None


def _pct(x) -> float | None:
    try:
        return round(float(x) * 100, 1)
    except (TypeError, ValueError):
        return None


def conta_de(f: dict, now: datetime) -> dict:
    sig = ((f.get("quota") or {}).get("signals")) or {}
    uso5h, volta5h = _pct(sig.get("Anthropic-Ratelimit-Unified-5h-Utilization")), _ts(sig.get("Anthropic-Ratelimit-Unified-5h-Reset"))
    uso7d, volta7d = _pct(sig.get("Anthropic-Ratelimit-Unified-7d-Utilization")), _ts(sig.get("Anthropic-Ratelimit-Unified-7d-Reset"))
    # janela que já renovou: o uso volta a zero (o cabeçalho é de antes da renovação)
    if volta5h and volta5h <= now:
        uso5h, volta5h = 0.0, None
    if volta7d and volta7d <= now:
        uso7d, volta7d = 0.0, None
    retornos = [_ts(c.get("retry_at")) for c in (f.get("cooldowns") or [])] + [_ts(f.get("next_retry_after"))]
    vigentes = [r for r in retornos if r and r > now]
    cooldown = max(vigentes) if vigentes else None
    desligada = bool(f.get("disabled"))
    indisp = bool(f.get("unavailable"))
    estado = str(f.get("status") or "")
    motivo = str(f.get("status_message") or "")
    passageiro = bool(RE_PASSAGEIRO.search(motivo))
    em429 = bool(cooldown) or (indisp and passageiro)
    disponivel = estado == "active" and not desligada and not indisp and not em429
    classe = classe_de(desligada, estado, motivo, em429, indisp, disponivel, uso5h, uso7d)
    return {
        "conta": str(f.get("email") or f.get("account") or f.get("name") or "?").lower(),
        "estado": estado, "desligada": desligada,
        "disponivel": disponivel, "classe": classe,
        "uso5h": uso5h, "volta5h": iso(volta5h), "uso7d": uso7d, "volta7d": iso(volta7d),
        "status_cota": sig.get("Anthropic-Ratelimit-Unified-Status"), "em_429": em429, "cooldown_ate": iso(cooldown),
        "motivo": str(f.get("status_message") or "")[:120], "ok_total": int(f.get("success") or 0),
        "falha_total": int(f.get("failed") or 0),
    }


def classe_de(desligada: bool, estado: str, motivo: str, em429: bool, indisp: bool, disponivel: bool,
              uso5h, uso7d) -> str:
    """fora = precisa de login (desligada, invalid_grant, 401/403 de auth); esgotada = espera e renova sozinha (cota,
    rate_limit, 429, sobrecarga, erro sem causa de login); com_cota = pode atender agora."""
    if desligada:
        return "fora"
    if RE_PASSAGEIRO.search(motivo):
        return "esgotada"
    if RE_LOGIN.search(motivo):
        return "fora"
    if em429 or indisp or (uso5h or 0) >= 100 or (uso7d or 0) >= 100:
        return "esgotada"
    return "com_cota" if disponivel else "esgotada"


def tem_cota(c: dict) -> bool:
    return c["disponivel"] and (c["uso5h"] or 0) < 100 and (c["uso7d"] or 0) < 100


def amostrar_gateway(gw: dict, em: datetime, now: datetime, est: dict) -> tuple[dict, list[dict]]:
    """Linha de gateway_minuto e as linhas de conta_amostra que mudaram (ou todas, na foto de hora em hora)."""
    eg = est.setdefault(gw["id"], {"contas": {}})
    if eg.get("bloqueado_ate", 0) > time.time():
        return {"gateway": gw["id"], "em": iso(em), "alcancavel": False, "erro": "chave recusada; pausa de 30 min"}, []
    try:
        files = auth_files(gw)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            eg["bloqueado_ate"] = time.time() + BACKOFF_CHAVE_S
        return {"gateway": gw["id"], "em": iso(em), "alcancavel": False, "erro": f"HTTP {e.code}"}, []
    except Exception as e:  # noqa: BLE001 - gateway fora (PC desligado) é estado, não erro do coletor
        return {"gateway": gw["id"], "em": iso(em), "alcancavel": False, "erro": type(e).__name__ + ": " + str(e)[:100]}, []
    foto = em.minute == 0 or not eg["contas"]
    ant_contas = eg["contas"]
    novas, linhas = {}, []
    req_ok = req_falha = 0
    no_minuto = []
    for f in files:
        c = conta_de(f, now)
        a = ant_contas.get(c["conta"])
        if a is None:
            dok = dfa = 0
        else:
            dok, dfa = c["ok_total"] - a["ok"], c["falha_total"] - a["falha"]
            if dok < 0 or dfa < 0:  # gateway reiniciou: contadores zeraram
                dok, dfa = max(c["ok_total"], 0), max(c["falha_total"], 0)
        req_ok += dok
        req_falha += dfa
        if dok > 0:
            no_minuto.append((dok, c["conta"]))
        assin = [c["estado"], c["disponivel"], c["desligada"], c["uso5h"], c["uso7d"], c["em_429"], c["cooldown_ate"],
                 c["status_cota"], c["ok_total"], c["falha_total"], c["classe"]]
        novas[c["conta"]] = {"ok": c["ok_total"], "falha": c["falha_total"], "a": assin, "volta": c["cooldown_ate"]
                             or (c["volta5h"] if (c["uso5h"] or 0) >= 100 else None) or c["volta7d"]}
        if foto or a is None or a.get("a") != assin:
            linhas.append({"gateway": gw["id"], "em": iso(em), "foto": foto, "req_ok": dok, "req_falha": dfa, **c})
    eg["contas"] = novas
    eg.pop("bloqueado_ate", None)
    if no_minuto:
        eg["conta_ativa"] = max(no_minuto)[1]
    cs =[{"disponivel": v["a"][1], "desligada": v["a"][2], "uso5h": v["a"][3], "uso7d": v["a"][4], "em_429": v["a"][5],
           "estado": v["a"][0]} for v in novas.values()]
    linha_gw = {
        "gateway": gw["id"], "em": iso(em), "alcancavel": True, "contas": len(cs),
        "ativas": sum(1 for c in cs if c["estado"] == "active" and not c["desligada"]),
        "com_cota": sum(1 for c in cs if tem_cota(c)), "em_429": sum(1 for c in cs if c["em_429"]),
        "com_erro": sum(1 for c in cs if c["estado"] == "error"), "desligadas": sum(1 for c in cs if c["desligada"]),
        "req_ok": req_ok, "req_falha": req_falha, "contas_no_minuto": len(no_minuto),
        "conta_ativa": eg.get("conta_ativa"), "erro": None,
        "esgotadas": sum(1 for v in novas.values() if v["a"][10] == "esgotada"),
        "fora": sum(1 for v in novas.values() if v["a"][10] == "fora"),
    }
    voltas = sorted(v["volta"] for v in novas.values() if v["a"][10] == "esgotada" and v["volta"])
    linha_gw["proxima_volta"] = voltas[0] if voltas else None
    limite_1h = iso(datetime.fromtimestamp(now.timestamp() + 3600, timezone.utc))
    linha_gw["voltam_1h"] = sum(1 for v in voltas if v <= limite_1h)
    return linha_gw, linhas


# --------------------------------------------------------------------------------------------- entrada do PC

def ler_entrada() -> tuple[list[dict], list[Path]]:
    linhas, arquivos = [], []
    if not ENTRADA.is_dir():
        return linhas, arquivos
    cols = set(TABELAS["maquina_minuto"])
    for p in sorted(ENTRADA.glob("*.json")):
        nome = p.name.split("-", 1)[0]
        arquivos.append(p)
        try:
            texto = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for ln in texto.splitlines():
            try:
                d = json.loads(ln)
            except ValueError:
                continue
            if isinstance(d, dict) and d.get("em"):
                d = {k: v for k, v in d.items() if k in cols}
                d["maquina"] = nome  # quem mandou é o nome do arquivo (saude_receber.sh), nunca o conteúdo
                linhas.append(d)
    return linhas, arquivos


# --------------------------------------------------------------------------------------------- gravação

def enfileirar(tabela: str, linhas: list[dict]) -> None:
    if not linhas:
        return
    PENDENTE.mkdir(parents=True, exist_ok=True)
    p = PENDENTE / f"{tabela}.jsonl"
    with p.open("a", encoding="utf-8") as fh:
        for ln in linhas:
            fh.write(json.dumps(ln, ensure_ascii=False) + "\n")
    if p.stat().st_size > MAX_PENDENTE_BYTES:
        resto = p.read_bytes()[-MAX_PENDENTE_BYTES // 2:]
        p.write_bytes(resto[resto.find(b"\n") + 1:])


def sql_insert(tabela: str, linhas: list[dict]) -> str:
    cols = ", ".join(TABELAS[tabela])
    corpo = json.dumps(linhas, ensure_ascii=False)
    tag = "j"
    while f"${tag}$" in corpo:
        tag = "j" + secrets.token_hex(4)
    return (f"insert into saude.{tabela} ({cols}) select {cols} from json_populate_recordset(null::saude.{tabela}, "
            f"${tag}${corpo}${tag}$) on conflict do nothing;\n")


def descarregar(est: dict) -> dict:
    """Manda todo o pendente numa transação só. rc 2 (sem conexão) guarda; rc 3 (SQL recusado) põe em quarentena."""
    blocos, arquivos = [], []
    for tabela in TABELAS:
        p = PENDENTE / f"{tabela}.jsonl"
        if not p.exists() or p.stat().st_size == 0:
            continue
        linhas = []
        for ln in p.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                linhas.append(json.loads(ln))
            except ValueError:
                pass
        for i in range(0, len(linhas), 2000):
            blocos.append(sql_insert(tabela, linhas[i:i + 2000]))
        arquivos.append((p, len(linhas)))
    if not blocos:
        return {"enviado": 0}
    try:
        senha = SENHA.read_text(encoding="utf-8").strip()
    except OSError:
        return {"erro": "sem senha do gravador"}
    sql = "begin;\n" + "".join(blocos) + "commit;\n"
    try:
        p = subprocess.run(
            ["psql", f"host={HOST} port={PORTA} user=saude_gravador.{REF} dbname=postgres sslmode=require connect_timeout=15",
             "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
            input=sql, env={"PATH": "/usr/bin:/bin", "PGPASSWORD": senha, "HOME": str(HOME)},
            capture_output=True, text=True, timeout=50)
        rc, err = p.returncode, (p.stderr or "").replace(senha, "***").strip()[:300]
    except subprocess.TimeoutExpired:
        rc, err = 2, "timeout"
    est["rss_filhos_kb"] = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    if rc == 0:
        for f, _ in arquivos:
            f.unlink(missing_ok=True)
        return {"enviado": sum(n for _, n in arquivos)}
    if rc == 3:
        q = PENDENTE / "quarentena"
        q.mkdir(exist_ok=True)
        for f, _ in arquivos:
            os.replace(f, q / f"{f.stem}-{int(time.time())}.jsonl")
        return {"erro": f"SQL recusado (quarentena): {err}"}
    return {"erro": f"sem gravar (rc {rc}), guardado: {err}"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--maquina", required=True)
    ap.add_argument("--gateways", action="store_true")
    ap.add_argument("--entrada", action="store_true")
    ap.add_argument("--seco", action="store_true")
    a = ap.parse_args()
    DIR.mkdir(parents=True, exist_ok=True)
    now = agora_utc()
    em = now.replace(second=0, microsecond=0)
    est = ler_json(ESTADO, {})
    resumo: dict = {"em": iso(em)}

    m = medir_maquina(a.maquina, est, em)
    resumo["maquina"] = {k: m[k] for k in ("cpu_pct", "carga1", "ram_pct", "swap_pct", "disco_pct", "sessoes_claude", "coletor_rss_mb")}
    gws, contas = [], []
    if a.gateways:
        estc = ler_json(ESTADO_CONTAS, {})
        for gw in gateways():
            lg, lc = amostrar_gateway(gw, em, now, estc)
            gws.append(lg)
            contas += lc
        resumo["gateways"] = {g["gateway"]: (g.get("com_cota"), g.get("contas"), g.get("erro")) for g in gws}
        resumo["contas_gravadas"] = len(contas)
    entrada, arquivos = (ler_entrada() if a.entrada else ([], []))
    if a.entrada:
        resumo["entrada"] = len(entrada)

    if a.seco:
        print(json.dumps({"maquina": m, "gateways": gws, "contas": contas[:3], "n_contas": len(contas), "entrada": len(entrada)},
                         ensure_ascii=False, indent=1))
        return 0
    enfileirar("maquina_minuto", [m] + entrada)
    enfileirar("gateway_minuto", gws)
    enfileirar("conta_amostra", contas)
    for p in arquivos:  # já está no pendente: pode apagar a entrada
        p.unlink(missing_ok=True)
    if a.gateways:
        gravar_json(ESTADO_CONTAS, estc)
    resumo.update(descarregar(est))
    gravar_json(ESTADO, est)
    print(json.dumps(resumo, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
