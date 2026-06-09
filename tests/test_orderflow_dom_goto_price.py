import json
import os
import subprocess
import textwrap
import unittest

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOM_LADDER_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "090_v6_dom_ladder.js")


class OrderflowDomGotoPriceTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _run_js(self, js_code):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const codeLadder = fs.readFileSync({json.dumps(DOM_LADDER_JS)}, 'utf8');
            const context = {{
              window: {{ V6OF: {{}} }},
              console: {{ log(){{}}, warn(){{}}, error(){{}} }},
              Date, Math, JSON, Object, Number, Array, String, Map, setTimeout, clearTimeout
            }};
            vm.runInNewContext(codeLadder, context);
            const DomLadder = context.window.V6OF.DomLadder;
            {js_code}
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_center_window_on_tick_shifts_boundaries(self):
        js = """
        DomLadder.reset();
        DomLadder.setGrouping(1);
        DomLadder.feedOrderBook({
          symbol: 'BTCUSDT',
          bids: [{ price: 100, size: 1.0 }],
          asks: [{ price: 101, size: 1.0 }],
          bestBid: 100,
          bestAsk: 101,
          spread: 1,
          mid: 100.5
        });

        // Jump to tick 500
        DomLadder.centerWindowOnTick(500);
        const snap = DomLadder.snapshot();

        process.stdout.write(JSON.stringify({
          viewMin: snap.viewMin,
          viewMax: snap.viewMax,
          midTick: snap.midTick
        }));
        """
        res = self._run_js(js)
        # VIEW_HALF_RANGE is 200, so centered around 500 should mean 300 to 700
        self.assertEqual(res["viewMin"], 300)
        self.assertEqual(res["viewMax"], 700)

    def test_autocenter_disabled_prevents_feed_shifting(self):
        js = """
        DomLadder.reset();
        DomLadder.setGrouping(1);
        DomLadder.feedOrderBook({
          symbol: 'BTCUSDT',
          bids: [{ price: 100, size: 1.0 }],
          asks: [{ price: 101, size: 1.0 }],
          bestBid: 100,
          bestAsk: 101,
          spread: 1,
          mid: 100.5
        });

        const snap1 = DomLadder.snapshot();
        const firstMin = snap1.viewMin;
        const firstMax = snap1.viewMax;

        // Disable auto-centering
        DomLadder.setAutoCenterEnabled(false);

        // Jump to tick 500
        DomLadder.centerWindowOnTick(500);

        // Feed new order book with mid at 100.5 (far outside tick 500 comfort zone)
        DomLadder.feedOrderBook({
          symbol: 'BTCUSDT',
          bids: [{ price: 100, size: 1.0 }],
          asks: [{ price: 101, size: 1.0 }],
          bestBid: 100,
          bestAsk: 101,
          spread: 1,
          mid: 100.5
        });

        const snap2 = DomLadder.snapshot();

        process.stdout.write(JSON.stringify({
          firstMin,
          firstMax,
          secondMin: snap2.viewMin,
          secondMax: snap2.viewMax
        }));
        """
        res = self._run_js(js)
        # With auto-center disabled, the window should stay centered on 500 (300 to 700)
        # and NOT snap back to mid 100 (which would be -100 to 300)
        self.assertEqual(res["secondMin"], 300)
        self.assertEqual(res["secondMax"], 700)


if __name__ == "__main__":
    unittest.main()
