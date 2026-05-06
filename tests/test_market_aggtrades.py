import tempfile
import unittest
from pathlib import Path

import app as mod
import app_parts


class MarketAggTradesTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        app_parts.DB_PATH = base / "journal.db"
        app_parts.SCREENSHOTS_DIR = base / "screenshots"
        app_parts.BACKUPS_DIR = base / "backups"
        app_parts.SCREENSHOTS_DIR.mkdir(exist_ok=True)
        mod.init_db()
        self.client = mod.app.test_client()

        self._orig_fetch = app_parts._fetch_binance_agg
        app_parts._aggtrade_cache.clear()

    def tearDown(self):
        app_parts._fetch_binance_agg = self._orig_fetch
        app_parts._aggtrade_cache.clear()
        self._tmp.cleanup()

    def test_limit_invalid_returns_400(self):
        resp = self.client.get("/api/market/aggtrades?symbol=BTCUSDT&limit=abc")
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(resp.is_json)
        self.assertIn("limit", resp.json.get("error", ""))

    def test_limit_is_clamped_to_8000(self):
        def fake_fetch(_path_qs):
            return [{
                "id": 1,
                "time": 1_700_000_000_000,
                "price": 100.0,
                "qty": 1.0,
                "side": "buy",
            }], None

        app_parts._fetch_binance_agg = fake_fetch
        resp = self.client.get("/api/market/aggtrades?symbol=BTCUSDT&limit=999999")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["limits"]["maxTrades"], 8000)

    def test_no_trade_outside_requested_range(self):
        start_ms = 1_700_000_000_000
        end_ms = start_ms + 60_000

        def fake_fetch(path_qs):
            if "fromId=" not in path_qs:
                # Includes one trade above end_ms; must be filtered out.
                return [
                    {"id": 10, "time": start_ms + 1_000, "price": 100.0, "qty": 1.0, "side": "buy"},
                    {"id": 11, "time": end_ms + 1_000, "price": 101.0, "qty": 1.2, "side": "sell"},
                ], None
            # Second page only out-of-range -> filtered to empty, should stop.
            return [
                {"id": 12, "time": end_ms + 2_000, "price": 102.0, "qty": 0.8, "side": "buy"},
            ], None

        app_parts._fetch_binance_agg = fake_fetch
        url = f"/api/market/aggtrades?symbol=BTCUSDT&startTime={start_ms}&endTime={end_ms}&limit=8000"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        trades = resp.json["trades"]
        self.assertGreaterEqual(len(trades), 1)
        self.assertTrue(all(t["time"] >= start_ms for t in trades))
        self.assertTrue(all(t["time"] <= end_ms for t in trades))
        self.assertLessEqual(resp.json["actual"]["lastTradeTime"], end_ms)

    def test_cache_hit_keeps_metadata(self):
        def fake_fetch(_path_qs):
            return [{
                "id": 1,
                "time": 1_700_000_000_000,
                "price": 100.0,
                "qty": 1.0,
                "side": "buy",
            }], None

        app_parts._fetch_binance_agg = fake_fetch
        url = "/api/market/aggtrades?symbol=BTCUSDT&startTime=1700000000000&endTime=1700000060000&limit=1000"
        first = self.client.get(url)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json["source"], "binance")
        self.assertIsNone(first.json["upstream_error"])

        second = self.client.get(url)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json["source"], "cache")
        self.assertTrue(second.json["cache"]["hit"])
        self.assertFalse(second.json["cache"]["stale"])
        self.assertIn("age", second.json["cache"])
        self.assertIsNone(second.json["upstream_error"])

    def test_soft_mode_returns_unavailable_on_binance_error(self):
        def fake_fetch_error(_path_qs):
            return None, ({"error": "Binance unavailable"}, 502)

        app_parts._fetch_binance_agg = fake_fetch_error
        url = "/api/market/aggtrades?symbol=BTCUSDT&startTime=1700000000000&endTime=1700000060000&limit=1000&soft=1"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.is_json)
        self.assertEqual(resp.json["source"], "unavailable")
        self.assertEqual(resp.json["trades"], [])
        self.assertEqual(resp.json["count"], 0)
        self.assertFalse(resp.json["cache"]["hit"])
        self.assertFalse(resp.json["cache"]["stale"])
        self.assertEqual(resp.json["upstream_error"], "Binance unavailable")

    def test_stale_cache_fallback_sets_stale_and_upstream_error(self):
        def fake_fetch_ok(_path_qs):
            return [{
                "id": 1,
                "time": 1_700_000_000_000,
                "price": 100.0,
                "qty": 1.0,
                "side": "buy",
            }], None

        url = "/api/market/aggtrades?symbol=BTCUSDT&startTime=1700000000000&endTime=1700000060000&limit=1000"
        app_parts._fetch_binance_agg = fake_fetch_ok
        first = self.client.get(url)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json["source"], "binance")

        def fake_fetch_error(_path_qs):
            return None, ({"error": "temporary upstream failure"}, 502)

        app_parts._fetch_binance_agg = fake_fetch_error
        # force=1 bypass le cache frais, ce qui force la branche stale fallback.
        stale = self.client.get(url + "&force=1")
        self.assertEqual(stale.status_code, 200)
        self.assertEqual(stale.json["source"], "cache")
        self.assertTrue(stale.json["cache"]["hit"])
        self.assertTrue(stale.json["cache"]["stale"])
        self.assertEqual(stale.json["upstream_error"], "temporary upstream failure")


if __name__ == "__main__":
    unittest.main()
