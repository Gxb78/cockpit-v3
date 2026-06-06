import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "079_v6_orderflow_settings.js")
DOM_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "075_v6_dom_panel.js")


class DomDisplayThresholdTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _validate_min_notional(self, raw):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(SETTINGS_JS)}, 'utf8');
            const storage = {{}};
            const context = {{
              window: {{}},
              console: {{ warn() {{}} }},
              localStorage: {{
                getItem(k) {{ return storage[k] || null; }},
                setItem(k, v) {{ storage[k] = String(v); }},
                removeItem(k) {{ delete storage[k]; }}
              }},
              Date, JSON, Object, Number, Array, Math
            }};
            context.window.V6OF = {{}};
            vm.runInNewContext(code, context);
            const out = context.window.V6OF.Settings.validate({json.dumps(raw)});
            process.stdout.write(JSON.stringify(out.domMinNotionalUsd));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_default_min_notional_is_100(self):
        self.assertEqual(self._validate_min_notional({}), 100)

    def test_min_notional_accepts_and_clamps(self):
        self.assertEqual(self._validate_min_notional({"domMinNotionalUsd": 500}), 500)
        self.assertEqual(self._validate_min_notional({"domMinNotionalUsd": -5}), 0)

    def _threshold(self, settings, usd_mode, live):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(DOM_JS)}, 'utf8');
            const context = {{
              window: {{ V6OF: {{}} }},
              document: {{ createElement: () => ({{}}) }},
              console: {{ log(){{}}, warn(){{}}, error(){{}} }},
              Date, Math, JSON, Object, Number, Array, String, setTimeout, clearTimeout
            }};
            vm.runInNewContext(code, context);
            const f = context.window.V6OF.DomPanel.computeSizeThreshold;
            process.stdout.write(JSON.stringify(f({json.dumps(settings)}, {str(usd_mode).lower()}, {json.dumps(live)})));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_usd_mode_uses_notional_floor_directly(self):
        self.assertEqual(self._threshold({"domMinNotionalUsd": 100}, True, 100000), 100)
        self.assertEqual(self._threshold({"domMinNotionalUsd": 250}, True, 0.5), 250)

    def test_coin_mode_is_instrument_aware(self):
        # BTC at ~$100k reproduces the legacy 0.001 BTC threshold.
        self.assertAlmostEqual(self._threshold({"domMinNotionalUsd": 100}, False, 100000), 0.001)
        # An alt at $0.50 → 100 / 0.5 = 200 units for the same $100 notional.
        self.assertAlmostEqual(self._threshold({"domMinNotionalUsd": 100}, False, 0.5), 200)

    def test_coin_mode_falls_back_when_price_unknown(self):
        self.assertAlmostEqual(self._threshold({"domMinNotionalUsd": 100}, False, 0), 0.001)

    def test_default_notional_when_setting_missing(self):
        self.assertEqual(self._threshold({}, True, 50000), 100)

    def test_panel_no_longer_hardcodes_threshold(self):
        with open(DOM_JS, "r", encoding="utf-8") as fh:
            src = fh.read()
        self.assertNotRegex(
            src, r"usdPrice\s*>\s*0\s*\?\s*100\s*:\s*0\.001",
            "DOM panel still hardcodes the $100 / 0.001 thresholds",
        )
        self.assertIn("domMinNotionalUsd", src,
                      "DOM panel does not reference the configurable notional floor")


if __name__ == "__main__":
    unittest.main()
