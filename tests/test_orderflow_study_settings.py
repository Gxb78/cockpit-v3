import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "079_v6_orderflow_settings.js")


class OrderflowStudySettingsTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def test_study_settings_validate_snapshot(self):
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
              Date,
              JSON,
              Object,
              Number,
              Array,
              Math
            }};
            context.window.V6OF = {{}};
            vm.runInNewContext(code, context);
            const settings = context.window.V6OF.Settings.validate({{
              showVwap: true,
              showVwapBands: true,
              vwapBand1: 1.5,
              vwapBand2: 0.5,
              alertsEnabled: true,
              largeTradeAlertQty: 25.25,
              deltaAlertThreshold: 250,
              imbalanceRatio: 99,
              imbalanceStack: 9,
              minWickTicks: -2
            }});
            process.stdout.write(JSON.stringify(settings));
            """
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        settings = json.loads(result.stdout)
        self.assertEqual(settings["schemaVersion"], 1)
        self.assertTrue(settings["showVwap"])
        self.assertTrue(settings["showVwapBands"])
        self.assertEqual(settings["vwapBand1"], 1.5)
        self.assertEqual(settings["vwapBand2"], 1.5)
        self.assertTrue(settings["alertsEnabled"])
        self.assertEqual(settings["largeTradeAlertQty"], 25.25)
        self.assertEqual(settings["deltaAlertThreshold"], 250)
        self.assertEqual(settings["imbalanceRatio"], 8)
        self.assertEqual(settings["imbalanceStack"], 6)
        self.assertEqual(settings["minWickTicks"], 0)

    def test_legacy_settings_load_migrates_schema_version(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(SETTINGS_JS)}, 'utf8');
            const storage = {{
              'cockpitV6.orderflow.settings': JSON.stringify({{
                showTape: false,
                imbalanceRatio: 4
              }})
            }};
            const context = {{
              window: {{}},
              console: {{ warn() {{}} }},
              localStorage: {{
                getItem(k) {{ return storage[k] || null; }},
                setItem(k, v) {{ storage[k] = String(v); }},
                removeItem(k) {{ delete storage[k]; }}
              }},
              Date,
              JSON,
              Object,
              Number,
              Array,
              Math
            }};
            context.window.V6OF = {{}};
            vm.runInNewContext(code, context);
            const loaded = context.window.V6OF.Settings.load();
            process.stdout.write(JSON.stringify({{
              loaded,
              persisted: JSON.parse(storage['cockpitV6.orderflow.settings'])
            }}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        out = json.loads(result.stdout)
        self.assertEqual(out["loaded"]["schemaVersion"], 1)
        self.assertEqual(out["persisted"]["schemaVersion"], 1)
        self.assertFalse(out["loaded"]["showTape"])
        self.assertEqual(out["loaded"]["imbalanceRatio"], 4)


if __name__ == "__main__":
    unittest.main()
