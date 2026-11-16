#!/usr/bin/env python3
"""Troca a senha de um papel do schema saude (saude_gravador ou saude_leitor), na VPS pessoal (t-16393812).

Gera a senha nova dentro do processo, aplica o ALTER ROLE como dono do banco (senha por stdin/PGPASSWORD, nunca argv),
grava ~/.config/donel-saude/<papel> (600) aqui e, para o gravador, nas outras VPS (Homologações e vps-people) por scp
de um arquivo 600. Confere que a senha antiga é recusada e a nova entra. Imprime só linhas de status, nenhum valor.
uso: trocar_senha.py gravador|leitor
"""
import os
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path

REF = "hotkktdvbjpibkigpopq"
HOST = "aws-1-sa-east-1.pooler.supabase.com"
CFG = Path.home() / ".config" / "donel-saude"
ADMIN = Path.home() / ".config" / "donel-espelho" / "db-password"
REMOTOS = {"gravador": [("homologacoes-2222", "/root/.config/donel-saude/gravador"),
                        ("vps-people", "/home/time-people/.config/donel-saude/gravador")], "leitor": []}


def entra(papel: str, senha: str) -> str:
    p = subprocess.run(["psql", f"host={HOST} port=6543 user=saude_{papel}.{REF} dbname=postgres sslmode=require connect_timeout=15",
                        "-XAtc", "select 1"], env={"PATH": "/usr/bin:/bin", "PGPASSWORD": senha}, capture_output=True, text=True, timeout=40)
    if p.returncode == 0:
        return "entra"
    return "recusada" if "password authentication failed" in p.stderr or "authentication" in p.stderr.lower() else "erro de conexão"


def main() -> int:
    papel = sys.argv[1] if len(sys.argv) > 1 else ""
    if papel not in REMOTOS:
        print("uso: trocar_senha.py gravador|leitor")
        return 2
    arq = CFG / papel
    antiga = arq.read_text().strip()
    nova = secrets.token_urlsafe(32)
    admin = ADMIN.read_text().strip()
    # 1. arquivo novo ao lado (600), ainda sem trocar
    tmp = CFG / f".{papel}.novo"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.write(fd, nova.encode())
    os.close(fd)
    # 2. ALTER ROLE sem eco
    p = subprocess.run(["psql", f"host={HOST} port=5432 user=postgres.{REF} dbname=postgres sslmode=require connect_timeout=20",
                        "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
                       input=f"\\set ON_ERROR_STOP on\n\\set s '{nova}'\nalter role saude_{papel} with password :'s';\n",
                       env={"PATH": "/usr/bin:/bin", "PGPASSWORD": admin}, capture_output=True, text=True, timeout=60)
    if p.returncode != 0:
        tmp.unlink()
        print(f"alter role saude_{papel}: falhou (rc {p.returncode}); nada trocado")
        return 1
    print(f"alter role saude_{papel}: aplicado")
    # 3. troca o arquivo aqui e nas outras VPS
    os.replace(tmp, arq)
    print(f"vps-pessoal {arq}: trocado (600)")
    for alias, destino in REMOTOS[papel]:
        r = subprocess.run(["scp", "-q", "-p", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", str(arq), f"{alias}:{destino}.novo"],
                           capture_output=True, text=True, timeout=60)
        if r.returncode == 0:
            r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", alias,
                                f"chmod 600 {destino}.novo && mv {destino}.novo {destino} && stat -c %a {destino}"],
                               capture_output=True, text=True, timeout=60)
        print(f"{alias} {destino}: {'trocado (' + r.stdout.strip() + ')' if r.returncode == 0 else 'FALHOU rc ' + str(r.returncode)}")
    # 4. prova
    print(f"senha antiga: {entra(papel, antiga)}")
    print(f"senha nova: {entra(papel, nova)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
