import json
import os
import re
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "079_v6_orderflow_settings.js")
LAYOUT_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "073_v6_orderflow_layout.js")


class TradePrefillLimitTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _validate(self, raw):
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
            process.stdout.write(JSON.stringify(out.restTradePrefillLimit));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_default_prefill_limit_is_100000(self):
        self.assertEqual(self._validate({}), 100000)

    def test_prefill_limit_accepts_valid_value(self):
        self.assertEqual(self._validate({"restTradePrefillLimit": 2000}), 2000)

    def test_prefill_limit_is_clamped_and_rounded(self):
        self.assertEqual(self._validate({"restTradePrefillLimit": 999999}), 100000)
        self.assertEqual(self._validate({"restTradePrefillLimit": 1}), 50)
        self.assertEqual(self._validate({"restTradePrefillLimit": 123.7}), 124)

    def test_layout_uses_configurable_prefill_limit(self):
        with open(LAYOUT_JS, "r", encoding="utf-8") as fh:
            src = fh.read()
        # The trade prefetch must derive its cap from the setting.
        self.assertIn("restTradePrefillLimit", src,
                      "layout does not reference the configurable prefill limit")
        # No hardcoded 500-trade cap should remain on the aggtrades URL or the slice.
        self.assertNotRegex(
            src, r"aggtrades\?symbol='[^;]*&limit=500",
            "layout still hardcodes aggtrades limit=500",
        )
        self.assertNotRegex(
            src, r"trades\.slice\(-500\)",
            "layout still hardcodes the 500-trade slice cap",
        )


if __name__ == "__main__":
    unittest.main()
