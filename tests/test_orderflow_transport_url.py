import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIENT_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "078_v6_local_engine_client.js")


class TransportUrlResolutionTests(unittest.TestCase):
    """resolveMarketUrl must take its HTTP origin from a first-class transport
    config (COCKPIT_CONFIG.marketHttpUrl), not by mangling the WebSocket URL."""

    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _resolve(self, cockpit_config, path, transport):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(CLIENT_JS)}, 'utf8');
            const context = {{
              window: {{
                V6OF: {{}},
                COCKPIT_CONFIG: {json.dumps(cockpit_config)},
                location: {{ href: 'http://app.local:5001/', protocol: 'http:', hostname: 'app.local' }}
              }},
              document: {{ createElement: () => ({{}}), getElementById: () => null,
                          body: {{ getAttribute: () => 'orderflow' }} }},
              console: {{ log(){{}}, warn(){{}}, error(){{}} }},
              WebSocket: function () {{}},
              fetch: function () {{ return Promise.reject(new Error('no network')); }},
              setTimeout: () => 0, clearTimeout: () => {{}},
              setInterval: () => 0, clearInterval: () => {{}},
              requestAnimationFrame: () => 0,
              URL, Date, Math, JSON, Object, Number, Array, String, Set, Promise, URLSearchParams
            }};
            vm.runInNewContext(code, context);
            const V6OF = context.window.V6OF;
            process.stdout.write(JSON.stringify({{
              url: V6OF.resolveMarketUrl({json.dumps(path)}, {json.dumps(transport)}),
              httpOrigin: V6OF.Transport.marketHttpUrl()
            }}));
            """
        )
        r = subprocess.run(["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_http_uses_configured_market_http_url(self):
        out = self._resolve(
            {"marketWsUrl": "ws://engine.local:9999/stream",
             "marketHttpUrl": "https://api.engine.local:8443"},
            "/api/v1/footprint/1m", "http",
        )
        # HTTP origin comes from marketHttpUrl, NOT from the ws://engine.local:9999 URL.
        self.assertEqual(out["url"], "https://api.engine.local:8443/api/v1/footprint/1m")
        self.assertEqual(out["httpOrigin"], "https://api.engine.local:8443")

    def test_http_falls_back_to_ws_derivation_when_unset(self):
        out = self._resolve(
            {"marketWsUrl": "ws://engine.local:9999/stream"},
            "/replay", "http",
        )
        self.assertEqual(out["url"], "http://engine.local:9999/replay")

    def test_ws_transport_keeps_ws_origin(self):
        out = self._resolve(
            {"marketWsUrl": "ws://engine.local:9999/stream",
             "marketHttpUrl": "https://api.engine.local:8443"},
            "/something", "ws",
        )
        self.assertEqual(out["url"], "ws://engine.local:9999/something")


if __name__ == "__main__":
    unittest.main()
