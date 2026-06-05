import json
import os
import re
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HELPERS_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "072_v6_orderflow_helpers.js")
TAPE_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "074_v6_tape_panel.js")
LAYOUT_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "073_v6_orderflow_layout.js")


# Minimal DOM shim sufficient for VirtualList + renderTapeInto. innerHTML is
# parsed into a flat list of element stubs queryable by class / data-attribute;
# nesting fidelity is irrelevant for the operations these renderers perform.
DOM_SHIM = r"""
function camel(s){ return s.replace(/-([a-z0-9])/g, function(_, c){ return c.toUpperCase(); }); }
function parseChildren(html){
  var els = [], re = /<([a-zA-Z]+)((?:[^>"]|"[^"]*")*)>/g, m;
  while ((m = re.exec(html))) {
    if (m[1].toLowerCase() === 'span' && /<\/span>/.test(html.slice(m.index, m.index + 4))) {}
    var el = new El(), attrs = m[2] || '';
    var cls = /class="([^"]*)"/.exec(attrs);
    if (cls) cls[1].split(/\s+/).forEach(function(c){ if (c) el.classList.add(c); });
    var dre = /data-([a-zA-Z0-9-]+)(?:="([^"]*)")?/g, dm;
    while ((dm = dre.exec(attrs))) { el.dataset[camel(dm[1])] = dm[2] == null ? '' : dm[2]; }
    els.push(el);
  }
  return els;
}
function matches(el, sel){
  if (sel[0] === '.') return sel.slice(1).split('.').every(function(c){ return el.classList.has(c); });
  var dm = /^\[data-([a-zA-Z0-9-]+)\]$/.exec(sel);
  if (dm) return camel(dm[1]) in el.dataset;
  return false;
}
function El(){
  this.children = [];
  this.classList = new Set();
  this.dataset = {};
  this.style = {};
  this._html = '';
  this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0;
  this._listeners = {};
}
El.prototype.addEventListener = function(t, fn){ (this._listeners[t] = this._listeners[t] || []).push(fn); };
El.prototype._descendants = function(){
  var out = [];
  this.children.forEach(function(c){ out.push(c); out = out.concat(c._descendants()); });
  return out;
};
El.prototype.contains = function(node){ return this._descendants().indexOf(node) !== -1; };
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function(){ return this._html; },
  set: function(html){ this._html = html; this.children = parseChildren(html); }
});
El.prototype.querySelector = function(sel){
  var d = this._descendants();
  for (var i = 0; i < d.length; i++) if (matches(d[i], sel)) return d[i];
  return null;
};
El.prototype.querySelectorAll = function(sel){ return this._descendants().filter(function(e){ return matches(e, sel); }); };
"""


def _node_context():
    return r"""
const fs = require('fs');
const vm = require('vm');
%(shim)s
const context = {
  window: {},
  document: { hidden: false },
  requestAnimationFrame: function(cb){ cb(); return 1; },
  setTimeout: function(cb){ cb(); return 1; },
  Date: Date, Math: Math, JSON: JSON, Object: Object,
  Number: Number, Array: Array, String: String,
  console: { log(){}, warn(){}, error(){} },
  performance: { now: function(){ return 0; } }
};
context.El = El;
// Stub formatting helpers the tape row renderer depends on.
context.window.V6OF = {
  escapeHtml: function(s){ return String(s == null ? '' : s); },
  format: { time: String, price: String, qty: String }
};
function load(path){ vm.runInNewContext(fs.readFileSync(path, 'utf8'), context); }
""" % {"shim": DOM_SHIM}


class TapeIncrementalRenderTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _run_node(self, body):
        script = _node_context() + body
        result = subprocess.run(
            ["node", "-e", script],
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_render_tape_into_is_incremental_and_preserves_scroll(self):
        body = textwrap.dedent(
            f"""
            load({json.dumps(HELPERS_JS)});
            load({json.dumps(TAPE_JS)});
            const V6OF = context.window.V6OF;

            function makeTrades(seed, n) {{
              const out = [];
              for (let i = 0; i < n; i++) {{
                out.push({{ price: 100 + i, qty: 1, side: i % 2 ? 'buy' : 'sell',
                            time: seed + i, exchange: 'BIN', symbol: 'BTCUSDT' }});
              }}
              return out;
            }}

            const container = new El();
            const settings = {{ maxRows: 500, tapeFontSize: 12, minQty: 0 }};

            // First render builds the stable shell + virtual body.
            V6OF.Panels.renderTapeInto(container, makeTrades(1000, 100), settings);
            const shell1 = container._v6TapeShell;
            const body1 = shell1 && shell1.body;
            const vshell1 = body1 && body1._v6VirtualShell;

            // Simulate a sized, user-scrolled viewport.
            body1.clientHeight = 200;   // ~9 rows tall at rowHeight 22
            body1.scrollTop = 300;      // scrolled away from the top

            // Second render with a fresh trades array (reference changes every tick).
            V6OF.Panels.renderTapeInto(container, makeTrades(2000, 100), settings);
            const shell2 = container._v6TapeShell;
            const vshell2 = body1._v6VirtualShell;

            const winHtml = vshell2.win.innerHTML;
            const renderedRows = (winHtml.match(/v6-tape-row/g) || []).length;

            process.stdout.write(JSON.stringify({{
              shellStable: shell1 === shell2,
              virtualShellStable: vshell1 === vshell2,
              scrollPreserved: body1.scrollTop,
              renderedRows: renderedRows,
              totalRows: 100
            }}));
            """
        )
        out = self._run_node(body)
        # Shell object is reused across updates (no full teardown / rebuild).
        self.assertTrue(out["shellStable"], "tape shell rebuilt on update")
        self.assertTrue(out["virtualShellStable"], "virtual shell rebuilt on update")
        # Scroll position survives the update (no innerHTML reset of the host).
        self.assertEqual(out["scrollPreserved"], 300)
        # Virtualization: only a bounded window is in the DOM, not all 100 rows.
        self.assertGreater(out["renderedRows"], 0)
        self.assertLess(out["renderedRows"], out["totalRows"])
        self.assertLessEqual(out["renderedRows"], 40)

    def test_layout_wires_tape_through_incremental_renderer(self):
        with open(LAYOUT_JS, "r", encoding="utf-8") as fh:
            src = fh.read()
        # The layout must drive the tape through the incremental/virtualized
        # path, not a full innerHTML rebuild of the tape list.
        self.assertIn("renderTapeInto", src,
                      "layout does not use the incremental tape renderer")
        self.assertNotRegex(
            src,
            r"tapeList\.innerHTML\s*=\s*V6OF\.Panels\.renderTape\b",
            "layout still rebuilds the tape via full innerHTML",
        )


if __name__ == "__main__":
    unittest.main()
