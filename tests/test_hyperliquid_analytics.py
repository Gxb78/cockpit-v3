import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as mod
import app_parts


class HyperliquidAnalyticsMathTests(unittest.TestCase):
    def test_archive_fill_prefers_crossed_side_and_unknown_side_is_not_delta(self):
        rows = [
            {"time": 1000, "coin": "BTC", "tid": 7, "px": "100", "sz": "2", "side": "A", "crossed": False},
            {"time": 1000, "coin": "BTC", "tid": 7, "px": "100", "sz": "2", "side": "B", "crossed": True},
            {"time": 1001, "coin": "BTC", "tid": 8, "px": "101", "sz": "1", "side": "B"},
        ]
        trades = app_parts._ha_dedupe_fills(rows)
        self.assertEqual(len(trades), 2)
        self.assertEqual(trades[0]["aggressorSide"], "buy")
        self.assertIsNone(trades[1]["aggressorSide"])

        profile = app_parts._ha_profile_from_trades(trades, "BTC", "base", 1, 70)
        self.assertEqual(profile["unknownAggressorVolume"], 1.0)
        self.assertTrue(profile["deltaPartial"])

    def test_value_area_is_contiguous_and_tied_poc_chooses_lower_price(self):
        levels = [
            {"price": 99.0, "totalVolume": 5.0},
            {"price": 100.0, "totalVolume": 10.0},
            {"price": 101.0, "totalVolume": 10.0},
            {"price": 102.0, "totalVolume": 5.0},
        ]
        result = app_parts._ha_value_area(levels, 70)
        self.assertEqual(result["poc"], 100.0)
        self.assertEqual(result["val"], 99.0)
        self.assertEqual(result["vah"], 102.0)

    def test_notional_and_base_metrics_are_distinct(self):
        trade = app_parts._ha_normalize_trade(
            {"time": 1000, "coin": "BTC", "tid": 1, "px": "25000", "sz": "2", "side": "B"}
        )
        base = app_parts._ha_profile_from_trades([trade], "BTC", "base", 1, 70)
        usd = app_parts._ha_profile_from_trades([trade], "BTC", "notional", 1, 70)
        self.assertEqual(base["totalVolume"], 2.0)
        self.assertEqual(usd["totalVolume"], 50000.0)


class HyperliquidAnalyticsRoutesTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._original_root = app_parts.MARKET_DATA_DIR
        app_parts.MARKET_DATA_DIR = Path(self._tmp.name) / "market"
        app_parts._ha_profile_cache.clear()
        self.client = mod.app.test_client()

    def tearDown(self):
        app_parts.MARKET_DATA_DIR = self._original_root
        app_parts._ha_profile_cache.clear()
        self._tmp.cleanup()

    def _loaded_trades(self, _coin, start_ms, end_ms):
        trades = [
            app_parts._ha_normalize_trade({"time": start_ms + 10, "coin": "BTC", "tid": 1, "px": "100", "sz": "2", "side": "B"}),
            app_parts._ha_normalize_trade({"time": start_ms + 20, "coin": "BTC", "tid": 2, "px": "101", "sz": "1", "side": "A"}),
        ]
        coverage = {"complete": True, "requested": {"startTime": start_ms, "endTime": end_ms}}
        return trades, "parquet:trades", coverage, [], False

    def test_profile_and_footprint_use_aggressive_buy_sell_contract(self):
        with patch.object(app_parts, "_ha_load_trades", side_effect=self._loaded_trades):
            profile = self.client.get(
                "/api/hyperliquid/analytics/volume-profile?coin=BTC&startTime=1000&endTime=2000&metric=base&rowSize=1&vaPercent=70&profileType=session"
            )
            footprint = self.client.get(
                "/api/hyperliquid/analytics/footprint?coin=BTC&startTime=1000&endTime=2000&metric=base&rowSize=1&interval=1m"
            )
        self.assertEqual(profile.status_code, 200)
        levels = profile.get_json()["levels"]
        self.assertEqual(levels[0]["buyVolume"], 2.0)
        self.assertEqual(levels[1]["sellVolume"], 1.0)
        self.assertFalse(profile.get_json()["partial"])
        self.assertTrue(footprint.get_json()["signalsEnabled"])
        self.assertEqual(footprint.get_json()["candles"][0]["delta"], 1.0)

    def test_import_requires_confirmed_preflight_token(self):
        denied = self.client.post("/api/hyperliquid/analytics/import/jobs", json={})
        self.assertEqual(denied.status_code, 400)

        preview = self.client.post(
            "/api/hyperliquid/analytics/import/preview",
            json={"coin": "BTC", "datasets": ["trades", "l2"], "from": "earliest", "to": "latest"},
        )
        self.assertEqual(preview.status_code, 202)
        self.assertTrue(preview.get_json()["requesterPays"])
        token = preview.get_json()["token"]
        queued = self.client.post(
            "/api/hyperliquid/analytics/import/jobs",
            json={"token": token, "confirmed": True},
        )
        self.assertEqual(queued.status_code, 202)
        self.assertEqual(queued.get_json()["status"], "queued")

    def test_heatmap_without_l2_partitions_is_explicitly_partial(self):
        response = self.client.get(
            "/api/hyperliquid/analytics/heatmap?coin=BTC&startTime=1000&endTime=2000&resolution=5s"
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["partial"])
        self.assertEqual(response.get_json()["tiles"], [])
        self.assertEqual(response.get_json()["gaps"][0]["dataset"], "l2")


class HyperliquidMarketWorkerTests(unittest.TestCase):
    def test_parquet_partition_is_atomic_and_heartbeat_is_persisted(self):
        worker_path = Path(__file__).resolve().parents[1] / "workers" / "hyperliquid_market_worker.py"
        spec = importlib.util.spec_from_file_location("hl_market_worker_test", worker_path)
        worker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(worker)
        with tempfile.TemporaryDirectory() as tmp:
            worker.MARKET_ROOT = Path(tmp) / "market"
            worker.CONTROL_DB = worker.MARKET_ROOT / "control.sqlite"
            worker.record_market("BTC")
            worker.write_parquet("trades", "BTC", [{
                "tradeKey": "1000:BTC:1", "coin": "BTC", "timeMs": 1000,
                "price": 100.0, "sizeBase": 2.0, "notionalUsd": 200.0,
                "aggressorSide": "buy", "source": "ws-trades",
            }])
            files = list((worker.MARKET_ROOT / "trades" / "coin=BTC").rglob("*.parquet"))
            self.assertEqual(len(files), 1)
            self.assertEqual(list(worker.MARKET_ROOT.rglob("*.tmp.parquet")), [])

            worker.heartbeat("collecting", {"coin": "BTC"})
            con = sqlite3.connect(worker.CONTROL_DB)
            try:
                status = con.execute("SELECT status FROM ha_collector_state WHERE singleton=1").fetchone()[0]
                coverage = con.execute(
                    "SELECT start_ms, end_ms FROM ha_coverage WHERE coin='BTC' AND dataset='trades'"
                ).fetchone()
            finally:
                con.close()
            self.assertEqual(status, "collecting")
            self.assertEqual(coverage, (1000, 1000))


if __name__ == "__main__":
    unittest.main()
