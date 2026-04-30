import tempfile
import unittest
from pathlib import Path

import app as mod
import app_parts


class StatsDerivedMetricsTests(unittest.TestCase):
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

    def test_stats_derives_rr_and_winloss_from_price_levels(self):
        day = self.client.post("/api/days", json={"date": "2026-04-28", "instrument": "BTC"})
        self.assertEqual(day.status_code, 201)
        day_id = day.json["id"]

        trade_payload = {
            "direction": "long",
            "entry_price": 100,
            "stop_loss": 90,
            "take_profit": 120,
            "exit_price": 115,
        }
        created_trade = self.client.post(f"/api/days/{day_id}/trades", json=trade_payload)
        self.assertEqual(created_trade.status_code, 201)

        stats = self.client.get("/api/stats")
        self.assertEqual(stats.status_code, 200)
        self.assertTrue(stats.is_json)
        self.assertEqual(stats.json["wins"], 1)
        self.assertEqual(stats.json["losses"], 0)
        self.assertAlmostEqual(stats.json["avg_rr"], 2.0, places=6)


if __name__ == "__main__":
    unittest.main()
