import json
import os
import subprocess
import textwrap
import unittest

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "079_v6_orderflow_settings.js")
HELPERS_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "072_v6_orderflow_helpers.js")


class OrderflowWallPercentilesTests(unittest.TestCase):
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
            const codeSettings = fs.readFileSync({json.dumps(SETTINGS_JS)}, 'utf8');
            const codeHelpers = fs.readFileSync({json.dumps(HELPERS_JS)}, 'utf8');
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
            vm.runInNewContext(codeSettings, context);
            vm.runInNewContext(codeHelpers, context);
            {js_code}
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_default_wall_percentiles_are_present(self):
        js = """
        const out = context.window.V6OF.Settings.validate({});
        process.stdout.write(JSON.stringify({
          soft: out.domSoftWallPercentile,
          major: out.domMajorWallPercentile
        }));
        """
        res = self._run_js(js)
        self.assertEqual(res["soft"], 0.85)
        self.assertEqual(res["major"], 0.95)

    def test_validation_clamps_soft_wall_percentile(self):
        js = """
        const outUnder = context.window.V6OF.Settings.validate({ domSoftWallPercentile: 0.1 });
        const outOver = context.window.V6OF.Settings.validate({ domSoftWallPercentile: 0.999 });
        const outValid = context.window.V6OF.Settings.validate({ domSoftWallPercentile: 0.75 });
        process.stdout.write(JSON.stringify({
          under: outUnder.domSoftWallPercentile,
          over: outOver.domSoftWallPercentile,
          valid: outValid.domSoftWallPercentile
        }));
        """
        res = self._run_js(js)
        self.assertEqual(res["under"], 0.5)
        self.assertEqual(res["over"], 0.99)
        self.assertEqual(res["valid"], 0.75)

    def test_validation_clamps_major_wall_percentile(self):
        js = """
        const outUnderSoft = context.window.V6OF.Settings.validate({ domSoftWallPercentile: 0.80, domMajorWallPercentile: 0.75 });
        const outOverMax = context.window.V6OF.Settings.validate({ domSoftWallPercentile: 0.80, domMajorWallPercentile: 0.9999 });
        const outValid = context.window.V6OF.Settings.validate({ domSoftWallPercentile: 0.80, domMajorWallPercentile: 0.90 });
        process.stdout.write(JSON.stringify({
          underSoft: outUnderSoft.domMajorWallPercentile,
          overMax: outOverMax.domMajorWallPercentile,
          valid: outValid.domMajorWallPercentile
        }));
        """
        res = self._run_js(js)
        self.assertEqual(res["underSoft"], 0.80)  # clamped to soft percentile
        self.assertEqual(res["overMax"], 0.999)    # clamped to 0.999 max
        self.assertEqual(res["valid"], 0.90)

    def test_resolve_settings_handles_wall_percentiles(self):
        js = """
        const resolved = context.window.V6OF.resolveSettings({
          domSoftWallPercentile: 0.75,
          domMajorWallPercentile: 0.92
        });
        process.stdout.write(JSON.stringify({
          soft: resolved.domSoftWallPercentile,
          major: resolved.domMajorWallPercentile
        }));
        """
        res = self._run_js(js)
        self.assertEqual(res["soft"], 0.75)
        self.assertEqual(res["major"], 0.92)


if __name__ == "__main__":
    unittest.main()
