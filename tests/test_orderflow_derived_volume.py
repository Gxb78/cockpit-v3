import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSPECTOR_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "081_v6_orderflow_inspector.js")


def _node(script):
    return subprocess.run(["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True)


_CTX = """
const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync(%s, 'utf8');
const context = {
  window: { V6OF: {} },
  document: { createElement: () => ({}) },
  console: { log(){}, warn(){}, error(){} },
  Date, Math, JSON, Object, Number, Array, String, Set, setTimeout, clearTimeout,
  requestAnimationFrame: function(){ return 0; },
  fetch: function(){ return Promise.reject(new Error('no network in test')); }
};
vm.runInNewContext(code, context);
const I = context.window.V6OF.Inspector;
""" % json.dumps(INSPECTOR_JS)


class DerivedVolumeFlagTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _derive(self, candle):
        script = _CTX + (
            "const m = I.deriveMetrics(%s, { settings: {} });"
            "process.stdout.write(JSON.stringify({"
            " derived: m.buySellDerived, buyVol: m.buyVol, sellVol: m.sellVol }));"
            % json.dumps(candle)
        )
        r = _node(script)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_real_buy_sell_not_derived(self):
        out = self._derive({"buyVol": 6, "sellVol": 4, "volume": 10, "delta": 2,
                            "open": 100, "close": 100.5, "high": 101, "low": 99, "levels": []})
        self.assertFalse(out["derived"])
        self.assertEqual(out["buyVol"], 6)
        self.assertEqual(out["sellVol"], 4)

    def test_levels_summed_not_derived(self):
        out = self._derive({"buyVol": 0, "sellVol": 0, "volume": 0, "delta": 0,
                            "open": 100, "close": 100.5, "high": 101, "low": 99,
                            "levels": [{"price": 100, "buyVol": 6, "sellVol": 4}]})
        self.assertFalse(out["derived"])
        self.assertEqual(out["buyVol"], 6)
        self.assertEqual(out["sellVol"], 4)

    def test_volume_delta_synthesis_is_derived(self):
        out = self._derive({"buyVol": 0, "sellVol": 0, "volume": 10, "delta": 2,
                            "open": 100, "close": 100.5, "high": 101, "low": 99, "levels": []})
        self.assertTrue(out["derived"])
        # buy = (vol + delta)/2 = 6 ; sell = (vol - delta)/2 = 4
        self.assertEqual(out["buyVol"], 6)
        self.assertEqual(out["sellVol"], 4)

    def _render(self, candle):
        state = {
            "symbol": "BTCUSDT",
            "timeframe": "1m",
            "chartCandles": [candle],
            "ui": {"activeCandleOpenTime": candle["openTime"]},
            "settings": {},
        }
        script = _CTX + (
            "process.stdout.write(I.render(%s));" % json.dumps(state)
        )
        r = _node(script)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def test_render_marks_derived_candle(self):
        html = self._render({
            "openTime": 1000, "closeTime": 60999, "intervalMs": 60000,
            "open": 100, "high": 101, "low": 99, "close": 100.5,
            "volume": 10, "delta": 2, "buyVol": 0, "sellVol": 0, "levels": [],
        })
        self.assertIn("is-derived", html)

    def test_render_does_not_mark_real_candle(self):
        html = self._render({
            "openTime": 1000, "closeTime": 60999, "intervalMs": 60000,
            "open": 100, "high": 101, "low": 99, "close": 100.5,
            "volume": 10, "delta": 2, "buyVol": 6, "sellVol": 4, "levels": [],
        })
        self.assertNotIn("is-derived", html)


if __name__ == "__main__":
    unittest.main()
