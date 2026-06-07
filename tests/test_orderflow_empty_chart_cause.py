from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CANVAS_CHART_JS = ROOT / "static" / "js" / "split" / "077_v6_canvas_chart.js"


class OrderflowEmptyChartCauseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = CANVAS_CHART_JS.read_text(encoding="utf-8")

    def test_empty_chart_replaces_not_available_with_causal_diagnostics(self):
        self.assertNotIn("fillText('Not available'", self.source)
        self.assertIn("function emptyChartCause(state, bounds, haveData)", self.source)
        self.assertIn("var cause = emptyChartCause(state, bounds, haveData)", self.source)

    def test_empty_chart_names_all_required_causes(self):
        for label in [
            "No chart permissions",
            "No market source",
            "No backfill loaded",
            "Market data stale",
            "No data in visible range",
        ]:
            self.assertIn(label, self.source)

    def test_empty_chart_supports_permission_and_stale_state_fields(self):
        self.assertIn("state.permissionDenied === true", self.source)
        self.assertIn("p.marketData === false", self.source)
        self.assertIn("state.isStale || freshness === 'stale'", self.source)


if __name__ == "__main__":
    unittest.main()
