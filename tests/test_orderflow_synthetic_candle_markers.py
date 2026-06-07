from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CANVAS_CHART_JS = ROOT / "static" / "js" / "split" / "077_v6_canvas_chart.js"


class OrderflowSyntheticCandleMarkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = CANVAS_CHART_JS.read_text(encoding="utf-8")

    def test_gap_fill_candles_are_marked_as_synthetic_data(self):
        self.assertIn("synthetic: true", self.source)
        self.assertIn("source: 'gap-fill'", self.source)

    def test_synthetic_candles_have_explicit_visual_marker(self):
        self.assertIn("if (c.synthetic) {", self.source)
        self.assertIn("ctx.fillRect(synthX, plot.top, synthW, plot.height)", self.source)
        self.assertIn("ctx.setLineDash([3, 3])", self.source)

    def test_crosshair_tooltip_names_synthetic_gap_fill(self):
        self.assertIn("if (candle.synthetic) {", self.source)
        self.assertIn("Synthetic gap-fill", self.source)
        self.assertIn("(candle.priceOnly || candle.synthetic) ? 174 : 156", self.source)


if __name__ == "__main__":
    unittest.main()
