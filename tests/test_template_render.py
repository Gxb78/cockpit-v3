import tempfile
import unittest
from pathlib import Path
import re
from unittest.mock import patch

import app as mod
import app_parts


class TemplateRenderTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        # SECURITE: verifier qu'on utilise PAS la DB de production
        prod_db = Path(__file__).resolve().parents[1] / "data" / "journal.db"
        self.assertFalse(
            base / "journal.db" == prod_db,
            "CRITIQUE: le test utiliserait la DB de production !"
        )
        app_parts.DB_PATH = base / "journal.db"
        app_parts.SCREENSHOTS_DIR = base / "screenshots"
        app_parts.BACKUPS_DIR = base / "backups"
        app_parts.SCREENSHOTS_DIR.mkdir(exist_ok=True)
        mod.init_db()
        self.client = mod.app.test_client()

    def tearDown(self):
        self._tmp.cleanup()

    def test_index_renders_with_runtime_assets(self):
        root = Path(__file__).resolve().parents[1]
        js_split = sorted((root / "static" / "js" / "split").glob("*.js"), key=lambda p: p.name)
        css_split = sorted((root / "static" / "css" / "split").glob("*.css"), key=lambda p: p.name)

        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)

        # Accept both split-file mode and bundle mode
        if "/static/js/split/" in html:
            # Split-file mode
            self.assertRegex(html, rf'/static/js/split/{re.escape(js_split[0].name)}\?v=\d{{8}}')
            self.assertRegex(html, rf'/static/js/split/{re.escape(js_split[-1].name)}\?v=\d{{8}}')
            self.assertEqual(html.count('/static/js/split/'), len(js_split))
            self.assertNotIn('/static/app.js', html)
        else:
            # Bundle mode
            self.assertRegex(html, r'/static/app\.js\?v=[a-f0-9]{24}')
            self.assertGreater(html.count('/static/app.js'), 0)

        if "/static/css/split/" in html:
            self.assertRegex(html, rf'/static/css/split/{re.escape(css_split[0].name)}\?v=\d{{8}}')
            self.assertRegex(html, rf'/static/css/split/{re.escape(css_split[-1].name)}\?v=\d{{8}}')
            self.assertEqual(html.count('/static/css/split/'), len(css_split))
            self.assertNotIn('/static/style.css', html)
        else:
            self.assertRegex(html, r'/static/style\.css\?v=[a-f0-9]{24}')
            self.assertGreater(html.count('/static/style.css'), 0)

        self.assertIn('id="wiz"', html, "Le wizard doit etre rendu")
        self.assertIn('id="wiz"', html)
        self.assertIn('data-page="today"', html)
        self.assertIn('id="kpiPnl"', html)
        self.assertIn('id="todayEntries"', html)

    def test_frontend_config_injects_market_ws_url_from_env(self):
        with patch.dict(
            mod.os.environ,
            {"COCKPIT_MARKET_WS_URL": "ws://engine.local:9999/stream", "COCKPIT_MARKET_HTTP_URL": ""},
            clear=False,
        ):
            resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        self.assertIn('"marketWsUrl": "ws://engine.local:9999/stream"', html)

    def test_frontend_config_derives_market_urls_from_market_go_host_port(self):
        with patch.dict(
            mod.os.environ,
            {
                "MARKET_GO_HOST": "0.0.0.0",
                "MARKET_GO_PORT": "9876",
                "COCKPIT_MARKET_WS_URL": "",
                "COCKPIT_MARKET_HTTP_URL": "",
            },
            clear=False,
        ):
            resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        # Key order is serializer-dependent (Flask sorts tojson keys); assert each.
        self.assertIn('"marketWsUrl": "ws://0.0.0.0:9876/stream"', html)
        self.assertIn('"marketHttpUrl": "http://0.0.0.0:9876"', html)

    def test_frontend_config_injects_market_http_url_independently_from_env(self):
        # The HTTP origin must be overridable on its own, not derived from the WS URL.
        with patch.dict(
            mod.os.environ,
            {
                "COCKPIT_MARKET_WS_URL": "ws://engine.local:9999/stream",
                "COCKPIT_MARKET_HTTP_URL": "https://api.engine.local:8443",
            },
            clear=False,
        ):
            resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        self.assertIn('"marketHttpUrl": "https://api.engine.local:8443"', html)
        self.assertIn('"marketWsUrl": "ws://engine.local:9999/stream"', html)


if __name__ == "__main__":
    unittest.main()
