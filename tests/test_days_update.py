import tempfile
import unittest
from pathlib import Path

import app as mod
import app_parts


class DaysUpdateTests(unittest.TestCase):
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

    def _create_day(self, date="2026-04-27", instrument="BTC", **overrides):
        payload = {"date": date, "instrument": instrument}
        payload.update(overrides)
        return self.client.post("/api/days", json=payload)

    def test_update_day_changes_instrument(self):
        created = self._create_day(instrument="BTC")
        self.assertEqual(created.status_code, 201)
        day_id = created.json["id"]

        resp = self.client.put(f"/api/days/{day_id}", json={"instrument": "ETH"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["instrument"], "ETH")

        fetched = self.client.get(f"/api/days/{day_id}")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json["instrument"], "ETH")

    def test_update_day_rejects_invalid_instrument(self):
        created = self._create_day()
        day_id = created.json["id"]
        resp = self.client.put(f"/api/days/{day_id}", json={"instrument": "DOGE"})
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(resp.is_json)
        self.assertIn("instrument", resp.json["error"])

    def test_update_day_duplicate_pair_returns_409(self):
        first = self._create_day(date="2026-04-27", instrument="BTC")
        second = self._create_day(date="2026-04-27", instrument="ETH")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        second_id = second.json["id"]

        resp = self.client.put(f"/api/days/{second_id}", json={"instrument": "BTC"})
        self.assertEqual(resp.status_code, 409)
        self.assertTrue(resp.is_json)
        self.assertIn("existe", resp.json["error"])


if __name__ == "__main__":
    unittest.main()
