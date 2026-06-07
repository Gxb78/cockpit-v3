import os
import re
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class OrderflowSourceFreshnessContractTests(unittest.TestCase):
    def _read(self, rel_path):
        with open(os.path.join(PROJECT_DIR, rel_path), "r", encoding="utf-8") as fh:
            return fh.read()

    def test_rest_candle_fallback_marks_effective_source_as_rest(self):
        src = self._read("static/js/split/078_v6_local_engine_client.js")
        block = re.search(
            r"store\.setState\(function \(prev\) \{(?P<body>.*?)\}, 'rest-candle-fallback-'",
            src,
            re.S,
        )
        self.assertIsNotNone(block)
        body = block.group("body")
        self.assertIn("source: 'rest-fallback'", body)
        self.assertIn("dataFreshness: 'rest-fallback'", body)
        self.assertNotRegex(body, r"source:\s*'live'")
        self.assertNotIn("status === 'connected'", body)

    def test_live_candle_history_restores_live_source_and_freshness(self):
        src = self._read("static/js/split/078_v6_local_engine_client.js")
        block = re.search(r"msg\.type === 'candle_history'.*?store\.setState\(patch, 'candle-history-'", src, re.S)
        self.assertIsNotNone(block)
        body = block.group(0)
        self.assertIn("source: 'live'", body)
        self.assertIn("dataFreshness: 'live'", body)

    def test_rest_fallback_badge_precedes_connected_badge(self):
        src = self._read("static/js/split/073_v6_orderflow_layout.js")
        rest_idx = src.index("V6 REST FALLBACK / Engine connected")
        live_idx = src.index("V6 LIVE / Go Engine")
        self.assertLess(rest_idx, live_idx)
        self.assertIn("REST Fallback (Engine Connected)", src)


if __name__ == "__main__":
    unittest.main()
