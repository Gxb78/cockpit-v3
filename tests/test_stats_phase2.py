import tempfile
import unittest
from pathlib import Path

import app as mod
import app_parts


class StatsPhase2Tests(unittest.TestCase):
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

    def _create_day(self, date_key, instrument="BTC"):
        resp = self.client.post("/api/days", json={"date": date_key, "instrument": instrument})
        self.assertEqual(resp.status_code, 201)
        return resp.json["id"]

    def _create_trade(self, day_id, **payload):
        body = {
            "direction": "long",
            "entry_price": 100,
            "stop_loss": 90,
            "take_profit": 120,
        }
        body.update(payload)
        resp = self.client.post(f"/api/days/{day_id}/trades", json=body)
        self.assertEqual(resp.status_code, 201)
        return resp.json

    def test_stats_include_drawdown_histogram_tags_and_period_comparison(self):
        d1 = self._create_day("2026-03-10")
        self._create_trade(d1, pnl=-100, is_win=0, tags=["fvg", "loss"])
        d2 = self._create_day("2026-03-12")
        self._create_trade(d2, pnl=50, is_win=1, tags=["fvg"])
        d3 = self._create_day("2026-04-05")
        self._create_trade(d3, pnl=200, is_win=1, tags=["breakout"])
        d4 = self._create_day("2026-04-06")
        self._create_trade(d4, pnl=-50, is_win=0, tags=["breakout", "news"])

        stats = self.client.get("/api/stats")
        self.assertEqual(stats.status_code, 200)
        payload = stats.json

        by_tag = payload.get("by_tag", {})
        self.assertIn("fvg", by_tag)
        self.assertIn("breakout", by_tag)
        self.assertEqual(by_tag["fvg"]["count"], 2)
        self.assertEqual(by_tag["news"]["count"], 1)

        drawdown = payload.get("drawdown", {})
        series = drawdown.get("series", [])
        self.assertTrue(len(series) >= 4)
        self.assertLessEqual(drawdown.get("max_drawdown", 0), 0)
        self.assertLessEqual(drawdown.get("current_drawdown", 0), 0)

        histogram = payload.get("pnl_histogram", [])
        self.assertTrue(len(histogram) >= 1)
        self.assertEqual(sum(int(b.get("count", 0)) for b in histogram), payload.get("num_trades"))

        period_compare = payload.get("period_compare", {})
        current = period_compare.get("current", {})
        previous = period_compare.get("previous", {})
        delta = period_compare.get("delta", {})
        self.assertEqual(current.get("from"), "2026-04-01")
        self.assertEqual(current.get("to"), "2026-04-30")
        self.assertEqual(previous.get("from"), "2026-03-01")
        self.assertEqual(previous.get("to"), "2026-03-31")
        self.assertAlmostEqual(current.get("pnl", 0), 150.0, places=6)
        self.assertAlmostEqual(previous.get("pnl", 0), -50.0, places=6)
        self.assertAlmostEqual(delta.get("pnl", 0), 200.0, places=6)


if __name__ == "__main__":
    unittest.main()
