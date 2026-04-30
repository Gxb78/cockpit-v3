import tempfile
import unittest
from pathlib import Path

import app as mod
import app_parts


class WizardAliasCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        app_parts.DB_PATH = base / "journal.db"
        app_parts.SCREENSHOTS_DIR = base / "screenshots"
        app_parts.BACKUPS_DIR = base / "backups"
        app_parts.SCREENSHOTS_DIR.mkdir(exist_ok=True)
        mod.init_db()
        self.client = mod.app.test_client()

    def tearDown(self):
        self._tmp.cleanup()

    def _create_day(self, date="2026-04-28", instrument="BTC", **extra):
        payload = {"date": date, "instrument": instrument}
        payload.update(extra)
        return self.client.post("/api/days", json=payload)

    def _create_trade(self, day_id, **extra):
        payload = {"entry_price": 100, "stop_loss": 90, "take_profit": 120}
        payload.update(extra)
        return self.client.post(f"/api/days/{day_id}/trades", json=payload)

    def test_day_create_accepts_nq_and_bias_alias(self):
        resp = self._create_day(instrument="NQ", bias="bullish")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json["instrument"], "NQ")
        self.assertEqual(resp.json["htf_bias"], "bullish")

    def test_day_update_accepts_bias_alias(self):
        created = self._create_day()
        day_id = created.json["id"]
        resp = self.client.put(f"/api/days/{day_id}", json={"bias": "bearish"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["htf_bias"], "bearish")

    def test_trade_create_normalizes_wizard_aliases(self):
        day = self._create_day(instrument="NQ")
        day_id = day.json["id"]
        resp = self.client.post(
            f"/api/days/{day_id}/trades",
            json={
                "strategy": "midnight",
                "entry_price": 100,
                "stop_price": 90,
                "target_price": 120,
                "stdv": 2.5,
            },
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json["strategy"], "midnight_model")
        self.assertEqual(float(resp.json["stop_loss"]), 90.0)
        self.assertEqual(float(resp.json["take_profit"]), 120.0)
        self.assertEqual(float(resp.json["stdv_level"]), 2.5)

    def test_trade_update_normalizes_wizard_aliases(self):
        day = self._create_day()
        day_id = day.json["id"]
        trade = self._create_trade(day_id)
        trade_id = trade.json["id"]
        resp = self.client.put(
            f"/api/trades/{trade_id}",
            json={
                "strategy": "ny",
                "stop_price": 95,
                "target_price": 130,
                "stdv": 3.0,
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["strategy"], "ny_model")
        self.assertEqual(float(resp.json["stop_loss"]), 95.0)
        self.assertEqual(float(resp.json["take_profit"]), 130.0)
        self.assertEqual(float(resp.json["stdv_level"]), 3.0)

    def test_postmortem_aliases_map_to_canonical_fields(self):
        day = self._create_day()
        day_id = day.json["id"]
        trade = self._create_trade(day_id)
        trade_id = trade.json["id"]
        resp = self.client.put(
            f"/api/trades/{trade_id}",
            json={
                "exit_quality": 4,
                "lessons": "Attendre la confirmation.",
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["execution_quality"], 4)
        self.assertEqual(resp.json["lessons_learned"], "Attendre la confirmation.")

if __name__ == "__main__":
    unittest.main()
