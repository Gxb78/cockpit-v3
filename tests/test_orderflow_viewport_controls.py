from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SHELL_JS = ROOT / "static" / "js" / "split" / "080_v6_layout_shell.js"
INTERACTIONS_JS = ROOT / "static" / "js" / "split" / "084_v6_chart_interactions.js"
VIEWPORT_JS = ROOT / "static" / "js" / "split" / "083_v6_chart_viewport.js"
CANVAS_JS = ROOT / "static" / "js" / "split" / "077_v6_canvas_chart.js"
SHELL_CSS = ROOT / "static" / "css" / "split" / "071_v6_layout_shell.css"


class OrderflowViewportControlsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shell = SHELL_JS.read_text(encoding="utf-8")
        cls.interactions = INTERACTIONS_JS.read_text(encoding="utf-8")
        cls.viewport = VIEWPORT_JS.read_text(encoding="utf-8")
        cls.canvas = CANVAS_JS.read_text(encoding="utf-8")
        cls.css = SHELL_CSS.read_text(encoding="utf-8")

    def test_toolbar_exposes_explicit_viewport_buttons(self):
        for label in ["Follow", "Detach", "Fit", "Reset View"]:
            self.assertIn(label, self.shell)
        for action in ["follow", "detach", "fit", "reset"]:
            self.assertIn("viewTool('" + action + "'", self.shell)

    def test_detach_and_state_sync_are_wired_to_viewport(self):
        self.assertIn("vp.detachLive = function ()", self.viewport)
        self.assertIn("function updateViewportButtons()", self.interactions)
        self.assertIn("data-v6-tool=\"detach\"", self.interactions)
        self.assertIn("vp.detachLive", self.interactions)
        self.assertIn("V6OF.updateViewportToolbarState = updateViewportButtons", self.interactions)
        self.assertIn("V6OF.updateViewportToolbarState()", self.canvas)

    def test_viewport_buttons_have_visible_state_styles(self):
        self.assertIn(".v6-left-toolbar .v6-view-tool", self.css)
        self.assertIn(".v6-view-tool-label", self.css)
        self.assertIn(".v6-view-tool-state", self.css)
        self.assertIn(".v6-left-toolbar .v6-view-tool.is-active .v6-view-tool-state", self.css)


if __name__ == "__main__":
    unittest.main()
