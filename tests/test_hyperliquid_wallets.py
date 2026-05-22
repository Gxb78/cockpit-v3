import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as mod
import app_parts


WALLET = "0x1111111111111111111111111111111111111111"
WALLET_2 = "0x2222222222222222222222222222222222222222"


def _fake_wallet_info(payload, cache_key, ttl, force=False):
    _ = (cache_key, ttl, force)
    typ = payload.get("type")
    dex = payload.get("dex")
    if typ == "perpDexs":
        return [{"name": "xyz"}], None
    if typ == "clearinghouseState":
        if dex == "xyz":
            return {
                "time": 1700000000000,
                "marginSummary": {"accountValue": "5000.0"},
                "assetPositions": [
                    {
                        "position": {
                            "coin": "XYZ100",
                            "szi": "-25.62",
                            "entryPx": "29212.41",
                            "positionValue": "754420.65",
                            "unrealizedPnl": "-6086.32",
                        },
                    },
                    {
                        "position": {
                            "coin": "TSLA",
                            "szi": "-1030.0",
                            "entryPx": "425.16",
                            "positionValue": "431743.63",
                            "unrealizedPnl": "5903.27",
                        },
                    },
                ],
            }, None
        return {
            "time": 1700000000000,
            "marginSummary": {"accountValue": "10000.0"},
            "crossMarginSummary": {"totalMarginUsed": "1000.0"},
            "withdrawable": "9000.0",
            "assetPositions": [
                {
                    "type": "oneWay",
                    "position": {
                        "coin": "BTC",
                        "szi": "0.5",
                        "entryPx": "65000.0",
                        "positionValue": "32500.0",
                        "unrealizedPnl": "125.0",
                        "returnOnEquity": "0.12",
                        "liquidationPx": "58000.0",
                        "marginUsed": "1000.0",
                        "leverage": {"type": "cross", "value": 10},
                    },
                }
            ],
        }, None
    if typ == "frontendOpenOrders":
        if dex:
            return [], None
        return [{"coin": "BTC", "side": "A", "limitPx": "70000.0", "sz": "0.25", "oid": 7, "timestamp": 1700000001000}], None
    if typ == "userFillsByTime":
        if dex:
            return [{"coin": "XYZ100", "dir": "Open Short", "side": "A", "px": "29212.41", "sz": "25.62", "time": 1700000200000, "tid": 3}], None
        return [
            {"coin": "BTC", "dir": "Open Long", "side": "B", "px": "65000.0", "sz": "0.5", "time": 1700000000000, "tid": 1},
            {"coin": "BTC", "dir": "Close Long", "side": "A", "px": "66000.0", "sz": "0.25", "closedPnl": "250.0", "time": 1700000300000, "tid": 2},
        ], None
    if typ == "userFills":
        if dex:
            return [{"coin": "XYZ100", "dir": "Open Short", "side": "A", "px": "29212.41", "sz": "25.62", "time": 1700000200000, "tid": 3}], None
        return [{"coin": "BTC", "dir": "Open Long", "side": "B", "px": "65000.0", "sz": "0.5", "time": 1700000000000, "tid": 1}], None
    raise AssertionError(f"Unexpected payload: {payload}")


