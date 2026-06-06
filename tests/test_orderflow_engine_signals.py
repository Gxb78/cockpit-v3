import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSPECTOR_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "081_v6_orderflow_inspector.js")


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
  fetch: function(){ return Promise.reject(new Error('no network')); }
};
vm.runInNewContext(code, context);
const I = context.window.V6OF.Inspector;
""" % json.dumps(INSPECTOR_JS)


# An engine candle whose flags deliberately DISAGREE with what the client would
# compute from its (flat) levels — proving the engine values win.
ENGINE_CANDLE = {
    "openTime": 1000, "closeTime": 60999, "intervalMs": 60000,
    "open": 100, "high": 101, "low": 99, "close": 100.5,
    "volume": 20, "buyVol": 11, "sellVol": 9, "delta": 2,
    "signalsDerived": True,
    "maxImbalanceRatio": 7,
    "buyImbalanceCount": 4, "sellImbalanceCount": 1,
    "stackedBuyImbalanceCount": 3, "stackedSellImbalanceCount": 0,
    "hasBuyAbsorption": True, "hasSellAbsorption": False,
    "isExhaustionHigh": True, "isExhaustionLow": False,
    "isUnfinishedHigh": True, "isUnfinishedLow": False,
    "levels": [
        {"price": 100, "buyVol": 5, "sellVol": 5, "buyImbalance": False, "sellImbalance": False},
        {"price": 101, "buyVol": 6, "sellVol": 4, "buyImbalance": True, "sellImbalance": False},
    ],
}

# Same shape but no engine signals → client must compute.
CLIENT_CANDLE = {
    "openTime": 1000, "closeTime": 60999, "intervalMs": 60000,
    "open": 100, "high": 101, "low": 99, "close": 100.5,
    "volume": 20, "buyVol": 11, "sellVol": 9, "delta": 2,
    "levels": [
        {"price": 100, "buyVol": 1, "sellVol": 30},
        {"price": 101, "buyVol": 60, "sellVol": 1},
    ],
}


class EngineSignalConsumptionTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _derive(self, candle):
        script = _CTX + (
            "const m = I.deriveMetrics(%s, { settings: {} });"
            "process.stdout.write(JSON.stringify({"
            " src: m.signalsSource, maxImb: m.maxImbalanceRatio,"
            " buyImb: m.buyImbalanceCount, stackBuy: m.stackedBuyImbalanceCount,"
            " buyAbs: m.hasBuyAbsorption, exhHigh: m.isExhaustionHigh,"
            " lvl1Buy: m.levels[1].buyImbalance }));" % json.dumps(candle)
        )
        r = subprocess.run(["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_engine_flags_are_used_verbatim(self):
        out = self._derive(ENGINE_CANDLE)
        self.assertEqual(out["src"], "engine")
        self.assertEqual(out["maxImb"], 7)
        self.assertEqual(out["buyImb"], 4)
        self.assertEqual(out["stackBuy"], 3)
        self.assertTrue(out["buyAbs"])      # engine says true; flat levels would say false
        self.assertTrue(out["exhHigh"])
        self.assertTrue(out["lvl1Buy"])     # per-level flag preserved from engine

    def test_client_fallback_computes_when_no_engine_flags(self):
        out = self._derive(CLIENT_CANDLE)
        self.assertEqual(out["src"], "computed")
        # Level 1 has buy 60 vs diagonal sell 30 → ratio 2 (< 3) so NOT flagged,
        # but the strong low sell / high buy shapes are client-derived, not engine.
        self.assertGreater(out["maxImb"], 0)

    def _render(self, candle):
        state = {
            "symbol": "BTCUSDT", "timeframe": "1m",
            "chartCandles": [candle],
            "ui": {"activeCandleOpenTime": candle["openTime"]},
            "settings": {},
        }
        script = _CTX + ("process.stdout.write(I.render(%s));" % json.dumps(state))
        r = subprocess.run(["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def test_render_shows_engine_badge(self):
        self.assertIn("is-engine", self._render(ENGINE_CANDLE))

    def test_render_shows_computed_badge(self):
        html = self._render(CLIENT_CANDLE)
        self.assertIn("is-computed", html)
        self.assertNotIn("is-engine", html)


if __name__ == "__main__":
    unittest.main()
