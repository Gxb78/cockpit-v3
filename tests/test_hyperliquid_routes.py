import unittest
from unittest.mock import patch

import app as mod
import app_parts


def _fake_hl_info(payload, cache_key, ttl, force=False):
    _ = (cache_key, ttl, force)
    typ = payload.get("type")
    if typ == "allPerpMetas":
        return [
            [None, {"universe": [
            {"name": "BTC", "szDecimals": 5, "maxLeverage": 50},
            ]}],
            [{"name": "xyz"}, {"universe": [
                {"name": "SP500", "szDecimals": 2, "maxLeverage": 20},
                {"name": "XYZ100", "szDecimals": 2, "maxLeverage": 20},
            ]}],
        ], None
    if typ == "meta":
        return {"universe": [{"name": "BTC", "szDecimals": 5, "maxLeverage": 50}]}, None
    if typ == "candleSnapshot":
        assert payload["req"]["coin"] == "xyz:SP500"
        return [
            {"t": 1700000000000, "T": 1700000299999, "o": "100.0", "h": "102.0", "l": "99.0", "c": "101.0", "v": "12.5", "n": 8},
        ], None
    if typ == "recentTrades":
        assert payload["coin"] == "xyz:XYZ100"
        return [
            {"time": 1700000000100, "px": "15000.5", "sz": "1.25", "side": "B", "tid": 42, "hash": "0xabc"},
        ], None
    if typ == "l2Book":
        assert payload["coin"] == "BTC"
        return {
            "time": 1700000000200,
            "levels": [
                [{"px": "100.0", "sz": "2.0", "n": 3}],
                [{"px": "101.0", "sz": "1.5", "n": 2}],
            ],
        }, None
    if typ == "fundingHistory":
        return [{"coin": payload["coin"], "fundingRate": "0.0001", "time": 1700000000000}], None
    if typ == "allMids":
        return {"BTC": "100.0", "xyz:SP500": "5000.0", "xyz:XYZ100": "15000.0"}, None
    if typ == "perpDexs":
        return [{"name": "xyz"}], None
    if typ == "metaAndAssetCtxs":
        assert payload.get("dex") == "xyz"
        return [
            {"universe": [{"name": "SP500", "szDecimals": 2, "maxLeverage": 20}]},
            [{"markPx": "5000.0", "midPx": "5000.5", "oraclePx": "4999.5", "funding": "0.00001", "openInterest": "123.45"}],
        ], None
    if typ == "perpConciseAnnotations":
        return {"xyz:SP500": {"source": "test"}}, None
    if typ == "perpCategories":
        return [{"name": "Indices", "assets": ["xyz:SP500", "xyz:XYZ100"]}], None
    if typ == "predictedFundings":
        return [["xyz:SP500", [["HlPerp", {"fundingRate": "0.0002"}]]], ["BTC", []]], None
    if typ == "perpsAtOpenInterestCap":
        return ["xyz:SP500"], None
    raise AssertionError(f"Unexpected Hyperliquid payload: {payload}")


class HyperliquidRoutesTests(unittest.TestCase):
    def setUp(self):
        app_parts._hl_cache.clear()
        self.client = mod.app.test_client()

    def test_catalog_resolves_hip3_priority_markets(self):
        with patch.object(app_parts, "_hl_info_cached", side_effect=_fake_hl_info):
            resp = self.client.get("/api/hyperliquid/catalog?force=1")

        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["priority"]["BTC"]["coin"], "BTC")
        self.assertEqual(data["priority"]["ES"]["coin"], "xyz:SP500")
        self.assertEqual(data["priority"]["NASDAQ"]["coin"], "xyz:XYZ100")

    def test_klines_normalizes_builder_prefixed_contract(self):
        with patch.object(app_parts, "_hl_info_cached", side_effect=_fake_hl_info):
            resp = self.client.get("/api/hyperliquid/klines?market=ES&interval=5m&limit=10&startTime=1700000000000&endTime=1700000300000&force=1")

        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["coin"], "xyz:SP500")
        self.assertEqual(data["candles"][0]["time"], 1700000000)
        self.assertEqual(data["candles"][0]["open"], 100.0)
        self.assertEqual(data["candles"][0]["volume"], 12.5)

    def test_trades_and_orderbook_are_read_only_normalized(self):
        with patch.object(app_parts, "_hl_info_cached", side_effect=_fake_hl_info):
            trades = self.client.get("/api/hyperliquid/trades?market=NASDAQ&force=1")
            book = self.client.get("/api/hyperliquid/orderbook?market=BTC&force=1")

        self.assertEqual(trades.status_code, 200)
        self.assertEqual(trades.get_json()["coin"], "xyz:XYZ100")
        self.assertEqual(trades.get_json()["trades"][0]["side"], "buy")
        self.assertEqual(book.status_code, 200)
        self.assertEqual(book.get_json()["bids"][0]["price"], 100.0)
        self.assertEqual(book.get_json()["asks"][0]["size"], 1.5)

    def test_metadata_contexts_and_predicted_funding(self):
        with patch.object(app_parts, "_hl_info_cached", side_effect=_fake_hl_info):
            dexs = self.client.get("/api/hyperliquid/dexs?force=1")
            contexts = self.client.get("/api/hyperliquid/contexts?market=ES&force=1")
            annotations = self.client.get("/api/hyperliquid/annotations?force=1")
            predicted = self.client.get("/api/hyperliquid/predicted-funding?market=ES&force=1")

        self.assertEqual(dexs.status_code, 200)
        self.assertEqual(dexs.get_json()["dexs"][0]["name"], "xyz")
        self.assertEqual(contexts.status_code, 200)
        self.assertEqual(contexts.get_json()["contexts"][0]["coin"], "xyz:SP500")
        self.assertEqual(contexts.get_json()["contexts"][0]["markPx"], 5000.0)
        self.assertEqual(annotations.status_code, 200)
        self.assertIn("xyz:SP500", annotations.get_json()["annotations"])
        self.assertEqual(predicted.status_code, 200)
        self.assertEqual(predicted.get_json()["predictedFunding"][0][0], "xyz:SP500")


if __name__ == "__main__":
    unittest.main()