class HyperliquidWalletTests(unittest.TestCase):
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

    def _create_wallet(self):
        return self.client.post("/api/hyperliquid/wallets", json={
            "address": WALLET,
            "label": "Strong trader",
            "tags": ["btc", "scalp", "btc"],
        })

    def test_wallet_crud_persists_watchlist(self):
        created = self._create_wallet()
        self.assertEqual(created.status_code, 201)
        wallet = created.get_json()["wallet"]
        self.assertEqual(wallet["address"], WALLET)
        self.assertEqual(wallet["tags"], ["btc", "scalp"])

        listed = self.client.get("/api/hyperliquid/wallets")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.get_json()["wallets"]), 1)

        updated = self.client.put(f"/api/hyperliquid/wallets/{wallet['id']}", json={"label": "Updated", "is_active": False})
        self.assertEqual(updated.status_code, 200)
        self.assertFalse(updated.get_json()["wallet"]["is_active"])
        self.assertEqual(updated.get_json()["wallet"]["label"], "Updated")

        active_only = self.client.get("/api/hyperliquid/wallets")
        self.assertEqual(active_only.get_json()["wallets"], [])

    def test_wallet_update_can_change_address_and_label(self):
        wallet_id = self._create_wallet().get_json()["wallet"]["id"]

        updated = self.client.put(f"/api/hyperliquid/wallets/{wallet_id}", json={
            "address": f"https://app.hyperliquid.xyz/explorer/address/{WALLET_2}",
            "label": "New wallet",
        })

        self.assertEqual(updated.status_code, 200)
        wallet = updated.get_json()["wallet"]
        self.assertEqual(wallet["address"], WALLET_2)
        self.assertEqual(wallet["label"], "New wallet")

    def test_create_extracts_address_from_pasted_text(self):
        pasted = f"https://app.hyperliquid.xyz/explorer/address/{WALLET.upper()}\u200b"
        created = self.client.post("/api/hyperliquid/wallets", json={
            "address": pasted,
            "label": "Pasted",
        })

        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.get_json()["wallet"]["address"], WALLET)

    def test_state_fills_and_events_are_normalized(self):
        wallet_id = self._create_wallet().get_json()["wallet"]["id"]

        with patch.object(app_parts, "_hl_info_cached", side_effect=_fake_wallet_info):
            state = self.client.get(f"/api/hyperliquid/wallets/{wallet_id}/state?force=1")
            fills = self.client.get(f"/api/hyperliquid/wallets/{wallet_id}/fills?startTime=1700000000000&endTime=1700000600000&force=1")
            events = self.client.get(f"/api/hyperliquid/wallets/{wallet_id}/events?startTime=1700000000000&endTime=1700000600000&force=1")

        self.assertEqual(state.status_code, 200)
        self.assertEqual(state.get_json()["positions"][0]["side"], "long")
        self.assertEqual(state.get_json()["positions"][0]["entryPx"], 65000.0)
        self.assertEqual(state.get_json()["openOrders"][0]["limitPx"], 70000.0)

        self.assertEqual(fills.status_code, 200)
        fill_types = [fill["eventType"] for fill in fills.get_json()["fills"]]
        self.assertEqual(fill_types[0], "open")
        self.assertIn("close", fill_types)
        self.assertIn("xyz:XYZ100", [fill["coin"] for fill in fills.get_json()["fills"]])

        self.assertEqual(events.status_code, 200)
        labels = [event["label"] for event in events.get_json()["events"]]
        self.assertIn("partial_or_close", labels)
        self.assertIn("current_position", labels)

    def test_state_aggregates_hip3_dex_positions(self):
        wallet_id = self._create_wallet().get_json()["wallet"]["id"]

        with patch.object(app_parts, "_hl_info_cached", side_effect=_fake_wallet_info):
            state = self.client.get(f"/api/hyperliquid/wallets/{wallet_id}/state?force=1")

        self.assertEqual(state.status_code, 200)
        coins = [pos["coin"] for pos in state.get_json()["positions"]]
        self.assertEqual(coins, ["BTC", "xyz:XYZ100", "xyz:TSLA"])
        self.assertEqual(state.get_json()["state"]["count"], 3)

    def test_state_by_address_without_saved_wallet(self):
        with patch.object(app_parts, "_hl_info_cached", side_effect=_fake_wallet_info):
            resp = self.client.get(f"/api/hyperliquid/wallet-state?address={WALLET}&force=1")

        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.get_json()["wallet"]["id"])
        self.assertEqual(resp.get_json()["positions"][0]["coin"], "BTC")


if __name__ == "__main__":
    unittest.main()
