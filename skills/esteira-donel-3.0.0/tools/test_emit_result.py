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

Segundo achado da MESMA captura (batch n1, 2026-08-05, roteiro
`decisoes-revisao-e-canal`): a legenda do print mostrava "... exige ao menos um
gate.confirmed ou decision.recorded � fase que nao perguntou nada nao fecha" —
um "�" no lugar do travessão. Causa: em Windows, com stdout/stderr PIPED (não
ligado a um console real), o Python 3.12 desta máquina escreve usando o
codepage do locale (cp1252, pt-BR) em vez de UTF-8 — o travessão sai como o
byte único 0x97, que não é UTF-8 válido sozinho. Quem lê o stderr assumindo
UTF-8 (o roteiro e2e, via `execFileSync(..., { encoding: 'utf8' })`, e
qualquer outro consumidor futuro do CLI) recebe o caractere de substituição.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from emit_result import build_facts  # noqa: E402

TOOLS_DIR = Path(__file__).resolve().parent


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


def test_contract_error_reaches_piped_stderr_as_utf8(tmp_path: Path) -> None:
    """A mensagem de erro tem travessão (— ) e precisa sobreviver a um pipe.

    Roda o CLI de verdade como subprocesso — o mesmo caminho que o roteiro e2e
    usa via `execFileSync(..., { encoding: 'utf8' })` — para provar que quem lê
    o stderr como UTF-8 recebe UTF-8, mesmo no locale cp1252 desta máquina.
    Sem a correção, o byte 0x97 (travessão em cp1252) vira "�" na leitura.
    """
    run_input = tmp_path / "run-input.json"
    run_input.write_text(
        json.dumps(
            {
                "contract_version": "1.0.0",
                "kind": "esteira.run-input",
                "run": {"run_id": "r-encoding-test", "phase": "discovery", "requested_at": "2026-08-05T00:00:00.000Z"},
                "subject": {"discovery_id": "d-encoding-test"},
                "outbox": {"result_path": str(tmp_path / "out.json")},
                "context": {"discovery": {"id": "d-encoding-test", "title": "x"}, "history": [], "notes": []},
            }
        ),
        encoding="utf-8",
    )
    facts_file = tmp_path / "facts.json"
    facts_file.write_text(
        json.dumps(
            [
                {"type": "discovery.recorded", "discovery_id": "d-encoding-test", "title": "x"},
                # done sem gate.confirmed nem decision.recorded — dispara o
                # erro de contrato com travessão (A18).
                {"type": "phase.completed", "subject": {"entity": "discovery", "id": "d-encoding-test"}, "phase": "discovery", "outcome": "done"},
            ]
        ),
        encoding="utf-8",
    )

    result = subprocess.run(
        [sys.executable, str(TOOLS_DIR / "emit_result.py"), "--input", str(run_input), "--facts-file", str(facts_file)],
        capture_output=True,
    )

    assert result.returncode == 1
    stderr = result.stderr.decode("utf-8")
    assert "�" not in stderr, f"stderr chegou mal-codificado: {stderr!r}"
    assert "fase que nao perguntou nada nao fecha" in stderr
    assert "—" in stderr
