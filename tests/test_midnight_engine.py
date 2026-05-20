import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as mod
import app_parts


def _fake_midnight_fetch(symbol, interval, start_ms, end_ms, limit=500):
    _ = (symbol, start_ms, end_ms, limit)
    if interval == "1m":
        return [
            {"time": 1700000000, "open": 100.0, "high": 110.0, "low": 95.0, "close": 105.0, "volume": 10.0},
            {"time": 1700000060, "open": 105.0, "high": 109.0, "low": 99.0, "close": 104.0, "volume": 9.0},
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

        self.assertEqual(stdv["+1.0"], 115.0)
        self.assertEqual(stdv["+1.5"], 122.5)
        self.assertEqual(stdv["+5.0"], 175.0)
        self.assertEqual(stdv["-1.0"], 85.0)
        self.assertEqual(stdv["-2.0"], 70.0)
        self.assertEqual(stdv["-5.0"], 25.0)

    def test_midnight_day_api_exposes_stdv_levels(self):
        with patch.object(app_parts, "_fetch_klines_range", side_effect=_fake_midnight_fetch):
            resp = self.client.get("/api/models/midnight/day?symbol=BTCUSDT&date=2026-05-19")

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.is_json)
        self.assertIn("levels", resp.json)
        self.assertIn("stdv_levels", resp.json["levels"])
        self.assertEqual(resp.json["levels"]["stdv_levels"]["+1.0"], 115.0)
        self.assertEqual(resp.json["levels"]["stdv_levels"]["-1.5"], 77.5)


if __name__ == "__main__":
    unittest.main()
