#!/usr/bin/env python3
"""Manda um aviso ao Líder de um quadro do Donel ("lider-quadro") por uma sessão local desse quadro (t-16393812).

Mesmo caminho do despertador: acha uma sessão viva do quadro no tmux "donel", que não seja o próprio Líder, e chama o
sessao_enviar pelo MCP dela. Texto pelo stdin. Imprime uma palavra: entregue, app-tentando, incerto, falhou ou sem-emissor.
uso: echo "texto" | saude_avisar.py --quadro "Donel Dev" [--seco]
Lê só mcpPort/mcpToken/projectName do meta.json de cada sessão, dentro do processo; nada disso sai na saída.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

S = Path.home() / ".donel" / "s"


def sessoes_vivas() -> list[str]:
    try:
        out = subprocess.run(["tmux", "-L", "donel", "ls", "-F", "#{session_name}"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [x[6:] for x in out.split() if x.startswith("donel-")]


def meta(u: str) -> dict:
    try:
        return json.loads((S / u / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def mcp(m: dict, tool: str, args: dict, timeout: int):
    req = urllib.request.Request(
        f"http://127.0.0.1:{m['mcpPort']}/mcp",
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args}}).encode(),
        {"Authorization": f"Bearer {m['mcpToken']}", "Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
    )
    corpo = urllib.request.urlopen(req, timeout=timeout).read().decode()
    if corpo.startswith("event:") or "\ndata:" in corpo:
        corpo = next(ln[5:].strip() for ln in corpo.splitlines() if ln.startswith("data:"))
    res = json.loads(corpo)["result"]
    txt = res["content"][0]["text"]
    if res.get("isError"):
        raise RuntimeError(txt[:200])
    return txt


def avisar(quadro: str, texto: str) -> str:
    tentativas = 0
    for u in sessoes_vivas():
        m = meta(u)
        if m.get("projectName") != quadro or not m.get("mcpPort") or not m.get("mcpToken"):
            continue
        try:
            quem = json.loads(mcp(m, "sessao_quem_sou", {}, 8))
        except Exception:  # noqa: BLE001 - MCP fora: tenta a próxima
            continue
        if quem.get("papel") == "lider":
            continue  # "lider-quadro" recusa o próprio Líder
        tentativas += 1
        try:
            r = mcp(m, "sessao_enviar", {"para": "lider-quadro", "texto": texto}, 45)
            return "entregue" if r.startswith("Entregue") else ("app-tentando" if "segue tentando" in r else "incerto")
        except TimeoutError:
            return "incerto"
        except urllib.error.URLError as e:
            if isinstance(getattr(e, "reason", None), TimeoutError):
                return "incerto"
        except Exception:  # noqa: BLE001
            pass
        if tentativas >= 2:
            return "falhou"
    return "sem-emissor" if tentativas == 0 else "falhou"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quadro", required=True)
    ap.add_argument("--seco", action="store_true")
    a = ap.parse_args()
    texto = sys.stdin.read().strip()
    if not texto:
        print("vazio")
        return 2
    if a.seco:
        print("seco")
        return 0
    print(avisar(a.quadro, texto))
    return 0


if __name__ == "__main__":
    sys.exit(main())
