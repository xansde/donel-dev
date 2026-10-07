"""Spec 010 (A14) — a política de review ESTRUTURADA do repo-alvo.

Espelho de `src/shared/esteira/contract/reviewPolicy.ts`, pelo mesmo motivo de
`esteira_contract.py`: o fork mora DENTRO do donel-dev, então não há cópia do
formato para divergir.

Antes de hoje, quantos revisores um risco pede era prosa no CLAUDE.md do
repo-alvo — a fase Concluir tinha que ler e confiar de boa vontade (ou, pior,
aceitar uma política que o próprio prompt/payload afirmasse). A fonte agora é
`.esteira/review-policy.json`, na raiz do repo-alvo — o MESMO prefixo
`.esteira/` que já guarda os handoffs de fase deste repo. O CLAUDE.md continua
existindo, mas como EXPLICAÇÃO para gente, não como fonte que o gate lê.

Use antes de declarar a evidência de review na fase Concluir:

    python tools/review_policy.py --repo <caminho do repo-alvo> --risk sensivel

Documento AUSENTE não é erro: o repo simplesmente não tem política própria, e
cai no default da esteira ("default-risco-esteira"). Documento PRESENTE e
ILEGÍVEL é outra coisa — levanta `ReviewPolicyError`, porque "tem arquivo e não
dá para ler" não é a mesma promessa que "não tem arquivo".

Sem dependência externa: só a biblioteca padrão.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REVIEW_POLICY_FILE = ".esteira/review-policy.json"

RISKS: tuple[str, ...] = ("trivial", "sensivel")

# A régua DEFAULT da esteira: sensível pede DOIS revisores, trivial pede UM.
# Repo sem `.esteira/review-policy.json` cai aqui — nunca em zero, que seria
# "não pede revisor nenhum" por omissão.
DEFAULT_REQUIRED_REVIEWERS: dict[str, int] = {"trivial": 1, "sensivel": 2}


class ReviewPolicyError(Exception):
    """O arquivo EXISTE e está fora do formato — nunca a ausência dele."""


def _review_policy_path(repo_path: str | Path) -> Path:
    return Path(repo_path) / REVIEW_POLICY_FILE


def load_review_policy(repo_path: str | Path) -> dict[str, Any] | None:
    """Lê `.esteira/review-policy.json` do repo-alvo. `None` = sem política própria.

    Levanta `ReviewPolicyError` quando o arquivo EXISTE e é ilegível — repo com
    política quebrada não deve cair silenciosamente no default, porque isso
    esconderia exatamente o defeito ("campo que só um lado conhece") que fez a
    política precisar ser estruturada.
    """
    path = _review_policy_path(repo_path)
    if not path.exists():
        return None

    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ReviewPolicyError(f"não consegui ler {path}: {error}") from error

    try:
        document = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ReviewPolicyError(f"{path} não é JSON válido: {error}") from error

    if not isinstance(document, dict):
        raise ReviewPolicyError(f"{path} precisa ser um objeto JSON")

    allowed = {"schema_version", "required_reviewers", "note"}
    unknown = set(document) - allowed
    if unknown:
        raise ReviewPolicyError(f"{path} tem campo(s) desconhecido(s): {sorted(unknown)}")

    required = document.get("required_reviewers")
    if not isinstance(required, dict):
        raise ReviewPolicyError(f'{path}: campo "required_reviewers" precisa ser um objeto')

    unknown_risks = set(required) - set(RISKS)
    if unknown_risks:
        raise ReviewPolicyError(f"{path}: risco(s) desconhecido(s) em required_reviewers: {sorted(unknown_risks)}")

    for risk in RISKS:
        value = required.get(risk)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ReviewPolicyError(f'{path}: required_reviewers.{risk} precisa ser um inteiro não-negativo')

    return document


def required_reviewers(repo_path: str | Path, risk: str) -> int:
    """A régua DE AGORA para um risco: a do repo, quando existe; senão o default.

    `risk` fora de `RISKS` levanta `ValueError` — o mesmo rigor que os outros
    contratos da esteira aplicam a enum desconhecido.
    """
    if risk not in RISKS:
        raise ValueError(f"risco fora do contrato: {risk!r} (esperado um de {RISKS})")

    policy = load_review_policy(repo_path)
    if policy is None:
        return DEFAULT_REQUIRED_REVIEWERS[risk]
    return int(policy["required_reviewers"][risk])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Le a política de review estruturada do repo-alvo (A14).")
    parser.add_argument("--repo", required=True, help="raiz do repo-alvo (onde `.esteira/review-policy.json` mora, se existir)")
    parser.add_argument("--risk", required=True, choices=RISKS)
    args = parser.parse_args(argv)

    try:
        count = required_reviewers(args.repo, args.risk)
    except ReviewPolicyError as error:
        print(f"erro de política de review: {error}", file=sys.stderr)
        return 1

    print(count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
