import json
import os
import subprocess
import textwrap
import unittest

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOM_LADDER_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "090_v6_dom_ladder.js")
DOM_PANEL_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "075_v6_dom_panel.js")


class OrderflowDomActivityMarkersTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _run_js(self, js_code):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const codeLadder = fs.readFileSync({json.dumps(DOM_LADDER_JS)}, 'utf8');
            const codePanel = fs.readFileSync({json.dumps(DOM_PANEL_JS)}, 'utf8');
            const storage = {{}};
            const context = {{
              window: {{ V6OF: {{}} }},
              document: {{
                createElement(tag) {{
                  return {{
                    classList: {{
                      add() {{}},
                      remove() {{}},
                      toggle(name, val) {{
                        if (val) this.classes[name] = true;
                        else delete this.classes[name];
                      }},
                      classes: {{}}
                    }},
                    style: {{}},
                    setAttribute() {{}},
                    querySelector(sel) {{
                      if (sel === '.v6-dom-body') return this._body;
                      if (sel === '.v6-dom-cols') return this._cols;
                      if (sel === '.v6-dom-grouping') return this._grouping;
                      if (sel === '.v6-dom-value-mode') return this._valmode;
                      if (sel === '[data-dom-stat="source"]') return {{}};
                      if (sel === '[data-dom-stat="age"]') return {{}};
                      if (sel === '[data-dom-stat="live"]') return {{}};
                      if (sel === '[data-dom-stat="mid"]') return {{}};
                      if (sel === '[data-dom-stat="spread"]') return {{}};
                      if (sel === '[data-dom-stat="seq"]') return {{}};
                      if (sel === '[data-dom-stat="gap"]') return {{}};
                      if (sel === '[data-dom-stat="drop"]') return {{}};
                      if (sel === '[data-dom-stat="depth"]') return {{}};
                      if (sel === '[data-dom-activity-above]') return this._above;
                      if (sel === '[data-dom-activity-below]') return this._below;
                      return null;
                    }},
                    querySelectorAll() {{ return []; }},
                    addEventListener() {{}},
                    _body: {{ 
                      style: {{}}, 
                      classList: {{ add() {{}}, remove() {{}} }},
                      querySelector(sel) {{
                        return {{ style: {{}}, classList: {{ add() {{}}, remove() {{}} }} }};
                      }},
                      contains() {{ return true; }}
                    }},
                    _cols: {{}},
                    _grouping: {{}},
                    _valmode: {{}},
                    _above: {{ hidden: true, classList: {{ toggle(name, val) {{ this.visible = val; }} }} }},
                    _below: {{ hidden: true, classList: {{ toggle(name, val) {{ this.visible = val; }} }} }}
                  }};
                }}
              }},
              console: {{ log(){{}}, warn(){{}}, error(){{}} }},
              Date, Math, JSON, Object, Number, Array, String, Map, setTimeout, clearTimeout,
              requestAnimationFrame(cb) {{ return setTimeout(cb, 16); }},
              cancelAnimationFrame(id) {{ clearTimeout(id); }}
            }};
            context.window.V6OF = {{}};
            vm.runInNewContext(codeLadder, context);
            vm.runInNewContext(codePanel, context);
            const DomLadder = context.window.V6OF.DomLadder;
            const DomPanel = context.window.V6OF.DomPanel;
            {js_code}
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_activity_markers_visibility(self):
        js = """
        const document = context.document;
        DomLadder.reset();
        DomLadder.setGrouping(1);
        
        // Window mid = 100, range is VIEW_HALF_RANGE=200 ticks, Comfort zone limits are set on mid.
        // So viewMin is around 100 - 200 = -100, viewMax is around 100 + 200 = 300.
        // Feed 1: all prices are within viewMin and viewMax.
        DomLadder.feedOrderBook({
          symbol: 'BTCUSDT',
          tickSize: 1.0,
          bids: [{ price: 90, size: 1.0 }, { price: 80, size: 1.0 }],
          asks: [{ price: 110, size: 1.0 }, { price: 120, size: 1.0 }],
          bestBid: 90,
          bestAsk: 110,
          spread: 20,
          mid: 100
        });

        const snap1 = DomLadder.snapshot();
        const container = document.createElement('div');
        DomPanel.render(container, snap1, {});
        
        const aboveHidden1 = container._above.hidden;
        const belowHidden1 = container._below.hidden;

        // Feed 2: Add ask above viewMax (e.g. at price 400, since viewMax is around 300)
        DomLadder.feedOrderBook({
          symbol: 'BTCUSDT',
          tickSize: 1.0,
          bids: [{ price: 90, size: 1.0 }],
          asks: [{ price: 110, size: 1.0 }, { price: 2300, size: 1.5 }],
          bestBid: 90,
          bestAsk: 110,
          spread: 20,
          mid: 100
        });

        const snap2 = DomLadder.snapshot();
        container._domLastRowsRender = 0;
        DomPanel.render(container, snap2, {});
        
        const aboveHidden2 = container._above.hidden;
        const belowHidden2 = container._below.hidden;

        // Feed 3: Add bid below viewMin (e.g. at price 1, since viewMin is -100, wait, price cannot be negative,
        // but viewMin was -100. Oh, let's force viewMin to a positive number like 50.
        // Let's reset viewMin/viewMax to test.
        // We can just simulate view limits directly by editing the snapshot!
        const snapMock = DomLadder.snapshot();
        // Force viewMax=150, viewMin=50
        snapMock.viewMax = 150;
        snapMock.viewMin = 50;
        snapMock.dataMax = 200;
        snapMock.dataMin = 90;
        container._domLastRowsRender = 0;
        DomPanel.render(container, snapMock, {});
        const mockAboveHidden = container._above.hidden;
        const mockBelowHidden = container._below.hidden;

        // Force dataMin = 10 (active bid at 10 is below viewMin 50)
        snapMock.dataMin = 10;
        container._domLastRowsRender = 0;
        DomPanel.render(container, snapMock, {});
        const mockAboveHidden2 = container._above.hidden;
        const mockBelowHidden2 = container._below.hidden;

        process.stdout.write(JSON.stringify({
          aboveHidden1,
          belowHidden1,
          aboveHidden2,
          belowHidden2,
          mockAboveHidden,
          mockBelowHidden,
          mockAboveHidden2,
          mockBelowHidden2,
          snap2_viewMax: snap2.viewMax,
          snap2_dataMax: snap2.dataMax,
          snap2_viewMin: snap2.viewMin,
          snap2_dataMin: snap2.dataMin
        }));
        """
        res = self._run_js(js)
        print("DEBUG RES:", res)

        # In snap1, all prices are within limits
        self.assertTrue(res["aboveHidden1"])
        self.assertTrue(res["belowHidden1"])

        # In snap2, ask is at 400 (which is above viewMax ~300)
        self.assertFalse(res["aboveHidden2"])
        self.assertTrue(res["belowHidden2"])

        # In snapMock, dataMax=400 > viewMax=150, dataMin=90 > viewMin=50
        self.assertFalse(res["mockAboveHidden"])
        self.assertTrue(res["mockBelowHidden"])

        # In snapMock2, dataMax=400 > viewMax=150, dataMin=10 < viewMin=50
        self.assertFalse(res["mockAboveHidden2"])
        self.assertFalse(res["mockBelowHidden2"])


if __name__ == "__main__":
    unittest.main()
