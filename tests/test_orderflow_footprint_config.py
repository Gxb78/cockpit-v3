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
            const statePatches = [];
            const store = {{
              getState: function () {{ return state; }},
              subscribe: function (fn) {{ subscribers.push(fn); }},
              setState: function (patch, reason) {{
                if (typeof patch === 'function') patch = patch(state) || {{}};
                Object.assign(state, patch || {{}});
                statePatches.push({{ reason: reason || '', patch: patch || {{}} }});
              }},
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
            process.stdout.write(JSON.stringify({{
              configs: cfg,
              sentCount: sent.length,
              subscriberCount: subscribers.length,
              state: state,
              statePatches: statePatches
            }}));
            """
        )
        r = subprocess.run(["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_sends_footprint_config_with_ui_thresholds_on_connect(self):
        cfg = self._sent_on_connect(
            {"imbalanceRatio": 5, "imbalanceStack": 4, "imbalanceMinVolume": 2, "exhaustionFactor": 0.5}
        )
        self.assertEqual(len(cfg), 1, "exactly one footprint_config should be sent on connect")
        self.assertEqual(cfg[0]["imbalanceRatio"], 5)
        self.assertEqual(cfg[0]["imbalanceStack"], 4)
        self.assertEqual(cfg[0]["imbalanceMinVolume"], 2)
        self.assertEqual(cfg[0]["exhaustionFactor"], 0.5)

    def test_defaults_when_settings_absent(self):
        cfg = self._sent_on_connect({})
        self.assertEqual(len(cfg), 1)
        self.assertEqual(cfg[0]["imbalanceRatio"], 3.0)
        self.assertEqual(cfg[0]["imbalanceStack"], 3)
        self.assertEqual(cfg[0]["imbalanceMinVolume"], 1.0)
        self.assertEqual(cfg[0]["exhaustionFactor"], 0.35)

    def test_marks_engine_config_synced_after_successful_send(self):
        out = self._run_client_script(
            {"imbalanceRatio": 5, "imbalanceStack": 4, "imbalanceMinVolume": 2, "exhaustionFactor": 0.5},
            ""
        )
        self.assertEqual(out["state"]["engineConfigStatus"], "synced")
        self.assertGreater(out["state"]["engineConfigSyncedAt"], 0)

    def test_marks_engine_config_stale_when_settings_change_offline(self):
        out = self._run_client_script(
            {"imbalanceRatio": 3, "imbalanceStack": 3, "imbalanceMinVolume": 1, "exhaustionFactor": 0.35},
            """
            client.disconnect();
            store.updateSettings({ imbalanceRatio: 4 });
            """
        )
        self.assertEqual(out["state"]["engineConfigStatus"], "stale")
        self.assertGreater(out["state"]["engineConfigStaleAt"], 0)

    def test_marks_engine_config_failed_when_send_throws(self):
        out = self._run_client_script(
            {"imbalanceRatio": 3, "imbalanceStack": 3, "imbalanceMinVolume": 1, "exhaustionFactor": 0.35},
            """
            ws.send = function () { throw new Error('boom'); };
            store.updateSettings({ imbalanceRatio: 4 });
            """
        )
        self.assertEqual(out["state"]["engineConfigStatus"], "failed")
        self.assertIn("boom", out["state"]["engineConfigError"])

    def test_sends_updated_config_when_threshold_settings_change(self):
        out = self._run_client_script(
            {"imbalanceRatio": 3, "imbalanceStack": 3, "imbalanceMinVolume": 1, "exhaustionFactor": 0.35},
            """
            store.updateSettings({ imbalanceRatio: 6, imbalanceStack: 5, imbalanceMinVolume: 2.5, exhaustionFactor: 0.6 });
            store.updateSettings({ imbalanceRatio: 6, imbalanceStack: 5, imbalanceMinVolume: 2.5, exhaustionFactor: 0.6 });
            """
        )
        cfg = out["configs"]
        self.assertEqual(len(cfg), 2, "connect + one changed config expected")
        self.assertGreaterEqual(out["subscriberCount"], 1)
        self.assertEqual(cfg[1]["imbalanceRatio"], 6)
        self.assertEqual(cfg[1]["imbalanceStack"], 5)
        self.assertEqual(cfg[1]["imbalanceMinVolume"], 2.5)
        self.assertEqual(cfg[1]["exhaustionFactor"], 0.6)

    def test_exhaustion_factor_change_alone_resends_config(self):
        out = self._run_client_script(
            {"imbalanceRatio": 3, "imbalanceStack": 3, "imbalanceMinVolume": 1, "exhaustionFactor": 0.35},
            """
            store.updateSettings({ exhaustionFactor: 0.2 });
            """
        )
        cfg = out["configs"]
        self.assertEqual(len(cfg), 2, "connect + exhaustionFactor-only change expected")
        self.assertEqual(cfg[1]["exhaustionFactor"], 0.2)


if __name__ == "__main__":
    unittest.main()
