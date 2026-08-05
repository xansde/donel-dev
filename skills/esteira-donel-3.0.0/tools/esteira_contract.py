"""Spec 010 — lado SKILL do contrato da esteira (fork esteira-donel-3.0.0).

Este modulo e o espelho de `src/shared/esteira/contract/resultContract.ts`:

    run-input.json  — o app PRODUZ, a skill CONSOME  -> CONSUMED_PATHS (aqui)
    result.json     — a skill PRODUZ, o app CONSOME  -> EMITTED_PATHS  (aqui)

Duas regras que ele existe para cumprir:

1. **A skill nao escreve JSON a mao.** Prompt redigindo JSON livre e como
   campos divergem sem ninguem notar — foi assim que a 2.1.0 nunca gravou
   `plan_cards[]` e o app leu a ausencia como "fase nao realizada". Aqui a
   emissao passa por funcoes com uma lista EXPLICITA de campos emitidos.
2. **O que a fase nao fez, ela nao declara.** Fato nao declarado e fato que
   nao aconteceu; e fase que falhou declara `status` + `failure`, nunca
   silencio.

Como o fork mora DENTRO do donel-dev (decisao de 03/08), ele le o schema
ORIGINAL — nao ha copia para divergir, e por isso nao ha hash de
sincronizacao para conferir. Se o fork sair daqui um dia, o hash volta.

Sem dependencia externa: so a biblioteca padrao.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable

CONTRACT_VERSION = "1.0.0"
TOOL_NAME = "esteira-donel"
TOOL_VERSION = "3.0.0"

# O schema canonico vive no app; o fork o le do mesmo lugar.
CONTRACT_DIR = Path(__file__).resolve().parents[3] / "src" / "shared" / "esteira" / "contract" / "v1"
RESULT_SCHEMA_PATH = CONTRACT_DIR / "esteira-result.schema.json"
RUN_INPUT_SCHEMA_PATH = CONTRACT_DIR / "esteira-run-input.schema.json"

ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")
PHASE_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,39}$")

# ---------------------------------------------------------------------------
# O que a skill GRAVA — o espelho de CONSUMED_PATHS do lado do app
# ---------------------------------------------------------------------------

EMITTED_PATHS: tuple[str, ...] = (
    "contract_version",
    "kind",
    "run.run_id",
    "run.phase",
    "run.status",
    "run.started_at",
    "run.finished_at",
    "run.failure.code",
    "run.failure.message",
    "actor.tool",
    "actor.tool_version",
    "actor.executor",
    "actor.model",
    "actor.effort",
    "actor.cli_session_id",
    "subject.discovery_id",
    "subject.plan_id",
    "subject.work_item_id",
    "workspace.target_repo",
    "workspace.repo_path",
    "workspace.worktree_path",
    "workspace.branch",
    "facts[discovery.recorded].type",
    "facts[discovery.recorded].discovery_id",
    "facts[discovery.recorded].title",
    "facts[discovery.recorded].problem",
    "facts[discovery.recorded].tracker.provider",
    "facts[discovery.recorded].tracker.card_id",
    "facts[discovery.recorded].target_repo",
    "facts[discovery.recorded].scope_repos[]",
    "facts[plan.recorded].type",
    "facts[plan.recorded].plan_id",
    "facts[plan.recorded].discovery_id",
    "facts[plan.recorded].title",
    "facts[plan.recorded].summary",
    "facts[work_item.recorded].type",
    "facts[work_item.recorded].work_item_id",
    "facts[work_item.recorded].plan_id",
    "facts[work_item.recorded].item_type",
    "facts[work_item.recorded].title",
    "facts[work_item.recorded].target_repo",
    "facts[work_item.recorded].scope_repos[]",
    "facts[relation.recorded].type",
    "facts[relation.recorded].relation",
    "facts[relation.recorded].from.entity",
    "facts[relation.recorded].from.id",
    "facts[relation.recorded].to.entity",
    "facts[relation.recorded].to.id",
    "facts[artifact.recorded].type",
    "facts[artifact.recorded].owner.entity",
    "facts[artifact.recorded].owner.id",
    "facts[artifact.recorded].artifact_kind",
    "facts[artifact.recorded].location",
    "facts[artifact.recorded].repo",
    "facts[artifact.recorded].path",
    "facts[verification.recorded].type",
    "facts[verification.recorded].subject.entity",
    "facts[verification.recorded].subject.id",
    "facts[verification.recorded].verification_kind",
    "facts[verification.recorded].state",
    "facts[verification.recorded].ref",
    "facts[phase.completed].type",
    "facts[phase.completed].subject.entity",
    "facts[phase.completed].subject.id",
    "facts[phase.completed].phase",
    "facts[phase.completed].outcome",
    "facts[phase.completed].summary",
    "facts[lock.acquired].type",
    "facts[lock.acquired].subject.entity",
    "facts[lock.acquired].subject.id",
    "facts[lock.acquired].phase",
    "facts[lock.acquired].holder.kind",
    "facts[lock.acquired].holder.acquired_at",
    "facts[lock.acquired].holder.cli_session_id",
    "facts[lock.released].type",
    "facts[lock.released].subject.entity",
    "facts[lock.released].subject.id",
    "facts[lock.released].phase",
    "facts[note.recorded].type",
    "facts[note.recorded].subject.entity",
    "facts[note.recorded].subject.id",
    "facts[note.recorded].text",
    "facts[gate.confirmed].type",
    "facts[gate.confirmed].subject.entity",
    "facts[gate.confirmed].subject.id",
    "facts[gate.confirmed].condition",
    "facts[gate.confirmed].confirmed_by",
    "facts[gate.confirmed].confirmed_at",
)

# O que a skill LE do `run-input.json`. Mesma disciplina, na outra direcao:
# campo que ela le e o app nao grava (ou vice-versa) reprova o teste espelho.
CONSUMED_PATHS: tuple[str, ...] = (
    "contract_version",
    "kind",
    "run.run_id",
    "run.phase",
    "run.requested_at",
    "run.continues_session_id",
    "run.handoff_reason",
    "subject.discovery_id",
    "subject.plan_id",
    "subject.work_item_id",
    "workspace.target_repo",
    "workspace.repo_path",
    "workspace.worktree_path",
    "workspace.branch",
    "outbox.result_path",
    "context.discovery.id",
    "context.discovery.title",
    "context.discovery.problem",
    "context.discovery.tracker.provider",
    "context.discovery.tracker.card_id",
    "context.discovery.target_repo",
    "context.discovery.scope_repos[]",
    "context.plan.id",
    "context.plan.title",
    "context.plan.summary",
    "context.work_item.id",
    "context.work_item.title",
    "context.work_item.item_type",
    "context.work_item.state",
    "context.work_item.target_repo",
    "context.work_item.scope_repos[]",
    "context.derived_stage",
    "context.history[].phase",
    "context.history[].outcome",
    "context.history[].summary",
    "context.history[].completed_at",
    "context.history[].failure.code",
    "context.history[].failure.message",
    "context.notes[].text",
    "context.notes[].at",
)


class ContractError(Exception):
    """Erro de contrato — a skill para e diz por que, nunca grava pela metade."""


# ---------------------------------------------------------------------------
# Leitura do run-input.json (a IDA)
# ---------------------------------------------------------------------------


def read_run_input(path: str | Path) -> dict[str, Any]:
    """Le o `run-input.json` que o app deixou. Recusa o que nao entende."""
    raw = Path(path).read_text(encoding="utf-8")
    try:
        document = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ContractError(f"run-input.json ilegivel: {error}") from error

    if document.get("kind") != "esteira.run-input":
        raise ContractError(f'kind inesperado: {document.get("kind")!r}')

    version = document.get("contract_version", "")
    if not isinstance(version, str) or version.split(".")[0] != CONTRACT_VERSION.split(".")[0]:
        # Major diferente: recusa explicita, nunca adivinhacao.
        raise ContractError(f"contrato {version!r} incompativel — esta skill implementa {CONTRACT_VERSION}")

    for field in ("run", "subject", "outbox", "context"):
        if field not in document:
            raise ContractError(f'campo obrigatorio ausente no run-input: "{field}"')

    return document


# ---------------------------------------------------------------------------
# Emissao do result.json (a VOLTA)
# ---------------------------------------------------------------------------


def _require_id(value: str, field: str) -> str:
    if not isinstance(value, str) or not ID_PATTERN.match(value):
        # Padrao: comeca por alfanumerico, depois `A-Za-z0-9._:-`. Ids viajam em
        # nome de arquivo e em branch — por isso nada de espaco nem de inicio
        # com pontuacao.
        raise ContractError(f'{field} fora do padrao de id: {value!r}')
    return value


def discovery_recorded(
    discovery_id: str,
    title: str,
    problem: str | None = None,
    tracker: dict[str, str] | None = None,
    target_repo: str | None = None,
    scope_repos: Iterable[str] = (),
) -> dict[str, Any]:
    return {
        "type": "discovery.recorded",
        "discovery_id": _require_id(discovery_id, "discovery_id"),
        "title": title,
        "problem": problem,
        "tracker": None if tracker is None else {"provider": tracker["provider"], "card_id": tracker["card_id"]},
        "target_repo": target_repo,
        "scope_repos": list(scope_repos),
    }


def plan_recorded(plan_id: str, discovery_id: str, title: str, summary: str | None = None) -> dict[str, Any]:
    return {
        "type": "plan.recorded",
        "plan_id": _require_id(plan_id, "plan_id"),
        "discovery_id": _require_id(discovery_id, "discovery_id"),
        "title": title,
        "summary": summary,
    }


def work_item_recorded(
    work_item_id: str,
    item_type: str,
    title: str,
    plan_id: str | None = None,
    target_repo: str | None = None,
    scope_repos: Iterable[str] = (),
) -> dict[str, Any]:
    # D-6, cobrado tambem AQUI: item do tipo `issue` sem repo nao dispara. O
    # app recusaria na ingestao; recusar na emissao evita gravar um documento
    # que ja nasce invalido.
    if item_type == "issue" and not target_repo:
        raise ContractError('work item do tipo "issue" exige target_repo')
    return {
        "type": "work_item.recorded",
        "work_item_id": _require_id(work_item_id, "work_item_id"),
        "plan_id": None if plan_id is None else _require_id(plan_id, "plan_id"),
        "item_type": item_type,
        "title": title,
        "target_repo": target_repo,
        "scope_repos": list(scope_repos),
    }


def relation_recorded(relation: str, from_ref: dict[str, str], to_ref: dict[str, str]) -> dict[str, Any]:
    return {"type": "relation.recorded", "relation": relation, "from": from_ref, "to": to_ref}


def artifact_recorded(
    owner: dict[str, str],
    artifact_kind: str,
    location: str,
    path: str,
    repo: str | None = None,
) -> dict[str, Any]:
    if location == "repo" and not repo:
        raise ContractError('artefato com location "repo" exige "repo"')
    if location == "disk" and repo:
        raise ContractError('artefato com location "disk" nao carrega "repo"')
    return {
        "type": "artifact.recorded",
        "owner": owner,
        "artifact_kind": artifact_kind,
        "location": location,
        "repo": repo,
        "path": path,
    }


def verification_recorded(subject: dict[str, str], verification_kind: str, state: str, ref: str | None = None) -> dict[str, Any]:
    return {
        "type": "verification.recorded",
        "subject": subject,
        "verification_kind": verification_kind,
        "state": state,
        "ref": ref,
    }


def phase_completed(subject: dict[str, str], phase: str, outcome: str, summary: str | None = None) -> dict[str, Any]:
    if not PHASE_PATTERN.match(phase):
        raise ContractError(f"nome de fase fora do padrao: {phase!r}")
    return {"type": "phase.completed", "subject": subject, "phase": phase, "outcome": outcome, "summary": summary}


def lock_acquired(subject: dict[str, str], phase: str, acquired_at: str, cli_session_id: str | None = None) -> dict[str, Any]:
    return {
        "type": "lock.acquired",
        "subject": subject,
        "phase": phase,
        "holder": {"kind": "skill", "acquired_at": acquired_at, "cli_session_id": cli_session_id},
    }


def lock_released(subject: dict[str, str], phase: str) -> dict[str, Any]:
    return {"type": "lock.released", "subject": subject, "phase": phase}


def note_recorded(subject: dict[str, str], text: str) -> dict[str, Any]:
    return {"type": "note.recorded", "subject": subject, "text": text}


def gate_confirmed(
    subject: dict[str, str],
    condition: str,
    confirmed_by: str,
    confirmed_at: str | None = None,
) -> dict[str, Any]:
    """A9 — UMA condicao de gate confirmada por UMA pessoa.

    Gate composto vira N fatos, um por condicao: meia-confirmacao nao cabe numa
    linha de texto, e foi como blockquote no `tasks.md` que "confirmado"
    apareceu com metade do gate em aberto.
    """
    if not condition:
        raise ContractError("gate.confirmed exige a condicao confirmada")
    if not confirmed_by:
        # Confirmacao sem gente e o app se dando o aval que ninguem deu.
        raise ContractError("gate.confirmed exige confirmed_by — quem confirmou")
    return {
        "type": "gate.confirmed",
        "subject": subject,
        "condition": condition,
        "confirmed_by": confirmed_by,
        "confirmed_at": confirmed_at,
    }


def _required_facts_table() -> dict[str, Any]:
    """A tabela `x-required-facts` do arquivo canonico. Lida do schema, nunca copiada."""
    schema = json.loads(RESULT_SCHEMA_PATH.read_text(encoding="utf-8"))
    return schema.get("x-required-facts", {})


def required_facts_for(phase: str, status: str) -> list[str]:
    """A tabela `x-required-facts` do schema — dado compartilhado, nao regra duplicada.

    So vale para run bem-sucedido: o que se cobra e promessa CUMPRIDA. Run que
    falhou ja declara `failure` com codigo e motivo — cobrar dele os fatos da
    fase transformaria um desfecho legivel em documento recusado.
    """
    if status != "success":
        return []
    table = _required_facts_table()
    required = list(table.get("any-phase-success", []))
    required.extend(table.get("by-phase", {}).get(phase, []))
    return required


def phases_requiring_passed_verification() -> list[str]:
    """Fases em que `outcome: done` exige uma verificacao que PASSOU (D-4, dente)."""
    return list(_required_facts_table().get("done-requires-passed-verification", []))


def build_result(
    *,
    run_id: str,
    phase: str,
    status: str,
    started_at: str,
    finished_at: str,
    discovery_id: str,
    facts: list[dict[str, Any]],
    plan_id: str | None = None,
    work_item_id: str | None = None,
    workspace: dict[str, Any] | None = None,
    failure: dict[str, str] | None = None,
    model: str | None = None,
    effort: str | None = None,
    executor: str | None = "claude-code",
    cli_session_id: str | None = None,
) -> dict[str, Any]:
    """Monta o `result.json`. Recusa documento que ja nasceria invalido."""
    if status != "success" and failure is None:
        # "Falhou, nao sei por que" e o mesmo vicio de "nao sei" travestido de fato.
        raise ContractError("status != success exige failure com code e message")
    if status == "success" and failure is not None:
        raise ContractError('failure so existe quando status != "success"')
    if not facts:
        raise ContractError("um run que nao declara nada nao tem resultado para ingerir")

    declared = {fact["type"] for fact in facts}
    missing = [required for required in required_facts_for(phase, status) if required not in declared]
    if missing:
        raise ContractError(f"fase {phase!r} concluida sem declarar: {', '.join(missing)}")

    # D-4 com dente: a fase que declara o ciclo ENCERRADO precisa da evidencia
    # que o encerra ("PR mergeado E VERIFICADO"). Sem isto, "Concluido" na tela
    # seria palavra sem lastro. Desfecho ruim continua valido: `abandoned` e
    # `inconclusive` nao pedem nada.
    if status == "success" and phase in phases_requiring_passed_verification():
        declared_done = any(f["type"] == "phase.completed" and f.get("outcome") == "done" for f in facts)
        has_passed = any(f["type"] == "verification.recorded" and f.get("state") == "passed" for f in facts)
        if declared_done and not has_passed:
            raise ContractError(
                f"fase {phase!r} com outcome 'done' exige uma verification.recorded com state 'passed' — "
                "concluir sem evidencia e afirmar o que ninguem leu"
            )

    return {
        "contract_version": CONTRACT_VERSION,
        "kind": "esteira.result",
        "run": {
            "run_id": _require_id(run_id, "run_id"),
            "phase": phase,
            "status": status,
            "started_at": started_at,
            "finished_at": finished_at,
            "failure": None if failure is None else {"code": failure["code"], "message": failure["message"]},
        },
        "actor": {
            "tool": TOOL_NAME,
            "tool_version": TOOL_VERSION,
            "executor": executor,
            "model": model,
            "effort": effort,
            "cli_session_id": cli_session_id,
        },
        "subject": {
            "discovery_id": _require_id(discovery_id, "discovery_id"),
            "plan_id": None if plan_id is None else _require_id(plan_id, "plan_id"),
            "work_item_id": None if work_item_id is None else _require_id(work_item_id, "work_item_id"),
        },
        # `workspace` e nulo quando a fase nao toca repo nenhum; quando existe,
        # `target_repo` e obrigatorio (D-6) e os demais campos sao anulaveis.
        "workspace": None if workspace is None else {
            "target_repo": workspace["target_repo"],
            "repo_path": workspace.get("repo_path"),
            "worktree_path": workspace.get("worktree_path"),
            "branch": workspace.get("branch"),
        },
        "facts": facts,
    }


def write_result(result: dict[str, Any], result_path: str | Path) -> Path:
    """Grava onde o app pediu (`outbox.result_path` do run-input), atomico."""
    target = Path(result_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(target)
    return target
