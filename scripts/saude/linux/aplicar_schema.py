#!/usr/bin/env python3
"""Aplica o schema `saude` no Supabase oraculo-harrow (t-16393812), na VPS pessoal.

Cria (uma vez) as senhas dos papéis saude_gravador e saude_leitor em ~/.config/donel-saude/ (600) e roda o SQL como o
dono do banco, cuja senha mora em ~/.config/donel-espelho/db-password. Nenhuma senha vai para argv, log ou saída: o psql
as recebe por stdin (\\set) e por PGPASSWORD.
uso: aplicar_schema.py [arquivo.sql]   (padrão: ../sql/001_saude.sql)
"""
import os
import secrets
import subprocess
import sys
from pathlib import Path

REF = "hotkktdvbjpibkigpopq"
HOST = "aws-1-sa-east-1.pooler.supabase.com"
CFG = Path.home() / ".config" / "donel-saude"
ADMIN = Path.home() / ".config" / "donel-espelho" / "db-password"


def senha(nome: str) -> str:
    CFG.mkdir(parents=True, exist_ok=True, mode=0o700)
    f = CFG / nome
    if not f.exists():
        fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.write(fd, secrets.token_urlsafe(32).encode())
        os.close(fd)
    return f.read_text().strip()


def main() -> int:
    sql = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "sql" / "001_saude.sql"
    g, l_ = senha("gravador"), senha("leitor")
    pw = ADMIN.read_text().strip()
    entrada = f"\\set ON_ERROR_STOP on\n\\set senha_gravador '{g}'\n\\set senha_leitor '{l_}'\n\\i '{sql}'\n"
    p = subprocess.run(["psql", f"host={HOST} port=5432 user=postgres.{REF} dbname=postgres sslmode=require connect_timeout=20",
                        "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
                       input=entrada, env=dict(os.environ, PGPASSWORD=pw), capture_output=True, text=True, timeout=180)
    saida = (p.stdout + p.stderr)
    for s in (pw, g, l_):
        saida = saida.replace(s, "***")
    print(saida.strip()[-2000:] or "ok")
    return p.returncode


if __name__ == "__main__":
    sys.exit(main())
