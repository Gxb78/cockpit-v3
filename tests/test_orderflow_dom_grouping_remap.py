import json
import os
import subprocess
import textwrap
import unittest

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOM_LADDER_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "090_v6_dom_ladder.js")


class OrderflowDomGroupingRemapTests(unittest.TestCase):
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

    def test_grouping_remaps_levels_without_clearing_history(self):
        js = """
        // 1. Initialise orderbook at tickSize=1
        DomLadder.reset();
        DomLadder.setGrouping(1);
        DomLadder.feedOrderBook({
          symbol: 'BTCUSDT',
          bids: [{ price: 100, size: 1.5 }, { price: 99, size: 2.0 }, { price: 98, size: 1.0 }],
          asks: [{ price: 101, size: 1.2 }, { price: 102, size: 0.8 }, { price: 103, size: 2.5 }],
          bestBid: 100,
          bestAsk: 101,
          spread: 1,
          mid: 100.5
        });

        // 2. Feed some trades (adds buy/sell volumes to book levels)
        DomLadder.feedTrade({ price: 100, qty: 0.5, side: 'buy' });
        DomLadder.feedTrade({ price: 99, qty: 1.2, side: 'sell' });
        DomLadder.feedTrade({ price: 98, qty: 0.4, side: 'buy' });

        const snapBefore = DomLadder.snapshot();
        const bookBefore = [];
        snapBefore.book.forEach(lv => {
          bookBefore.push({
            price: lv.price,
            bid: lv.bidSize,
            ask: lv.askSize,
            buyVol: lv.buyVol,
            sellVol: lv.sellVol,
            delta: lv.delta
          });
        });

        // 3. Change grouping to 5
        DomLadder.setGrouping(5);

        const snapAfter = DomLadder.snapshot();
        const bookAfter = [];
        snapAfter.book.forEach(lv => {
          bookAfter.push({
            price: lv.price,
            bid: lv.bidSize,
            ask: lv.askSize,
            buyVol: lv.buyVol,
            sellVol: lv.sellVol,
            delta: lv.delta
          });
        });

        process.stdout.write(JSON.stringify({
          before: bookBefore,
          after: bookAfter,
          priceGrouping: snapAfter.priceGrouping,
          tickSize: snapAfter.tickSize,
          minTick: snapAfter.minTick,
          maxTick: snapAfter.maxTick
        }));
        """
        res = self._run_js(js)

        # Verify initial book size and trade inputs
        self.assertEqual(len(res["before"]), 6)
        self.assertEqual(res["priceGrouping"], 5)
        self.assertEqual(res["tickSize"], 5)

        # After grouping by 5:
        # Prices 98, 99, 100, 101, 102 should merge depending on Math.round(price/5)*5:
        # 100 -> 100
        # 99 -> 100
        # 98 -> 100
        # 101 -> 100
        # 102 -> 100
        # 103 -> 105
        # So we expect levels at price 100 and 105!
        self.assertEqual(len(res["after"]), 2)
        
        # Check level 100 aggregation:
        # Bids: 100 (1.5), 99 (2.0), 98 (1.0) -> sum = 4.5
        # Asks: 101 (1.2), 102 (0.8) -> sum = 2.0
        # BuyVol: 100 (0.5), 98 (0.4) -> sum = 0.9
        # SellVol: 99 (1.2) -> sum = 1.2
        # Delta: 0.9 - 1.2 = -0.3
        level100 = next(x for x in res["after"] if x["price"] == 100)
        self.assertAlmostEqual(level100["bid"], 4.5)
        self.assertAlmostEqual(level100["ask"], 2.0)
        self.assertAlmostEqual(level100["buyVol"], 0.9)
        self.assertAlmostEqual(level100["sellVol"], 1.2)
        self.assertAlmostEqual(level100["delta"], -0.3)

        # Check level 105 aggregation:
        # Asks: 103 (2.5) -> sum = 2.5
        level105 = next(x for x in res["after"] if x["price"] == 105)
        self.assertAlmostEqual(level105["ask"], 2.5)

    def test_view_limits_are_scaled_proportionally(self):
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
        const minTick1 = snap1.viewMin;
        const maxTick1 = snap1.viewMax;

        DomLadder.setGrouping(10);
        const snap10 = DomLadder.snapshot();

        process.stdout.write(JSON.stringify({
          minTick1,
          maxTick1,
          minTick10: snap10.viewMin,
          maxTick10: snap10.viewMax
        }));
        """
        res = self._run_js(js)
        self.assertAlmostEqual(res["minTick10"], round(res["minTick1"] / 10.0))
        self.assertAlmostEqual(res["maxTick10"], round(res["maxTick1"] / 10.0))

    def test_native_tick_size_distinction(self):
        js = """
        DomLadder.reset();
        DomLadder.setGrouping(5);
        DomLadder.feedOrderBook({
          symbol: 'BTCUSDT',
          tickSize: 0.1,
          bids: [{ price: 100, size: 1.0 }],
          asks: [{ price: 100.5, size: 1.0 }],
          bestBid: 100,
          bestAsk: 100.5,
          spread: 0.5,
          mid: 100.25
        });
        const snap = DomLadder.snapshot();
        process.stdout.write(JSON.stringify({
          nativeTickSize: snap.nativeTickSize,
          tickSize: snap.tickSize,
          priceGrouping: snap.priceGrouping
        }));
        """
        res = self._run_js(js)
        self.assertEqual(res["nativeTickSize"], 0.1)
        # priceGrouping is the price-bucket size in quote units: tickSize == the
        # grouping (floored at the native tick), so "Group 5" = $5 levels.
        self.assertAlmostEqual(res["tickSize"], 5.0)
        self.assertEqual(res["priceGrouping"], 5)

    def test_native_tick_size_change_triggers_remapping(self):
        js = """
        DomLadder.reset();
        DomLadder.setGrouping(5);
        
        // Feed 1: native tick size = 1
        DomLadder.feedOrderBook({
          symbol: 'BTCUSDT',
          tickSize: 1.0,
          bids: [{ price: 100, size: 1.5 }, { price: 95, size: 2.0 }],
          asks: [{ price: 105, size: 1.2 }],
          bestBid: 100,
          bestAsk: 105,
          spread: 5,
          mid: 102.5
        });

        // Feed some trades
        DomLadder.feedTrade({ price: 100, qty: 0.5, side: 'buy' });

        // Feed 2: native tick size changes to 0.5
        DomLadder.feedOrderBook({
          symbol: 'BTCUSDT',
          tickSize: 0.5,
          bids: [{ price: 100, size: 1.5 }, { price: 97.5, size: 1.0 }, { price: 95, size: 2.0 }],
          asks: [{ price: 105, size: 1.2 }],
          bestBid: 100,
          bestAsk: 105,
          spread: 5,
          mid: 102.5
        });

        const snap = DomLadder.snapshot();
        const book = [];
        snap.book.forEach(lv => {
          book.push({
            price: lv.price,
            bid: lv.bidSize,
            buyVol: lv.buyVol
          });
        });

        process.stdout.write(JSON.stringify({
          nativeTickSize: snap.nativeTickSize,
          tickSize: snap.tickSize,
          book: book
        }));
        """
        res = self._run_js(js)
        self.assertEqual(res["nativeTickSize"], 0.5)
        # Dollar-bucket grouping: tickSize == the grouping (5), independent of the
        # native tick, so levels aggregate at multiples of 5.
        self.assertEqual(res["tickSize"], 5.0)
        # 100 (1.5) and 97.5 (1.0) both snap to the 100 bucket → bid 2.5.
        level100 = next(x for x in res["book"] if x["price"] == 100.0)
        self.assertAlmostEqual(level100["bid"], 2.5)
        self.assertAlmostEqual(level100["buyVol"], 0.5)
        # 95 (2.0) snaps to its own 95 bucket; 97.5 is merged into 100.
        level95 = next(x for x in res["book"] if x["price"] == 95.0)
        self.assertAlmostEqual(level95["bid"], 2.0)
        self.assertFalse(any(x["price"] == 97.5 for x in res["book"]))


if __name__ == "__main__":
    unittest.main()
