from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SHELL_JS = ROOT / "static" / "js" / "split" / "080_v6_layout_shell.js"
INTERACTIONS_JS = ROOT / "static" / "js" / "split" / "084_v6_chart_interactions.js"
SHELL_CSS = ROOT / "static" / "css" / "split" / "071_v6_layout_shell.css"


class OrderflowPriceZoomControlsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shell = SHELL_JS.read_text(encoding="utf-8")
        cls.interactions = INTERACTIONS_JS.read_text(encoding="utf-8")
        cls.css = SHELL_CSS.read_text(encoding="utf-8")

    def test_chart_exposes_visible_price_zoom_controls(self):
        self.assertIn("function priceZoomControlsHtml()", self.shell)
        self.assertIn("data-v6-price-zoom=\"in\"", self.shell)
        self.assertIn("data-v6-price-zoom=\"out\"", self.shell)
        self.assertIn("data-v6-price-zoom=\"auto\"", self.shell)
        self.assertIn("Price +", self.shell)
        self.assertIn("Price -", self.shell)
        self.assertIn("Auto Y", self.shell)

    def test_price_zoom_controls_use_viewport_api(self):
        self.assertIn("event.target.closest('[data-v6-price-zoom]')", self.interactions)
        self.assertIn("current.zoomPrice(0.86, anchorY)", self.interactions)
        self.assertIn("current.zoomPrice(1.16, anchorY)", self.interactions)
        self.assertIn("current.autoFit = true", self.interactions)

    def test_price_zoom_controls_are_visually_positioned(self):
        self.assertIn(".v6-price-zoom-controls", self.css)
        self.assertIn("position: absolute", self.css)
        self.assertIn(".v6-price-zoom-btn", self.css)
        self.assertIn(".v6-price-zoom-btn.is-active", self.css)


if __name__ == "__main__":
    unittest.main()
