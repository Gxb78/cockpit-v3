import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as mod
import app_parts


def _fake_midnight_fetch(symbol, interval, start_ms, end_ms, limit=500):
    _ = (symbol, start_ms, end_ms)
    if interval == "1m":
        return [
            {"time": 1700000000, "open": 100.0, "high": 110.0, "low": 95.0, "close": 105.0, "volume": 10.0},
            {"time": 1700000060, "open": 105.0, "high": 109.0, "low": 99.0, "close": 104.0, "volume": 9.0},
        ]
    if interval == "5m" and limit == 8:
        return [
            {"time": 1700000000, "open": 100.0, "high": 103.0, "low": 99.0, "close": 102.0, "volume": 10.0},
            {"time": 1700000300, "open": 102.0, "high": 104.0, "low": 100.0, "close": 101.0, "volume": 9.0},
            {"time": 1700000600, "open": 101.0, "high": 106.0, "low": 100.0, "close": 105.0, "volume": 12.0},
            {"time": 1700000900, "open": 105.0, "high": 106.0, "low": 97.0, "close": 98.0, "volume": 13.0},
        ]
    if interval == "5m" and limit == 20:
        return [
            {"time": 1700001800, "open": 98.0, "high": 99.0, "low": 90.0, "close": 92.0, "volume": 20.0},
            {"time": 1700002100, "open": 92.0, "high": 94.0, "low": 88.0, "close": 89.0, "volume": 18.0},
        ]
    if interval == "15m":
        return [
            {"time": 1700000000, "open": 100.0, "high": 106.0, "low": 99.0, "close": 102.0, "volume": 31.0},
        ]
    return []


class MidnightEngineTests(unittest.TestCase):
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

    def test_extract_midnight_features_adds_stdv_levels(self):
        with patch.object(app_parts, "_fetch_klines_range", side_effect=_fake_midnight_fetch):
            result = app_parts.extract_midnight_features("BTCUSDT", "2026-05-19")

        levels = result["levels"]
        self.assertIn("stdv_levels", levels)
        stdv = levels["stdv_levels"]

        self.assertEqual(levels["stdv_anchor"], "midnight_5m_open_high_last_counter_low")
        self.assertEqual(levels["stdv_base_direction"], "bullish")
        self.assertEqual(levels["stdv_post_direction"], "bearish")
        self.assertEqual(levels["stdv_range"], 3.0)
        self.assertEqual(levels["midnight_high"], 103.0)
        self.assertEqual(levels["midnight_low"], 100.0)
        self.assertEqual(levels["midnight_full_high"], 110.0)
        self.assertEqual(levels["midnight_full_low"], 95.0)
        self.assertEqual(stdv["+1.0"], 106.0)
        self.assertEqual(stdv["+1.5"], 107.5)
        self.assertEqual(stdv["+5.0"], 118.0)
        self.assertEqual(stdv["-1.0"], 97.0)
        self.assertEqual(stdv["-2.0"], 94.0)
        self.assertEqual(stdv["-5.0"], 85.0)

    def test_midnight_day_api_exposes_stdv_levels(self):
        with patch.object(app_parts, "_fetch_klines_range", side_effect=_fake_midnight_fetch):
            resp = self.client.get("/api/models/midnight/day?symbol=BTCUSDT&date=2026-05-19")

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.is_json)
        self.assertIn("levels", resp.json)
        self.assertIn("stdv_levels", resp.json["levels"])
        self.assertEqual(resp.json["levels"]["stdv_anchor"], "midnight_5m_open_high_last_counter_low")
        self.assertEqual(resp.json["levels"]["stdv_levels"]["+1.0"], 106.0)
        self.assertEqual(resp.json["levels"]["stdv_levels"]["-1.5"], 95.5)


if __name__ == "__main__":
    unittest.main()
