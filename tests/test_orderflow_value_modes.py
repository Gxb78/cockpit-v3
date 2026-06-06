import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "079_v6_orderflow_settings.js")
DOM_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "075_v6_dom_panel.js")


class DomValueModeTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    # ── settings.domValueMode ────────────────────────────────────────────────
    def _validate_mode(self, raw):
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
            const out = context.window.V6OF.Settings.validate({json.dumps(raw)});
            process.stdout.write(JSON.stringify(out.domValueMode));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_default_mode_is_coin(self):
        self.assertEqual(self._validate_mode({}), "coin")

    def test_new_modes_accepted(self):
        for m in ("coin", "notional", "contracts", "ticks"):
            self.assertEqual(self._validate_mode({"domValueMode": m}), m)

    def test_legacy_usd_migrates_to_notional(self):
        self.assertEqual(self._validate_mode({"domValueMode": "usd"}), "notional")

    def test_unknown_mode_falls_back_to_coin(self):
        self.assertEqual(self._validate_mode({"domValueMode": "wat"}), "coin")

    # ── DomPanel.modeValue ───────────────────────────────────────────────────
    def _mode_value(self, coin_qty, mode, live, tick_size, contract_size):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(DOM_JS)}, 'utf8');
            const context = {{
              window: {{ V6OF: {{}} }},
              document: {{ createElement: () => ({{}}) }},
              console: {{ log(){{}}, warn(){{}}, error(){{}} }},
              Date, Math, JSON, Object, Number, Array, String, setTimeout, clearTimeout
            }};
            vm.runInNewContext(code, context);
            const f = context.window.V6OF.DomPanel.modeValue;
            process.stdout.write(JSON.stringify(
              f({coin_qty}, {json.dumps(mode)}, {json.dumps(live)}, {json.dumps(tick_size)}, {json.dumps(contract_size)})
            ));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_coin_mode_is_raw_quantity_without_price(self):
        self.assertEqual(self._mode_value(2.5, "coin", 100000, 1, 1), {"v": 2.5, "price": 0})

    def test_notional_mode_passes_live_price_through(self):
        self.assertEqual(self._mode_value(2.5, "notional", 100000, 1, 1), {"v": 2.5, "price": 100000})

    def test_contracts_mode_divides_by_contract_size(self):
        self.assertEqual(self._mode_value(5, "contracts", 100000, 1, 0.1), {"v": 50, "price": 0})

    def test_contracts_mode_falls_back_when_contract_size_invalid(self):
        self.assertEqual(self._mode_value(5, "contracts", 100000, 1, 0), {"v": 5, "price": 0})

    def test_ticks_mode_is_notional_over_tick_size(self):
        self.assertEqual(self._mode_value(1, "ticks", 100000, 1, 1), {"v": 100000, "price": 0})
        self.assertEqual(self._mode_value(1, "ticks", 100000, 5, 1), {"v": 20000, "price": 0})

    def test_ticks_mode_falls_back_without_price(self):
        self.assertEqual(self._mode_value(3, "ticks", 0, 1, 1), {"v": 3, "price": 0})

    # ── panel wiring guard ───────────────────────────────────────────────────
    def test_panel_uses_dropdown_not_binary_toggle(self):
        with open(DOM_JS, "r", encoding="utf-8") as fh:
            src = fh.read()
        self.assertIn("v6-dom-value-mode", src,
                      "DOM panel does not expose a value-mode dropdown")
        self.assertNotRegex(
            src, r"domValueMode:\s*cur\s*===\s*'usd'\s*\?\s*'coin'\s*:\s*'usd'",
            "DOM panel still uses the binary coin/usd toggle",
        )


if __name__ == "__main__":
    unittest.main()
