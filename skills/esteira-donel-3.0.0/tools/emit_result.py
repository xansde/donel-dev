"""CLI de emissão do `result.json` — a única porta pela qual a skill responde.

Uso, do diretório da fase:

    python tools/emit_result.py --input <run-input.json> \
        --status success --started-at <ISO> --facts-file <facts.json>

`facts.json` é uma lista de fatos declarados. Cada um passa pela função
construtora do tipo (`esteira_contract.py`), que **recusa** o que o app
recusaria ler: item `issue` sem repo, artefato com ponteiro que não resolve,
fase concluída sem os fatos que ela promete, id fora do padrão.

Por que existe: escrever o JSON direto no prompt é como um campo passa a
existir de um lado só. Aqui, o que não cabe no contrato não chega ao disco —
o erro aparece na hora, para quem está rodando a fase, e não meses depois numa
tela que mente.

Saída: o caminho do arquivo gravado (o `outbox.result_path` que o app pediu).
Erro de contrato sai por stderr com código de saída 1 e NADA é gravado.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import esteira_contract as contract  # noqa: E402

FACT_BUILDERS = {
    "discovery.recorded": lambda f: contract.discovery_recorded(
        f["discovery_id"],
        f["title"],
        problem=f.get("problem"),
        tracker=f.get("tracker"),
        target_repo=f.get("target_repo"),
        scope_repos=f.get("scope_repos", ()),
    ),
    "plan.recorded": lambda f: contract.plan_recorded(f["plan_id"], f["discovery_id"], f["title"], summary=f.get("summary")),
    "work_item.recorded": lambda f: contract.work_item_recorded(
        f["work_item_id"],
        f["item_type"],
        f["title"],
        plan_id=f.get("plan_id"),
        target_repo=f.get("target_repo"),
        scope_repos=f.get("scope_repos", ()),
    ),
    "relation.recorded": lambda f: contract.relation_recorded(f["relation"], f["from"], f["to"]),
    "artifact.recorded": lambda f: contract.artifact_recorded(
        f["owner"], f["artifact_kind"], f["location"], f["path"], repo=f.get("repo")
    ),
    "verification.recorded": lambda f: contract.verification_recorded(
        f["subject"], f["verification_kind"], f["state"], ref=f.get("ref")
    ),
    "phase.completed": lambda f: contract.phase_completed(f["subject"], f["phase"], f["outcome"], summary=f.get("summary")),
    "lock.acquired": lambda f: contract.lock_acquired(
        f["subject"], f["phase"], f["acquired_at"], cli_session_id=f.get("cli_session_id")
    ),
    "lock.released": lambda f: contract.lock_released(f["subject"], f["phase"]),
    "note.recorded": lambda f: contract.note_recorded(f["subject"], f["text"]),
    "gate.confirmed": lambda f: contract.gate_confirmed(
        f["subject"], f["condition"], f["confirmed_by"], confirmed_at=f.get("confirmed_at")
    ),
    "decision.recorded": lambda f: contract.decision_recorded(
        f["subject"], f["decision"], f["confirmed_by"], rationale=f.get("rationale")
    ),
    "human_review.recorded": lambda f: contract.human_review_recorded(f["subject"], f["phase"], f["checklist"]),
}


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"


def build_facts(raw_facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_facts):
        fact_type = raw.get("type")
        builder = FACT_BUILDERS.get(fact_type)
        if builder is None:
            raise contract.ContractError(f"facts[{index}]: tipo desconhecido {fact_type!r}")
        try:
            facts.append(builder(raw))
        except KeyError as error:
            raise contract.ContractError(f"facts[{index}] ({fact_type}): campo obrigatorio ausente {error}") from error
    return facts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Emite o result.json da esteira (contrato v1).")
    parser.add_argument("--input", required=True, help="run-input.json que o app deixou no inbox")
    parser.add_argument("--facts-file", required=True, help="JSON com a lista de fatos declarados")
    parser.add_argument("--status", default="success", choices=["success", "failed", "aborted"])
    parser.add_argument("--started-at", default=None, help="ISO 8601 UTC; default = agora")
    parser.add_argument("--failure-code", default=None)
    parser.add_argument("--failure-message", default=None)
    parser.add_argument("--model", default=None)
    parser.add_argument("--effort", default=None)
    parser.add_argument("--cli-session-id", default=None)
    args = parser.parse_args(argv)

    try:
        run_input = contract.read_run_input(args.input)
        raw_facts = json.loads(Path(args.facts_file).read_text(encoding="utf-8"))
        if not isinstance(raw_facts, list):
            raise contract.ContractError("facts-file precisa ser uma LISTA de fatos")

        failure = None
        if args.status != "success":
            if not args.failure_code or not args.failure_message:
                # Um desfecho ruim precisa ser legível: "falhou, não sei por quê"
                # é o mesmo "não sei" travestido de fato que a spec extingue.
                raise contract.ContractError("status != success exige --failure-code e --failure-message")
            failure = {"code": args.failure_code, "message": args.failure_message}

        result = contract.build_result(
            run_id=run_input["run"]["run_id"],
            phase=run_input["run"]["phase"],
            status=args.status,
            started_at=args.started_at or run_input["run"]["requested_at"],
            finished_at=now_iso(),
            discovery_id=run_input["subject"]["discovery_id"],
            plan_id=run_input["subject"].get("plan_id"),
            work_item_id=run_input["subject"].get("work_item_id"),
            workspace=run_input.get("workspace"),
            facts=build_facts(raw_facts),
            failure=failure,
            model=args.model,
            effort=args.effort,
            cli_session_id=args.cli_session_id,
        )

        written = contract.write_result(result, run_input["outbox"]["result_path"])
    except contract.ContractError as error:
        print(f"erro de contrato: {error}", file=sys.stderr)
        return 1
    except (OSError, json.JSONDecodeError) as error:
        print(f"erro ao emitir: {error}", file=sys.stderr)
        return 1

    print(str(written))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
