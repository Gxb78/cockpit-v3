import tempfile
import unittest
from pathlib import Path

import app as mod
import app_parts


class UserSettingsRoutesTests(unittest.TestCase):
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

    def test_persists_v6_orderflow_settings_surface(self):
        payload = {
            "v6_orderflow_settings": {
                "schemaVersion": 1,
                "showTape": False,
                "showDOM": True,
                "theme": "dark-tv",
            }
        }
        resp = self.client.post("/api/user/settings", json=payload)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json["ok"])

        fetched = self.client.get("/api/user/settings")
        self.assertEqual(fetched.status_code, 200)
        settings = fetched.json["settings"]["v6_orderflow_settings"]
        self.assertEqual(settings["schemaVersion"], 1)
        self.assertFalse(settings["showTape"])
        self.assertTrue(settings["showDOM"])
        self.assertEqual(settings["theme"], "dark-tv")

    def test_user_profile_and_workspace_profile_are_separate_domains(self):
        profile_resp = self.client.post("/api/user/profile", json={
            "profile": {"pseudo": "desk-one"},
            "preferences": {"dark_mode": True},
            "v6_workspaces": {"ignored": True},
        })
        self.assertEqual(profile_resp.status_code, 200)
        self.assertEqual(set(profile_resp.json["saved"]), {"profile", "preferences"})

        workspace_resp = self.client.post("/api/user/workspace-profile", json={
            "v6_orderflow_settings": {"schemaVersion": 1, "showTape": False},
            "v6_workspaces": {"schemaVersion": 1, "list": {}},
            "profile": {"pseudo": "ignored"},
        })
        self.assertEqual(workspace_resp.status_code, 200)
        self.assertEqual(set(workspace_resp.json["saved"]), {"v6_orderflow_settings", "v6_workspaces"})

        profile = self.client.get("/api/user/profile").json["profile"]
        workspace = self.client.get("/api/user/workspace-profile").json["workspace_profile"]
        self.assertIn("profile", profile)
        self.assertIn("preferences", profile)
        self.assertNotIn("v6_workspaces", profile)
        self.assertIn("v6_orderflow_settings", workspace)
        self.assertIn("v6_workspaces", workspace)
        self.assertNotIn("profile", workspace)


if __name__ == "__main__":
    unittest.main()
