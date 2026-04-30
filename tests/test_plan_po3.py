import json
import tempfile
import unittest
from pathlib import Path

import app as mod
import app_parts


class PlanPO3Tests(unittest.TestCase):
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

    def _day(self, date_key="2026-04-28"):
        resp = self.client.post("/api/days", json={"date": date_key, "instrument": "BTC"})
        self.assertEqual(resp.status_code, 201)
        return resp.json["id"]

    def _snapshot(self, open_behavior, **coach_overrides):
        coach = {
            "pre_open": "range",
            "open_behavior": open_behavior,
            "po3_state": "yes",
            "entry_trigger": "ifvg",
            "zone_rule": "premium" if open_behavior == "rise" else "discount",
            "smt_state": "bearish" if open_behavior == "rise" else "bullish",
            "liquidity_target": "below" if open_behavior == "rise" else "above",
            "counter_thesis": "Invalidation claire du scenario PO3.",
        }
        coach.update(coach_overrides)
        return {"version": 1, "coach": coach}

    def _trade(self, day_id, **payload):
        body = {
            "strategy": "midnight_model",
            "direction": "short",
            "entry_price": 100,
            "stop_loss": 110,
            "take_profit": 80,
            "plan_snapshot": self._snapshot("rise"),
        }
        body.update(payload)
        resp = self.client.post(f"/api/days/{day_id}/trades", json=body)
        self.assertEqual(resp.status_code, 201, resp.get_data(as_text=True))
        return resp.json

    def test_open_rise_short_premium_is_in_plan(self):
        trade = self._trade(self._day())
        self.assertEqual(trade["plan_direction"], "short")
        self.assertEqual(trade["plan_alignment"], "in_plan")
        self.assertEqual(trade["plan_errors"], [])

    def test_open_rise_long_is_out_of_plan_counter_direction(self):
        trade = self._trade(
            self._day(),
            direction="long",
            entry_price=100,
            stop_loss=90,
            take_profit=120,
            plan_override_reason="Signal discretionnaire accepte avant execution.",
        )
        self.assertEqual(trade["plan_direction"], "short")
        self.assertEqual(trade["plan_alignment"], "out_of_plan")
        self.assertIn("counter_direction", trade["plan_errors"])

    def test_open_drop_long_is_in_plan(self):
        trade = self._trade(
            self._day(),
            direction="long",
            entry_price=100,
            stop_loss=90,
            take_profit=120,
            plan_snapshot=self._snapshot("drop"),
        )
        self.assertEqual(trade["plan_direction"], "long")
        self.assertEqual(trade["plan_alignment"], "in_plan")

    def test_stats_matrix_separates_plan_and_result(self):
        d1 = self._day("2026-04-27")
        self._trade(d1, pnl=-50, is_win=0)
        d2 = self._day("2026-04-28")
        self._trade(
            d2,
            direction="long",
            entry_price=100,
            stop_loss=90,
            take_profit=120,
            pnl=75,
            is_win=1,
            plan_override_reason="Override assume.",
        )

        stats = self.client.get("/api/stats")
        self.assertEqual(stats.status_code, 200)
        matrix = stats.json["plan_matrix"]
        self.assertEqual(matrix["in_plan_loss"]["count"], 1)
        self.assertEqual(matrix["out_of_plan_win"]["count"], 1)
        self.assertIn("counter_direction", stats.json["by_plan_error"])

    def test_legacy_trade_without_plan_is_unknown_in_stats(self):
        day_id = self._day()
        resp = self.client.post(
            f"/api/days/{day_id}/trades",
            json={
                "direction": "long",
                "entry_price": 100,
                "stop_loss": 90,
                "take_profit": 120,
                "pnl": 25,
                "is_win": 1,
            },
        )
        self.assertEqual(resp.status_code, 201)
        stats = self.client.get("/api/stats")
        self.assertEqual(stats.status_code, 200)
        self.assertEqual(stats.json["plan_matrix"]["unknown"]["count"], 1)


if __name__ == "__main__":
    unittest.main()
