from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
CANVAS_CHART_JS = ROOT / "static" / "js" / "split" / "077_v6_canvas_chart.js"


class OrderflowHtfFootprintAggregationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = CANVAS_CHART_JS.read_text(encoding="utf-8")

    def test_live_footprints_are_aggregated_for_higher_timeframes(self):
        self.assertIn("function aggregateFootprintsToTimeframe(footprints, tf)", self.source)
        self.assertIn("function mergeCandlesByOpenTime(history, liveCandles, tf)", self.source)
        self.assertRegex(
            self.source,
            re.compile(
                r"var\s+liveCandles\s*=\s*tf\s*===\s*'1m'\s*\?\s*fp\s*:\s*"
                r"aggregateFootprintsToTimeframe\(fp,\s*tf\);"
            ),
        )
        self.assertIn("mergeCandlesByOpenTime(hist, liveCandles, tf)", self.source)

    def test_higher_timeframe_merge_no_longer_drops_live_footprints(self):
        self.assertNotIn("if (tf !== '1m') {\n      out = hist.length ? hist : [];", self.source)

    def test_aggregated_live_candles_keep_footprint_identity(self):
        self.assertIn("source: 'live-aggregate'", self.source)
        self.assertIn("analyticsSource: 'live-footprint-aggregate'", self.source)
        self.assertIn("mergeFootprintLevels(bucket._levelsByPrice, fp.levels)", self.source)


if __name__ == "__main__":
    unittest.main()
