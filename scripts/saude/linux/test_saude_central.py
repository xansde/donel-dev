#!/usr/bin/env python3
"""Alerta que duplica ou some (t-16393812): um alerta aberto e fechado sai com 1 envio cada, e o "resolvido" traz o
valor de agora e o pico. Sem rede: psql e envio trocados por dublês.
uso: python3 -I test_saude_central.py
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import saude_central as c  # noqa: E402


def atual(swap_min: float, swap_agora: float, abertos: list) -> dict:
    return {
        "maquinas": [{"maquina": "vps-pessoal", "idade_s": 30, "ram_pct": 50, "swap_pct": swap_agora, "disco_pct": 50,
                      "carga1": 1, "ncpu": 4}],
        "janela": [{"maquina": "vps-pessoal", "n": 15, "ram_min": 50, "ram_max": 50, "swap_min": swap_min,
                    "disco_max": 50, "carga_min": 0.2}],
        "gateways": [], "janela_gw": [], "contas": [], "abertos": abertos, "fora": [],
    }


class TestAlertas(unittest.TestCase):
    def setUp(self):
        self.envios, self.sqls = [], []
        self._psql, self._enviar = c.psql, c.enviar
        c.enviar = lambda q, texto: self.envios.append((q, texto)) or "entregue"

        def psql(sql, timeout=90):
            self.sqls.append(sql)
            return "93.7|20:03" if "max(swap_pct)" in sql else ""
        c.psql = psql

    def tearDown(self):
        c.psql, c.enviar = self._psql, self._enviar

    def test_abre_e_fecha_com_um_envio_cada(self):
        est: dict = {}
        c.alertas(atual(85, 93, []), est, seco=False)              # abre
        aberto = [{"chave": "swap:vps-pessoal", "inicio": "2026-11-16T23:06:00+00:00", "alvo": "vps-pessoal",
                   "texto": "VPS pessoal: swap acima de 80% há 15 min (agora 93%)"}]
        for _ in range(5):                                          # segue aberto na mesma faixa: nada sai
            c.alertas(atual(85, 92, aberto), est, seco=False)
        for _ in range(12):                                         # 10 rodadas sem a condição fecham; as 2 a mais não repetem
            c.alertas(atual(40, 41, aberto if _ < 10 else []), est, seco=False)
        self.assertEqual(len(self.envios), 2, self.envios)
        self.assertIn("swap acima de 80%", self.envios[0][1])
        self.assertIn("resolvido: swap da VPS pessoal em 41% (pico 93.7% às 20:03)", self.envios[1][1])

    def test_sem_emissor_guarda_e_manda_depois_uma_vez(self):
        est: dict = {}
        c.enviar = lambda q, texto: self.envios.append((q, texto)) or "sem-emissor"
        c.alertas(atual(85, 93, []), est, seco=False)
        c.enviar = lambda q, texto: self.envios.append((q, texto)) or "entregue"
        aberto = [{"chave": "swap:vps-pessoal", "inicio": "x", "alvo": "vps-pessoal", "texto": "t"}]
        c.alertas(atual(85, 93, aberto), est, seco=False)
        c.alertas(atual(85, 93, aberto), est, seco=False)
        self.assertEqual(len(self.envios), 2)                        # 1ª sem emissor, 2ª entregue, 3ª nada
        self.assertEqual(self.envios[0][1], self.envios[1][1])

    def test_banco_falhou_nada_enviado(self):
        est: dict = {}

        def quebra(sql, timeout=90):
            raise RuntimeError("sem conexão")
        c.psql = quebra
        with self.assertRaises(RuntimeError):
            c.alertas(atual(85, 93, []), est, seco=False)
        self.assertEqual(self.envios, [])


if __name__ == "__main__":
    unittest.main()
