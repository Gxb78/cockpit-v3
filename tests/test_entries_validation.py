import tempfile
import unittest
from pathlib import Path

import app as mod
import app_parts


class EntriesValidationTests(unittest.TestCase):
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

    def _create_day(self, **overrides):
        payload = {"date": "2026-04-27", "instrument": "BTC"}
        payload.update(overrides)
        return self.client.post("/api/days", json=payload)

    def _create_trade(self, day_id, **overrides):
        payload = {"direction": "long", "entry_price": 100, "stop_loss": 90}
        payload.update(overrides)
        return self.client.post(f"/api/days/{day_id}/trades", json=payload)

    def test_create_accepts_string_zero_for_is_win(self):
        # Create a day first
        day = self._create_day()
        self.assertEqual(day.status_code, 201)
        day_id = day.json["id"]
        # Create a trade with is_win="0"
        resp = self._create_trade(day_id, is_win="0")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json["is_win"], 0)

    def test_update_accepts_string_zero_for_is_win(self):
        day = self._create_day()
        self.assertEqual(day.status_code, 201)
        day_id = day.json["id"]
        trade = self._create_trade(day_id)
        self.assertEqual(trade.status_code, 201)
        trade_id = trade.json["id"]
        resp = self.client.put(f"/api/trades/{trade_id}", json={"is_win": "0"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["is_win"], 0)

    def test_create_rejects_invalid_is_win(self):
        day = self._create_day()
        self.assertEqual(day.status_code, 201)
        day_id = day.json["id"]
        resp = self._create_trade(day_id, is_win="maybe")
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(resp.is_json)
        self.assertIn("is_win", resp.json["error"])

    def test_create_rejects_execution_quality_out_of_range(self):
        day = self._create_day()
        self.assertEqual(day.status_code, 201)
        day_id = day.json["id"]
        resp = self._create_trade(day_id, execution_quality=6)
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(resp.is_json)
        self.assertIn("execution_quality", resp.json["error"])

    def test_update_rejects_invalid_instrument(self):
        day = self._create_day()
        self.assertEqual(day.status_code, 201)
        day_id = day.json["id"]
        resp = self.client.put(f"/api/days/{day_id}", json={"instrument": "DOGE"})
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(resp.is_json)

    def test_update_duplicate_pair_returns_409_json(self):
        first = self._create_day()
        self.assertEqual(first.status_code, 201)
        second = self._create_day(instrument="ETH")
        self.assertEqual(second.status_code, 201)
        second_id = second.json["id"]
        resp = self.client.put(f"/api/days/{second_id}", json={"date": first.json["date"], "instrument": first.json["instrument"]})
        self.assertEqual(resp.status_code, 409)
        self.assertTrue(resp.is_json)
        self.assertIn("existe déjà", resp.json["error"])


if __name__ == "__main__":
    unittest.main()
