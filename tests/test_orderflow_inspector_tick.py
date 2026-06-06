import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSPECTOR_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "081_v6_orderflow_inspector.js")
STORE_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "071_v6_orderflow_store.js")
SETTINGS_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "079_v6_orderflow_settings.js")


def _node(script):
    result = subprocess.run(
        ["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace"
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
              Date, Intl, Math, JSON, Object, Number, Array, String, setTimeout, clearTimeout,
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

    def _inspector_async_script(self, body):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const storeCode = fs.readFileSync({json.dumps(STORE_JS)}, 'utf8');
            const code = fs.readFileSync({json.dumps(INSPECTOR_JS)}, 'utf8');
            const root = {{
              dataset: {{ v6Mounted: '1' }},
              _v6Store: null,
              closest(selector) {{ return selector === '[data-v6-mounted="1"]' ? this : null; }},
              querySelector() {{ return null; }}
            }};
            const context = {{
              window: {{ V6OF: {{}} }},
              document: {{ createElement: () => ({{}}), querySelector: () => root }},
              console: {{ log(){{}}, warn(){{}}, error(){{}} }},
              Date, Intl, Math, JSON, Object, Number, Array, String, Promise, URLSearchParams,
              setTimeout, clearTimeout,
              requestAnimationFrame: function(cb){{ return 0; }}
            }};
            context.window.V6OF.Contract = {{
              createEmptyState: () => ({{
                settings: {{}}, ui: {{}}, trades: [], candles: [], chartCandles: [],
                deltaBucketsByInterval: {{}}, latestDeltaByInterval: {{}}, lastOrderBookBySymbol: {{}},
                selectedDomSymbol: 'BTCUSDT', selectedHeatmapSymbol: 'BTCUSDT', selectedFootprintSymbol: 'BTCUSDT',
                vwapBySymbol: {{}}, contractVersion: 'test', source: 'live', dataFreshness: 'offline',
                transportStatus: 'disconnected', symbol: 'BTCUSDT', timeframe: '1m'
              }})
            }};
            vm.runInNewContext(storeCode, context);
            vm.runInNewContext(code, context);
            (async function() {{
              {body}
            }})().catch(function(err) {{
              console.error(err && err.stack || err);
              process.exit(1);
            }});
            """
        )
        r = _node(script)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

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

    def test_imbalance_min_volume_filters_small_diagonal_levels(self):
        candle = {
            "openTime": 1000,
            "closeTime": 60999,
            "intervalMs": 60000,
            "open": 100,
            "high": 102,
            "low": 99,
            "close": 101,
            "volume": 14,
            "delta": 8,
            "buyVol": 11,
            "sellVol": 3,
            "levels": [
                {"price": 100, "buyVol": 0, "sellVol": 2, "totalVol": 2},
                {"price": 101, "buyVol": 10, "sellVol": 0, "totalVol": 10},
            ],
        }
        base_state = {
            "symbol": "BTCUSDT",
            "timeframe": "1m",
            "chartCandles": [candle],
            "ui": {"activeCandleOpenTime": 1000},
            "settings": {"imbalanceRatio": 3, "imbalanceStack": 2},
        }

        html = self._inspector_render(base_state)
        self.assertIn("<em>Buy Imb</em><strong>1</strong>", html)

        filtered = dict(base_state)
        filtered["settings"] = {"imbalanceRatio": 3, "imbalanceStack": 2, "imbalanceMinVolume": 5}
        html = self._inspector_render(filtered)
        self.assertIn("<em>Buy Imb</em><strong>0</strong>", html)

    def test_value_area_percent_changes_va_levels(self):
        candle = {
            "openTime": 1000,
            "closeTime": 60999,
            "intervalMs": 60000,
            "open": 101,
            "high": 102,
            "low": 100,
            "close": 101,
            "volume": 100,
            "delta": 0,
            "buyVol": 50,
            "sellVol": 50,
            "levels": [
                {"price": 100, "buyVol": 8, "sellVol": 8, "totalVol": 16},
                {"price": 101, "buyVol": 35, "sellVol": 35, "totalVol": 70},
                {"price": 102, "buyVol": 7, "sellVol": 7, "totalVol": 14},
            ],
        }
        state = {
            "symbol": "BTCUSDT",
            "timeframe": "1m",
            "chartCandles": [candle],
            "ui": {"activeCandleOpenTime": 1000},
            "settings": {"footprintValueAreaPct": 68},
        }
        html = self._inspector_render(state)
        self.assertEqual(html.count(" is-va"), 1)

        state["settings"] = {"footprintValueAreaPct": 80}
        html = self._inspector_render(state)
        self.assertEqual(html.count(" is-va"), 2)

    def test_level_sum_consistency_flag(self):
        candle = {
            "openTime": 1000,
            "closeTime": 60999,
            "intervalMs": 60000,
            "open": 100,
            "high": 101,
            "low": 99,
            "close": 100,
            "volume": 100,
            "delta": 0,
            "buyVol": 10,
            "sellVol": 10,
            "levels": [{"price": 100, "buyVol": 10, "sellVol": 10, "totalVol": 20}],
        }
        state = {
            "symbol": "BTCUSDT",
            "timeframe": "1m",
            "chartCandles": [candle],
            "ui": {"activeCandleOpenTime": 1000},
            "settings": {},
        }
        html = self._inspector_render(state)
        self.assertIn('v6-inspector-flag is-on">Level sum mismatch</span>', html)

        candle["volume"] = 20
        html = self._inspector_render(state)
        self.assertIn('v6-inspector-flag ">Level sum mismatch</span>', html)

    def test_inspector_timezone_modes_change_header_label(self):
        candle = {
            "openTime": 1700000000000,
            "closeTime": 1700000059999,
            "intervalMs": 60000,
            "open": 100,
            "high": 101,
            "low": 99,
            "close": 100,
            "volume": 1,
            "delta": 0,
            "buyVol": 0.5,
            "sellVol": 0.5,
            "levels": [{"price": 100, "buyVol": 0.5, "sellVol": 0.5, "totalVol": 1}],
        }
        state = {
            "symbol": "BTCUSDT",
            "timeframe": "1m",
            "chartCandles": [candle],
            "ui": {"activeCandleOpenTime": 1700000000000},
            "settings": {},
        }
        html = self._inspector_render(state)
        self.assertIn("UTC</strong>", html)

        state["settings"] = {"inspectorTimeZoneMode": "local"}
        html = self._inspector_render(state)
        self.assertIn("Local</strong>", html)

        state["settings"] = {"inspectorTimeZoneMode": "exchange"}
        state["exchangeTimeZone"] = "America/New_York"
        html = self._inspector_render(state)
        self.assertIn("Exchange</strong>", html)

    def test_aggtrades_footprint_fetch_splits_capped_page(self):
        out = self._inspector_async_script(
            """
            const V6OF = context.window.V6OF;
            const urls = [];
            let call = 0;
            function makeTrades(count, startId, startTime) {
              const rows = [];
              for (let i = 0; i < count; i++) {
                rows.push({ id: startId + i, time: startTime + i, price: 100 + (i % 3), qty: 1, side: i % 2 ? 'sell' : 'buy' });
              }
              return rows;
            }
            context.fetch = function(url) {
              urls.push(url);
              call += 1;
              const trades = call === 1 ? makeTrades(8000, 1, 1000) : makeTrades(2, call * 10000, 1000 + call);
              return Promise.resolve({ ok: true, json: () => Promise.resolve({ trades }) });
            };
            const state = {
              symbol: 'BTCUSDT',
              timeframe: '1m',
              chartCandles: [{
                openTime: 1000, closeTime: 60999, intervalMs: 60000,
                open: 100, high: 102, low: 99, close: 101, volume: 10, delta: 0
              }],
              footprintCandles: [],
              ui: { activeCandleOpenTime: 1000, activeCandleLocked: true },
              settings: { tickSize: 1 }
            };
            const store = {
              state,
              getState() { return this.state; },
              setState(patchOrFn) {
                const patch = typeof patchOrFn === 'function' ? patchOrFn(this.state) : patchOrFn;
                this.state = Object.assign({}, this.state, patch || {});
              }
            };
            V6OF.setRootStore(root, store);
            V6OF.Inspector.render(state);
            await new Promise(resolve => setTimeout(resolve, 50));
            process.stdout.write(JSON.stringify({
              calls: urls.length,
              hasSplitStart: urls.some(u => u.indexOf('startTime=1000') !== -1 && u.indexOf('endTime=30999') !== -1),
              hasSplitEnd: urls.some(u => u.indexOf('startTime=31000') !== -1 && u.indexOf('endTime=60999') !== -1),
              footprintTrades: store.state.footprintCandles[0] && store.state.footprintCandles[0].levels.reduce((sum, l) => sum + l.trades, 0)
            }));
            """
        )
        self.assertGreater(out["calls"], 1)
        self.assertTrue(out["hasSplitStart"])
        self.assertTrue(out["hasSplitEnd"])
        self.assertEqual(out["footprintTrades"], 4)

    def test_rebuild_prefers_pinned_candle_timeframe(self):
        out = self._inspector_async_script(
            """
            const V6OF = context.window.V6OF;
            const urls = [];
            context.fetch = function(url) {
              urls.push(url);
              return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ trades: [
                  { id: 1, time: 1000, price: 100, qty: 1, side: 'buy' },
                  { id: 2, time: 299999, price: 101, qty: 1, side: 'sell' }
                ] })
              });
            };
            const state = {
              symbol: 'BTCUSDT',
              timeframe: '1m',
              chartCandles: [{
                openTime: 1000, timeframe: '5m',
                open: 100, high: 102, low: 99, close: 101, volume: 10, delta: 0
              }],
              footprintCandles: [],
              ui: { activeCandleOpenTime: 1000, activeCandleLocked: true },
              settings: { tickSize: 1 }
            };
            const store = {
              state,
              getState() { return this.state; },
              setState(patchOrFn) {
                const patch = typeof patchOrFn === 'function' ? patchOrFn(this.state) : patchOrFn;
                this.state = Object.assign({}, this.state, patch || {});
              }
            };
            V6OF.setRootStore(root, store);
            V6OF.Inspector.render(state);
            await new Promise(resolve => setTimeout(resolve, 30));
            const fp = store.state.footprintCandles[0] || {};
            process.stdout.write(JSON.stringify({
              url: urls[0] || '',
              timeframe: fp.timeframe,
              intervalMs: fp.intervalMs,
              closeTime: fp.closeTime,
              selectedTf: store.state.selectedFootprintTimeframe
            }));
            """
        )
        self.assertIn("endTime=300999", out["url"])
        self.assertEqual(out["timeframe"], "5m")
        self.assertEqual(out["intervalMs"], 300000)
        self.assertEqual(out["closeTime"], 300999)
        self.assertEqual(out["selectedTf"], "5m")

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
