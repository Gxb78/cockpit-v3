import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

EXPECTED = {
    "--v6-bg": "#0a0b0d",
    "--v6-bg-2": "#0e0f12",
    "--v6-surface": "#15171b",
    "--v6-surface-2": "#1c1f24",
    "--v6-surface-3": "#23262c",
    "--v6-text": "#d7d9de",
    "--v6-text-dim": "#9aa0ab",
    "--v6-text-mute": "#7c818c",
    "--v6-text-faint": "#565b66",
    "--v6-hairline": "rgba(255, 255, 255, 0.06)",
    "--v6-hairline-strong": "rgba(255, 255, 255, 0.12)",
}

def _norm(v):
    return re.sub(r"\s+", "", v.strip().lower()).rstrip(";")

def _pairs_from_js_object(text, start_marker):
    i = text.index(start_marker)
    chunk = text[i:i + 1200]
    out = {}
    for key, val in re.findall(r"'(--v6-[a-z0-9-]+)'\s*:\s*'([^']+)'", chunk):
        out[key] = val
    return out

class TokenSourceOfTruthTests(unittest.TestCase):
    def test_boot_script_matches_canonical(self):
        html = (ROOT / "templates/partials/pages/orderflow.html").read_text(encoding="utf-8")
        got = _pairs_from_js_object(html, "'--v6-bg': '#0a0b0d'")
        for k, v in EXPECTED.items():
            self.assertIn(k, got, f"boot script missing {k}")
            self.assertEqual(_norm(got[k]), _norm(v), f"boot {k}")

    def test_hydrate_matches_canonical(self):
        js = (ROOT / "static/js/split/073_v6_orderflow_layout.js").read_text(encoding="utf-8")
        got = _pairs_from_js_object(js, "'--v6-bg': '#0a0b0d'")
        for k, v in EXPECTED.items():
            self.assertIn(k, got, f"hydrateThemeVars missing {k}")
            self.assertEqual(_norm(got[k]), _norm(v), f"hydrate {k}")

    def test_css_token_block_matches_canonical(self):
        css = (ROOT / "static/css/split/070_v6_orderflow.css").read_text(encoding="utf-8")
        start = css.index(".v6-orderflow-root {")
        block = css[start:start + 2500]
        for k, v in EXPECTED.items():
            m = re.search(re.escape(k) + r"\s*:\s*([^;]+);", block)
            self.assertIsNotNone(m, f"070 token block missing {k}")
            self.assertEqual(_norm(m.group(1)), _norm(v), f"css {k}")

if __name__ == "__main__":
    unittest.main()
