import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIENT_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "078_v6_local_engine_client.js")


class FootprintConfigSeedTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _sent_on_connect(self, settings):
        out = self._run_client_script(settings, "")
        return out["configs"]

    def _run_client_script(self, settings, after_open):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(CLIENT_JS)}, 'utf8');

            const sent = [];
            const subscribers = [];
            function FakeWS(url) {{ this.url = url; FakeWS._last = this; }}
            FakeWS.prototype.send = function (s) {{ sent.push(s); }};
            FakeWS.prototype.close = function () {{}};

            const state = {{
              timeframe: '1m', symbol: 'BTCUSDT', trades: [],
              settings: {json.dumps(settings)}
            }};
            const store = {{
              getState: function () {{ return state; }},
              subscribe: function (fn) {{ subscribers.push(fn); }},
              setState: function () {{}},
              updateSettings: function (patch) {{
                state.settings = Object.assign({{}}, state.settings, patch || {{}});
                subscribers.forEach(function (fn) {{ fn(state); }});
              }},
              clearHeatmap: function () {{}}, clearFootprint: function () {{}}
            }};

            const context = {{
              window: {{ V6OF: {{}} }},
              document: {{ createElement: () => ({{}}), getElementById: () => null,
                          body: {{ getAttribute: () => 'orderflow' }} }},
              console: {{ log(){{}}, warn(){{}}, error(){{}} }},
              WebSocket: FakeWS,
              fetch: function () {{ return Promise.reject(new Error('no network')); }},
              setTimeout: function () {{ return 0; }}, clearTimeout: function () {{}},
              setInterval: function () {{ return 0; }}, clearInterval: function () {{}},
              requestAnimationFrame: function () {{ return 0; }},
              Date, Math, JSON, Object, Number, Array, String, Set, Promise, URLSearchParams
            }};
            vm.runInNewContext(code, context);

            const client = context.window.V6OF.EngineClient.create(store);
            client.connect();
            const ws = FakeWS._last;
            if (!ws || typeof ws.onopen !== 'function') {{ throw new Error('no ws/onopen'); }}
            ws.onopen();
            {after_open}

            const cfg = sent
              .map(function (s) {{ try {{ return JSON.parse(s); }} catch (e) {{ return null; }} }})
              .filter(function (m) {{ return m && m.type === 'footprint_config'; }});
            process.stdout.write(JSON.stringify({{ configs: cfg, sentCount: sent.length, subscriberCount: subscribers.length }}));
            """
        )
        r = subprocess.run(["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_sends_footprint_config_with_ui_thresholds_on_connect(self):
        cfg = self._sent_on_connect({"imbalanceRatio": 5, "imbalanceStack": 4, "imbalanceMinVolume": 2})
        self.assertEqual(len(cfg), 1, "exactly one footprint_config should be sent on connect")
        self.assertEqual(cfg[0]["imbalanceRatio"], 5)
        self.assertEqual(cfg[0]["imbalanceStack"], 4)
        self.assertEqual(cfg[0]["imbalanceMinVolume"], 2)

    def test_defaults_when_settings_absent(self):
        cfg = self._sent_on_connect({})
        self.assertEqual(len(cfg), 1)
        self.assertEqual(cfg[0]["imbalanceRatio"], 3.0)
        self.assertEqual(cfg[0]["imbalanceStack"], 3)
        self.assertEqual(cfg[0]["imbalanceMinVolume"], 1.0)

    def test_sends_updated_config_when_threshold_settings_change(self):
        out = self._run_client_script(
            {"imbalanceRatio": 3, "imbalanceStack": 3, "imbalanceMinVolume": 1},
            """
            store.updateSettings({ imbalanceRatio: 6, imbalanceStack: 5, imbalanceMinVolume: 2.5 });
            store.updateSettings({ imbalanceRatio: 6, imbalanceStack: 5, imbalanceMinVolume: 2.5 });
            """
        )
        cfg = out["configs"]
        self.assertEqual(len(cfg), 2, "connect + one changed config expected")
        self.assertGreaterEqual(out["subscriberCount"], 1)
        self.assertEqual(cfg[1]["imbalanceRatio"], 6)
        self.assertEqual(cfg[1]["imbalanceStack"], 5)
        self.assertEqual(cfg[1]["imbalanceMinVolume"], 2.5)


if __name__ == "__main__":
    unittest.main()
