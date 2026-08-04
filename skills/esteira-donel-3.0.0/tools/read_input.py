"""Lê o `run-input.json` que o app deixou e imprime em texto legível.

A fase inteira começa aqui. O que este resumo garante que a skill veja:

- o **assunto** (discovery, plano, item) e o **alvo** — nunca inferido;
- o **histórico**, com as fases que falharam e o código do erro. É o que impede
  a skill de repetir uma tentativa que já quebrou achando que é a primeira vez;
- para onde o `result.json` deve voltar (`outbox.result_path`).

`--json` imprime o documento cru, para quando a skill quiser os campos exatos.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import esteira_contract as contract  # noqa: E402


def render(document: dict) -> str:
    run = document["run"]
    subject = document["subject"]
    context = document["context"]
    discovery = context["discovery"]
    workspace = document.get("workspace")

    lines: list[str] = []
    lines.append(f"FASE: {run['phase']}  ·  run {run['run_id']}  ·  pedida em {run['requested_at']}")
    if run.get("continues_session_id"):
        lines.append(f"  ↳ continua a sessao {run['continues_session_id']} — {run.get('handoff_reason') or 'sem motivo registrado'}")

    lines.append("")
    lines.append(f"DISCOVERY {discovery['id']}: {discovery['title']}")
    if discovery.get("problem"):
        lines.append(f"  problema: {discovery['problem']}")
    if discovery.get("tracker"):
        lines.append(f"  card no board: {discovery['tracker']['provider']} {discovery['tracker']['card_id']} (referencia, nunca fonte de estado)")
    lines.append(f"  etapa calculada pelo app: {context.get('derived_stage', '—')}")

    if context.get("plan"):
        plan = context["plan"]
        lines.append(f"PLANO {plan['id']}: {plan['title']}")
        if plan.get("summary"):
            lines.append(f"  {plan['summary']}")

    if context.get("work_item"):
        item = context["work_item"]
        lines.append(f"ITEM {item['id']}: {item['title']}  [{item['item_type']} · {item['state']}]")
        lines.append(f"  repo alvo: {item.get('target_repo') or 'NENHUM'}")

    lines.append("")
    if workspace is None:
        lines.append("ALVO: nenhum repo (a fase nao toca codigo).")
    else:
        lines.append(f"ALVO: {workspace['target_repo']}")
        for key, label in (("repo_path", "checkout"), ("worktree_path", "worktree"), ("branch", "branch")):
            if workspace.get(key):
                lines.append(f"  {label}: {workspace[key]}")

    history = context.get("history", [])
    lines.append("")
    if not history:
        lines.append("HISTORICO: nenhuma fase registrada ainda.")
    else:
        lines.append("HISTORICO:")
        for entry in history:
            if entry.get("failure"):
                # A tentativa que falhou aparece com destaque: e o insumo mais
                # caro de ignorar.
                lines.append(f"  ! {entry['phase']} FALHOU — {entry['failure']['code']}: {entry['failure']['message']}")
            elif entry.get("outcome"):
                summary = f" — {entry['summary']}" if entry.get("summary") else ""
                lines.append(f"  · {entry['phase']}: {entry['outcome']}{summary}")
            else:
                lines.append(f"  · {entry['phase']}: registrada")

    notes = context.get("notes", [])
    if notes:
        lines.append("")
        lines.append("NOTAS:")
        for note in notes:
            lines.append(f"  · {note['text']}")

    lines.append("")
    lines.append(f"DEVOLVER EM: {document['outbox']['result_path']}")
    lines.append(f"  (subject: discovery={subject['discovery_id']} plan={subject.get('plan_id')} item={subject.get('work_item_id')})")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Le o run-input.json da esteira (contrato v1).")
    parser.add_argument("--input", required=True)
    parser.add_argument("--json", action="store_true", help="imprime o documento cru")
    args = parser.parse_args(argv)

    try:
        document = contract.read_run_input(args.input)
    except contract.ContractError as error:
        # Recusa explicita: a skill nao roda com um contexto que nao entende.
        print(f"erro de contrato: {error}", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"erro ao ler: {error}", file=sys.stderr)
        return 1

    print(json.dumps(document, ensure_ascii=False, indent=2) if args.json else render(document))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
