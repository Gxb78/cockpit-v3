from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
VIEWPORT_JS = ROOT / "static" / "js" / "split" / "083_v6_chart_viewport.js"
INTERACTIONS_JS = ROOT / "static" / "js" / "split" / "084_v6_chart_interactions.js"


class OrderflowDoubleClickResetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.viewport = VIEWPORT_JS.read_text(encoding="utf-8")
        cls.interactions = INTERACTIONS_JS.read_text(encoding="utf-8")

    def test_viewport_exposes_separate_fit_methods(self):
        self.assertIn("vp.fitPriceToData = function ()", self.viewport)
        self.assertIn("vp.fitTimeToData = function ()", self.viewport)
        self.assertIn("vp.fitTimeToData();", self.viewport)
        self.assertIn("vp.fitPriceToData();", self.viewport)

    def test_double_click_fits_price_axis_and_time_axis(self):
        self.assertIn("_handleChartDblClick: function (canvas, event)", self.interactions)
        self.assertIn("isOnPriceAxis(pt.x, pt.y, vp)", self.interactions)
        self.assertIn("vp.fitPriceToData()", self.interactions)
        self.assertIn("isOnTimeAxis(pt.x, pt.y, vp)", self.interactions)
        self.assertIn("vp.fitTimeToData()", self.interactions)

    def test_double_click_empty_chart_returns_live_without_breaking_candle_selection(self):
        self.assertIn("setActiveCandleFromEvent(canvas, event, true)", self.interactions)
        self.assertIn("} else if (vp && vp.goLive) {", self.interactions)
        self.assertIn("vp.goLive();", self.interactions)


if __name__ == "__main__":
    unittest.main()
