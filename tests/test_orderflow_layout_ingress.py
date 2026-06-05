import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYOUT_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "073_v6_orderflow_layout.js")


class OrderflowLayoutIngressTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _run_node(self, script):
        result = subprocess.run(
            ["node", "-e", script],
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_canonicalizes_binance_rest_payloads(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(LAYOUT_JS)}, 'utf8');
            const context = {{
              window: {{}},
              console: {{ log() {{}}, warn() {{}} }},
              Date: {{ now: () => 1710000000000 }},
              Object,
              Number,
              Array,
              String,
              parseInt,
              parseFloat,
              setInterval() {{}},
              clearInterval() {{}}
            }};
            context.window.V6OF = {{}};
            vm.runInNewContext(code, context);
            const n = context.window.V6OF.LayoutIngress;
            const out = {{
              symbol: n.normalizeSymbol('btc', 'binance'),
              book: n.normalizeOrderBook({{
                bids: [['100.5', '2'], ['bad', '1']],
                asks: [['101.25', '3']]
              }}, 'binance'),
              trades: n.normalizeTrades([
                {{ p: '100.5', q: '0.25', T: 1700000000000, m: false }},
                {{ p: 'bad', q: '1', T: 1700000000001, m: true }}
              ], 'binance', 'btc'),
              candles: n.normalizeCandles({{
                candles: [{{ time: 1700000000, open: '1', high: '2', low: '0.5', close: '1.5', volume: '42' }}]
              }}, 'binance', '1m')
            }};
            process.stdout.write(JSON.stringify(out));
            """
        )
        out = self._run_node(script)
        self.assertEqual(out["symbol"], "BTCUSDT")
        self.assertEqual(out["book"]["bestBid"], 100.5)
        self.assertEqual(out["book"]["bestAsk"], 101.25)
        self.assertEqual(out["book"]["tsLocal"], 1710000000000)
        self.assertEqual(out["trades"], [{
            "price": 100.5,
            "qty": 0.25,
            "time": 1700000000000,
            "side": "buy",
            "symbol": "BTCUSDT",
            "source": "binance_rest",
        }])
        self.assertEqual(out["candles"], [{
            "openTime": 1700000000000,
            "closeTime": 1700000059999,
            "open": 1,
            "high": 2,
            "low": 0.5,
            "close": 1.5,
            "volume": 42,
            "priceOnly": True,
            "analyticsSource": "price-only-rest",
            "source": "binance_rest_klines",
        }])

    def test_canonicalizes_hyperliquid_rest_payloads(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(LAYOUT_JS)}, 'utf8');
            const context = {{
              window: {{}},
              console: {{ log() {{}}, warn() {{}} }},
              Date: {{ now: () => 1710000000000 }},
              Object,
              Number,
              Array,
              String,
              parseInt,
              parseFloat,
              setInterval() {{}},
              clearInterval() {{}}
            }};
            context.window.V6OF = {{}};
            vm.runInNewContext(code, context);
            const n = context.window.V6OF.LayoutIngress;
            const out = {{
              symbol: n.normalizeSymbol('BTCUSDT', 'hyperliquid'),
              book: n.normalizeOrderBook({{
                ok: true,
                bids: [{{ px: '100.5', sz: '2' }}],
                asks: [{{ px: '101.25', sz: '3' }}]
              }}, 'hyperliquid'),
              trades: n.normalizeTrades({{
                ok: true,
                trades: [{{ px: '100.5', sz: '0.25', time: 1700000000000, side: 'sell' }}]
              }}, 'hyperliquid', 'BTCUSDT'),
              candles: n.normalizeCandles({{
                ok: true,
                candles: [{{ openTime: 1700000000000, closeTime: 1700000059999, open: '1', high: '2', low: '0.5', close: '1.5', volume: '42' }}]
              }}, 'hyperliquid', '1m')
            }};
            process.stdout.write(JSON.stringify(out));
            """
        )
        out = self._run_node(script)
        self.assertEqual(out["symbol"], "BTC")
        self.assertEqual(out["book"]["bestBid"], 100.5)
        self.assertEqual(out["book"]["bestAsk"], 101.25)
        self.assertEqual(out["trades"], [{
            "price": 100.5,
            "qty": 0.25,
            "time": 1700000000000,
            "side": "sell",
            "symbol": "BTC",
            "source": "hyperliquid_rest",
        }])
        self.assertEqual(out["candles"], [{
            "openTime": 1700000000000,
            "closeTime": 1700000059999,
            "open": 1,
            "high": 2,
            "low": 0.5,
            "close": 1.5,
            "volume": 42,
            "priceOnly": True,
            "analyticsSource": "price-only-rest",
            "source": "hyperliquid_rest_klines",
        }])


if __name__ == "__main__":
    unittest.main()
