#!/usr/bin/env python3
"""Classe de cada conta pelo que o gateway (CLIProxyAPI /auth-files) diz dela (t-16393812). "fora" é só a que precisa de
login; o resto renova sozinho e não pode disparar o alerta "caiu". Dublês: as mensagens reais vistas em 16/11.
uso: python3 -I test_saude_coletor.py
"""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import saude_coletor as c  # noqa: E402

AGORA = datetime(2026, 11, 16, 23, 0, tzinfo=timezone.utc)
DEPOIS = (AGORA + timedelta(hours=2)).isoformat()
RATE_LIMIT = ('{"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s '
              'rate limit. Please try again later."},"request_id":"req_011CV4013abc403"}')


def conta(status="active", msg="", unavailable=False, disabled=False, cooldowns=None, retry=None, uso5h=None):
    sig = {"Anthropic-Ratelimit-Unified-5h-Utilization": str(uso5h)} if uso5h is not None else {}
    return {"email": "x@seazone.com.br", "status": status, "status_message": msg, "unavailable": unavailable,
            "disabled": disabled, "cooldowns": cooldowns or [], "next_retry_after": retry, "quota": {"signals": sig}}


def classe(**kw):
    return c.conta_de(conta(**kw), AGORA)["classe"]


class TestClasse(unittest.TestCase):
    # passageiros: renovam sozinhos -> esgotada (sem alerta "caiu")
    def test_rate_limit_sem_cooldown_e_esgotada(self):
        self.assertEqual(classe(status="error", msg=RATE_LIMIT, unavailable=True), "esgotada")

    def test_rate_limit_com_numeros_401_403_no_request_id_nao_e_login(self):
        self.assertEqual(classe(status="error", msg=RATE_LIMIT, unavailable=False), "esgotada")

    def test_credential_quota_com_retry_e_esgotada(self):
        self.assertEqual(classe(status="error", msg="credential_quota", unavailable=True,
                                cooldowns=[{"retry_at": DEPOIS, "http_status": 429}], retry=DEPOIS), "esgotada")

    def test_429_e_overloaded_sao_esgotada(self):
        for msg in ("HTTP 429 Too Many Requests", '{"type":"overloaded_error","message":"Overloaded"}', "upstream 529",
                    "HTTP 503 Service Unavailable", "context deadline exceeded (timeout)"):
            self.assertEqual(classe(status="error", msg=msg, unavailable=True), "esgotada", msg)

    def test_uso_100_e_esgotada(self):
        self.assertEqual(classe(uso5h=1.0), "esgotada")

    def test_erro_sem_causa_conhecida_nao_vira_fora(self):
        self.assertEqual(classe(status="error", msg="algo estranho", unavailable=True), "esgotada")

    # precisam de login -> fora
    def test_invalid_grant_e_fora(self):
        self.assertEqual(classe(status="error", msg="invalid grant (retrying)", unavailable=True), "fora")
        self.assertEqual(classe(status="error", msg='{"error":"invalid_grant"}', unavailable=True,
                                cooldowns=[{"retry_at": DEPOIS}]), "fora")

    def test_401_403_de_auth_sao_fora(self):
        for msg in ("HTTP 401 Unauthorized", '{"type":"authentication_error","message":"OAuth token has expired"}',
                    "403 Forbidden: permission_error", "refresh token revoked"):
            self.assertEqual(classe(status="error", msg=msg, unavailable=True), "fora", msg)

    def test_desligada_e_fora(self):
        self.assertEqual(classe(status="disabled", disabled=True), "fora")

    # pode atender
    def test_ativa_com_cota(self):
        self.assertEqual(classe(uso5h=0.07), "com_cota")


if __name__ == "__main__":
    unittest.main()
