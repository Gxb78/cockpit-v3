import os
import re
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class OrderflowAutoConnectContractTests(unittest.TestCase):
    def _read(self, rel_path):
        with open(os.path.join(PROJECT_DIR, rel_path), "r", encoding="utf-8") as fh:
            return fh.read()

    def test_active_sources_do_not_claim_manual_only_connection(self):
        active_files = [
            "static/js/split/078_v6_local_engine_client.js",
            "static/js/split/073_v6_orderflow_layout.js",
            "static/js/split/080_v6_layout_shell.js",
            "docs/V6_GO_ENGINE.md",
        ]
        forbidden = re.compile(
            r"manual user action only|No auto-connect|Manually connect|"
            r"manual toggle,\s*no auto-connect|only on manual click|"
            r"Connection to the local Go engine remains manual|"
            r"Manual connection only",
            re.IGNORECASE,
        )
        for rel_path in active_files:
            with self.subTest(rel_path=rel_path):
                self.assertNotRegex(self._read(rel_path), forbidden)

    def test_layout_auto_connects_engine_on_mount(self):
        src = self._read("static/js/split/073_v6_orderflow_layout.js")
        self.assertIn("Initialize and auto-connect the WebSocket engine client on startup", src)
        self.assertRegex(src, r"engineClient\.connect\(\)")
        self.assertIn("'init-connect'", src)

    def test_engine_ws_url_comes_from_frontend_config(self):
        src = self._read("static/js/split/078_v6_local_engine_client.js")
        self.assertIn("window.COCKPIT_CONFIG", src)
        self.assertIn("marketWsUrl", src)
        self.assertIn("resolveMarketUrl", src)
        self.assertNotIn("ws://127.0.0.1:8765/stream", src)

    def test_replay_uses_live_transport_resolver(self):
        for rel_path in [
            "static/js/split/081_v6_orderflow_inspector.js",
            "static/js/split/087_v6_backtest_panel.js",
        ]:
            with self.subTest(rel_path=rel_path):
                src = self._read(rel_path)
                self.assertIn("V6OF.resolveMarketUrl('/replay', 'http')", src)
                self.assertNotIn("http://127.0.0.1:8765/replay", src)

    def test_orderflow_store_is_scoped_by_root(self):
        store_src = self._read("static/js/split/071_v6_orderflow_store.js")
        layout_src = self._read("static/js/split/073_v6_orderflow_layout.js")
        self.assertIn("setRootStore", store_src)
        self.assertIn("getStore", store_src)
        self.assertIn("WeakMap", store_src)
        self.assertIn("V6OF.setRootStore(root, store)", layout_src)
        self.assertNotIn("V6OF.store =", layout_src)

        active_sources = [
            "static/js/split/073_v6_orderflow_layout.js",
            "static/js/split/080_v6_layout_shell.js",
            "static/js/split/081_v6_orderflow_inspector.js",
            "static/js/split/084_v6_chart_interactions.js",
            "static/js/split/087_v6_indicator_runtime.js",
            "static/js/split/088_v6_resizable_panels.js",
            "static/js/split/089_v6_workspace_manager.js",
        ]
        for rel_path in active_sources:
            with self.subTest(rel_path=rel_path):
                self.assertNotIn("V6OF.store", self._read(rel_path))

    def test_orderflow_crosshair_is_scoped_by_root(self):
        store_src = self._read("static/js/split/071_v6_orderflow_store.js")
        layout_src = self._read("static/js/split/073_v6_orderflow_layout.js")
        interactions_src = self._read("static/js/split/084_v6_chart_interactions.js")
        chart_src = self._read("static/js/split/077_v6_canvas_chart.js")
        cvd_src = self._read("static/js/split/086_v6_cvd_panel_canvas.js")

        self.assertIn("getChartCrosshair", store_src)
        self.assertIn("clearChartCrosshair", store_src)
        self.assertIn("WeakMap", store_src)
        self.assertIn("V6OF.clearChartCrosshair(root)", layout_src)
        self.assertIn("ensureCrosshair(canvas)", interactions_src)
        self.assertIn("V6OF.getChartCrosshair(ref)", chart_src)
        self.assertIn("V6OF.getChartCrosshair(canvas)", cvd_src)

        for rel_path in [
            "static/js/split/071_v6_orderflow_store.js",
            "static/js/split/077_v6_canvas_chart.js",
            "static/js/split/084_v6_chart_interactions.js",
            "static/js/split/086_v6_cvd_panel_canvas.js",
        ]:
            with self.subTest(rel_path=rel_path):
                self.assertNotIn("V6OF.chartCrosshair", self._read(rel_path))

    def test_orderflow_uses_domain_registry_and_explicit_page_bootstrap(self):
        contract_src = self._read("static/js/split/070_v6_orderflow_contract.js")
        boot_src = self._read("static/js/split/008_boot.js")
        shell_src = self._read("static/js/split/080_v6_layout_shell.js")
        chart_src = self._read("static/js/split/077_v6_canvas_chart.js")

        for domain in ["Core", "Data", "Transport", "UI", "Studies", "Page"]:
            with self.subTest(domain=domain):
                self.assertIn("'" + domain + "'", contract_src)

        self.assertIn("V6OF.register = function", contract_src)
        self.assertIn("V6OF.registerPage('orderflow'", shell_src)
        self.assertIn('V6OF.Page.bootstrap(pageName)', boot_src)
        self.assertNotIn("bootV6Orderflow", chart_src)
        self.assertNotIn("tryAutoInit", shell_src)


if __name__ == "__main__":
    unittest.main()
