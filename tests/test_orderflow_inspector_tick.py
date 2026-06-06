import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSPECTOR_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "081_v6_orderflow_inspector.js")
SETTINGS_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "079_v6_orderflow_settings.js")


def _node(script):
    result = subprocess.run(
        ["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True
    )
    return result


class InspectorTickBucketingTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _inspector_call(self, expr):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(INSPECTOR_JS)}, 'utf8');
            const context = {{
              window: {{ V6OF: {{}} }},
              document: {{ createElement: () => ({{}}) }},
              console: {{ log(){{}}, warn(){{}}, error(){{}} }},
              Date, Math, JSON, Object, Number, Array, String, setTimeout, clearTimeout,
              requestAnimationFrame: function(cb){{ return 0; }}
            }};
            vm.runInNewContext(code, context);
            const I = context.window.V6OF.Inspector;
            process.stdout.write(JSON.stringify({expr}));
            """
        )
        r = _node(script)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def _inspector_render(self, state):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(INSPECTOR_JS)}, 'utf8');
            const context = {{
              window: {{ V6OF: {{}} }},
              document: {{ createElement: () => ({{}}) }},
              console: {{ log(){{}}, warn(){{}}, error(){{}} }},
              Date, Math, JSON, Object, Number, Array, String, setTimeout, clearTimeout,
              requestAnimationFrame: function(cb){{ return 0; }}
            }};
            vm.runInNewContext(code, context);
            process.stdout.write(context.window.V6OF.Inspector.render({json.dumps(state)}));
            """
        )
        r = _node(script)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def test_tick_decimals(self):
        self.assertEqual(self._inspector_call("I.tickDecimals(0.01)"), 2)
        self.assertEqual(self._inspector_call("I.tickDecimals(0.0001)"), 4)
        self.assertEqual(self._inspector_call("I.tickDecimals(0.5)"), 1)
        self.assertEqual(self._inspector_call("I.tickDecimals(1)"), 0)
        self.assertEqual(self._inspector_call("I.tickDecimals(5)"), 0)
        self.assertEqual(self._inspector_call("I.tickDecimals(0.25)"), 2)
        self.assertEqual(self._inspector_call("I.tickDecimals(0.000001)"), 6)

    def test_fine_tick_buckets_stay_distinct(self):
        # A fine-tick asset: prices 0.0033 apart must NOT collapse to the same
        # 0.01 / 2-decimal bucket.
        k1 = self._inspector_call("I.priceBucketKey(1.2345, 0.0001)")
        k2 = self._inspector_call("I.priceBucketKey(1.2312, 0.0001)")
        self.assertEqual(k1, "1.2345")
        self.assertEqual(k2, "1.2312")
        self.assertNotEqual(k1, k2)

    def test_bucket_snaps_to_tick(self):
        self.assertEqual(self._inspector_call("I.priceBucketKey(100.72, 0.5)"), "100.5")
        self.assertEqual(self._inspector_call("I.priceBucketKey(27.0, 1)"), "27")
        # No spurious extra decimals from float error.
        self.assertEqual(self._inspector_call("I.priceBucketKey(0.3, 0.1)"), "0.3")

    def test_invalid_tick_falls_back(self):
        # Non-positive / NaN tick must not divide-by-zero; falls back to 1.
        self.assertEqual(self._inspector_call("I.priceBucketKey(27.4, 0)"), "27")
        self.assertEqual(self._inspector_call("I.priceBucketKey(27.4, -1)"), "27")

    def test_cvd_requires_exact_interval_bucket(self):
        candle = {
            "openTime": 1000,
            "closeTime": 60999,
            "intervalMs": 60000,
            "open": 100,
            "high": 101,
            "low": 99,
            "close": 100.5,
            "volume": 10,
            "delta": 2,
            "buyVol": 6,
            "sellVol": 4,
            "levels": [{"price": 100, "buyVol": 6, "sellVol": 4, "totalVol": 10}],
        }
        state = {
            "symbol": "BTCUSDT",
            "timeframe": "1m",
            "chartCandles": [candle],
            "ui": {"activeCandleOpenTime": 1000},
            "settings": {"deltaIntervalMs": 60000},
            "deltaBucketsByInterval": {
                "300000": [{"intervalMs": 300000, "startTime": 1000, "endTime": 300999, "cvd": 9000}],
            },
            "deltaBuckets": [{"intervalMs": 300000, "startTime": 1000, "endTime": 300999, "cvd": 9000}],
            "latestDeltaByInterval": {"300000": {"cvd": 9000}},
        }
        html = self._inspector_render(state)
        self.assertIn("<em>CVD</em><strong>--</strong>", html)
        self.assertNotIn("<em>CVD</em><strong>9K</strong>", html)

        state["deltaBucketsByInterval"]["60000"] = [
            {"intervalMs": 60000, "startTime": 1000, "endTime": 60999, "cvd": 321}
        ]
        html = self._inspector_render(state)
        self.assertIn("<em>CVD</em><strong>321</strong>", html)

    def test_inspector_drops_hardcoded_floor_and_precision(self):
        with open(INSPECTOR_JS, "r", encoding="utf-8") as fh:
            src = fh.read()
        self.assertNotRegex(
            src, r"Math\.max\(0\.01,\s*num\(settings\.tickSize",
            "inspector still floors the tick at 0.01",
        )
        self.assertNotRegex(
            src, r"toFixed\(tick\s*<\s*1\s*\?\s*2\s*:\s*0\)",
            "inspector still hardcodes 2/0-decimal bucket keys",
        )


class SettingsTickFloorTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _validate_tick(self, raw):
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
            process.stdout.write(JSON.stringify(context.window.V6OF.Settings.validate({json.dumps(raw)}).tickSize));
            """
        )
        r = _node(script)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_fine_tick_not_floored(self):
        self.assertEqual(self._validate_tick({"tickSize": 0.0001}), 0.0001)

    def test_default_and_invalid(self):
        self.assertEqual(self._validate_tick({}), 1)
        self.assertEqual(self._validate_tick({"tickSize": 0}), 1)
        self.assertEqual(self._validate_tick({"tickSize": -3}), 1)


if __name__ == "__main__":
    unittest.main()
