"""Testes de `emit_result.py` — a tabela `FACT_BUILDERS` precisa espelhar TODO
campo que `esteira_contract.py` aceita para aquele tipo de fato. Um campo que a
lambda esquece de repassar desaparece CALADO antes de chegar ao contrato: o
chamador declarou, o `result.json` grava outra coisa, e ninguém vê erro.

Achado da captura `tutorial-e2e` (batch n1, 2026-08-05): `risk` sumia de
`phase.completed` porque a lambda de `emit_result.py` não o repassava para
`contract.phase_completed(...)` — mesmo a função pura aceitando, validando e
documentando o campo (A16: "risk é a régua de aprovação"). Resultado: o gate do
roteiro e2e manual em risco sensível (A16) nunca disparava pela porta real —
`build_result` sempre via `risk=None`, então a lista `sensiveis` ficava vazia e
o `if sensiveis:` nem entrava.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from emit_result import build_facts  # noqa: E402


def test_phase_completed_preserves_risk() -> None:
    facts = build_facts(
        [
            {
                "type": "phase.completed",
                "subject": {"entity": "work_item", "id": "wi-1"},
                "phase": "validar",
                "outcome": "done",
                "risk": "sensivel",
            }
        ]
    )
    assert facts[0]["risk"] == "sensivel"


def test_phase_completed_without_risk_stays_none() -> None:
    """Desfecho normal (sem `risk` no fato bruto) continua sem regra nenhuma."""
    facts = build_facts(
        [
            {
                "type": "phase.completed",
                "subject": {"entity": "work_item", "id": "wi-1"},
                "phase": "implementar",
                "outcome": "done",
            }
        ]
    )
    assert facts[0]["risk"] is None


def test_phase_completed_preserves_channel_and_risk_together() -> None:
    """A15 (`channel`) e A16 (`risk`) chegam juntos em `concluir` — nenhum apaga o outro."""
    facts = build_facts(
        [
            {
                "type": "phase.completed",
                "subject": {"entity": "work_item", "id": "wi-1"},
                "phase": "concluir",
                "outcome": "done",
                "channel": "alfa",
                "risk": "sensivel",
            }
        ]
    )
    assert facts[0]["channel"] == "alfa"
    assert facts[0]["risk"] == "sensivel"
