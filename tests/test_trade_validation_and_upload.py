import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as mod
import app_parts


class TradeValidationAndUploadTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        app_parts.DB_PATH = base / "journal.db"
        app_parts.SCREENSHOTS_DIR = base / "screenshots"
        app_parts.BACKUPS_DIR = base / "backups"
        app_parts.SCREENSHOTS_DIR.mkdir(exist_ok=True)
        mod.init_db()
        self.client = mod.app.test_client()

        day = self.client.post("/api/days", json={"date": "2026-04-28", "instrument": "BTC"})
        self.assertEqual(day.status_code, 201)
        self.day_id = day.json["id"]

    def tearDown(self):
        self._tmp.cleanup()

    def _create_trade(self, **extra):
        payload = {
            "direction": "long",
            "entry_price": 100,
            "stop_loss": 90,
            "take_profit": 120,
        }
        payload.update(extra)
        return self.client.post(f"/api/days/{self.day_id}/trades", json=payload)

    def test_rejects_incoherent_price_levels_for_long(self):
        resp = self._create_trade(direction="long", entry_price=100, stop_loss=110, take_profit=120)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Stop au-dessus", resp.json["error"])

    def test_rejects_pnl_is_win_conflict(self):
        resp = self._create_trade(pnl=50, is_win=0)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("PnL positif", resp.json["error"])

    def test_update_rejects_pnl_is_win_conflict_with_existing_data(self):
        created = self._create_trade(pnl=50, is_win=1)
        self.assertEqual(created.status_code, 201)
        trade_id = created.json["id"]
        resp = self.client.put(f"/api/trades/{trade_id}", json={"is_win": 0})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("PnL positif", resp.json["error"])

    def test_upload_rejects_extension_content_mismatch(self):
        created = self._create_trade()
        trade_id = created.json["id"]
        fake_jpeg = io.BytesIO(b"\xff\xd8\xff\xdb\x00C" + b"\x00" * 64)
        resp = self.client.post(
            f"/api/trades/{trade_id}/screenshots",
            data={"file": (fake_jpeg, "shot.png")},
            content_type="multipart/form-data",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("mismatch", resp.json["error"])

    def test_upload_accepts_valid_png_signature(self):
        created = self._create_trade()
        trade_id = created.json["id"]
        fake_png = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
        resp = self.client.post(
            f"/api/trades/{trade_id}/screenshots",
            data={"file": (fake_png, "shot.png")},
            content_type="multipart/form-data",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(resp.json["filename"].endswith(".png"))

    def test_create_calculates_pnl_from_entry_exit_size(self):
        """Sans pnl fourni, le PnL est calculé depuis entry/exit/size."""
        resp = self._create_trade(
            direction="long",
            entry_price=100,
            exit_price=120,
            position_size=2,
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json["pnl"], 40.0)  # (120-100)*2*1

    def test_create_pnl_zero_preserved_as_break_even(self):
        """pnl=0 explicite reste 0 (break-even), pas recalculé."""
        resp = self._create_trade(
            direction="long",
            entry_price=100,
            exit_price=120,
            position_size=2,
            pnl=0,
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json["pnl"], 0)

    def test_create_pnl_explicit_preserved(self):
        """pnl explicite (ex: 50) est préservé, pas recalculé."""
        resp = self._create_trade(
            direction="long",
            entry_price=100,
            exit_price=120,
            position_size=2,
            pnl=50,
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json["pnl"], 50)

    def test_create_without_entry_exit_returns_pnl_none(self):
        """Sans entry/exit/size, pnl reste None (pas de calcul possible)."""
        resp = self._create_trade(direction="long")
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(resp.json["pnl"])

    def test_update_recalculates_pnl_when_exit_price_added(self):
        """Update avec exit_price (sans pnl) → pnl recalculé depuis entry/size existants + nouvel exit."""
        created = self._create_trade(
            direction="long",
            entry_price=100,
            position_size=2,
        )
        self.assertEqual(created.status_code, 201)
        self.assertIsNone(created.json["pnl"])
        trade_id = created.json["id"]

        resp = self.client.put(f"/api/trades/{trade_id}", json={"exit_price": 150})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["pnl"], 100.0)  # (150-100)*2*1

    def test_update_pnl_explicit_preserved(self):
        """Update avec pnl explicite → pnl préservé, pas recalculé."""
        created = self._create_trade(
            direction="long",
            entry_price=100,
            exit_price=120,
            position_size=2,
            pnl=999,
        )
        self.assertEqual(created.status_code, 201)
        trade_id = created.json["id"]

        resp = self.client.put(f"/api/trades/{trade_id}", json={"pnl": 50})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["pnl"], 50)

    def test_update_pnl_zero_preserved(self):
        """Update avec pnl=0 → break-even préservé, pas recalculé."""
        created = self._create_trade(
            direction="long",
            entry_price=100,
            exit_price=120,
            position_size=2,
        )
        self.assertEqual(created.status_code, 201)
        trade_id = created.json["id"]

        resp = self.client.put(f"/api/trades/{trade_id}", json={"pnl": 0})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["pnl"], 0)

    def test_update_calculates_pnl_when_missing_with_entry_exit(self):
        """Update qui fournit entry+exit+size sans pnl → pnl calculé."""
        created = self._create_trade()
        self.assertEqual(created.status_code, 201)
        self.assertIsNone(created.json["pnl"])
        trade_id = created.json["id"]

        resp = self.client.put(f"/api/trades/{trade_id}", json={
            "direction": "long",
            "entry_price": 200,
            "exit_price": 250,
            "position_size": 3,
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["pnl"], 150.0)  # (250-200)*3*1

    def test_update_pnl_none_triggers_recalc(self):
        """Update avec pnl=None explicite → ne bloque pas le recalcul (fix 2)."""
        created = self._create_trade(
            direction="long",
            entry_price=100,
            exit_price=150,
            position_size=1,
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json["pnl"], 50.0)
        trade_id = created.json["id"]

        resp = self.client.put(f"/api/trades/{trade_id}", json={
            "exit_price": 200,
            "pnl": None,
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["pnl"], 100.0)  # (200-100)*1*1 — recalculé car pnl=None

    def test_update_is_win_follows_recalc(self):
        """is_win mis à jour après recalcul du pnl."""
        created = self._create_trade(
            direction="long",
            entry_price=100,
            position_size=1,
        )
        self.assertEqual(created.status_code, 201)
        self.assertIsNone(created.json["pnl"])
        self.assertIsNone(created.json["is_win"])
        trade_id = created.json["id"]

        resp = self.client.put(f"/api/trades/{trade_id}", json={"exit_price": 80})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["pnl"], -20.0)  # (80-100)*1*1
        self.assertEqual(resp.json["is_win"], 0)
        with patch.dict(mod.os.environ, {"ANTHROPIC_API_KEY": ""}, clear=False):
            resp = self.client.post("/api/parse-trade", json={"text": "trade long pnl +120$"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json.get("_source"), "regex")
        self.assertIn("_warning", resp.json)

    def test_parse_trade_midnight_flow_extracts_scenario_and_questions(self):
        text = (
            "Le prix a monte avant l open. "
            "La veille on a fortement drop et on est en tendance baissiere HTF. "
            "On a touche un bullish order block daily en zone OTE. "
            "Scenario PO3: a l open le prix descend, je cherche le plus bas puis retournement. "
            "Je trace le stdv sur le mouvement baissier de l open high/low et je target les 2 du stdv. "
            "Setup IFVG + breaker + FVG en 15min, en zone discount pour acheter avec SMT haussiere au contact. "
            "Ensuite je target une liquidite au dessus."
        )
        with patch.dict(mod.os.environ, {"ANTHROPIC_API_KEY": ""}, clear=False):
            resp = self.client.post("/api/parse-trade", json={"text": text})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json.get("strategy"), "midnight_model")
        self.assertEqual(resp.json.get("_flow"), "midnight_model")
        self.assertEqual(float(resp.json.get("stdv_level")), 2.0)
        self.assertEqual(resp.json.get("direction"), "long")
        self.assertIn("why_trade", resp.json)
        self.assertIn("why_entry", resp.json)
        self.assertIn("scenario", resp.json)
        self.assertTrue(resp.json.get("_follow_up_questions"))
        fields = {q.get("field") for q in resp.json.get("_follow_up_questions", []) if isinstance(q, dict)}
        self.assertIn("entry_price", fields)
        self.assertIn("take_profit", fields)

    def test_parse_trade_midnight_flow_parses_numeric_levels(self):
        text = (
            "Midnight model long. "
            "Entree 5100, stop 5072, tp 5188. "
            "stdv 2.5 et SMT validee, zone discount confirmee."
        )
        with patch.dict(mod.os.environ, {"ANTHROPIC_API_KEY": ""}, clear=False):
            resp = self.client.post("/api/parse-trade", json={"text": text})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json.get("strategy"), "midnight_model")
        self.assertEqual(float(resp.json.get("entry_price")), 5100.0)
        self.assertEqual(float(resp.json.get("stop_loss")), 5072.0)
        self.assertEqual(float(resp.json.get("take_profit")), 5188.0)
        missing = set(resp.json.get("_missing_fields") or [])
        self.assertNotIn("entry_price", missing)
        self.assertNotIn("stop_loss", missing)
        self.assertNotIn("take_profit", missing)


if __name__ == "__main__":
    unittest.main()
