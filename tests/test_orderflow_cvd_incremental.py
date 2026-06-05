import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CVD_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "076_v6_cvd_panel.js")
LAYOUT_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "073_v6_orderflow_layout.js")


# Minimal DOM shim: innerHTML parsed into a flat list of element stubs queryable
# by class, tag, and data-attribute (with optional value).
DOM_SHIM = r"""
function camel(s){ return s.replace(/-([a-z0-9])/g, function(_, c){ return c.toUpperCase(); }); }
function El(){
  this.tag = '';
  this.children = [];
  this.classList = new Set();
  this.dataset = {};
  this.style = {};
  this._html = '';
  this.value = '';
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
Object.defineProperty(El.prototype, 'textContent', {
  get: function(){ return this._text || ''; },
  set: function(v){ this._text = String(v); }
});
Object.defineProperty(El.prototype, 'className', {
  get: function(){ return Array.from(this.classList).join(' '); },
  set: function(v){ this.classList = new Set(String(v).split(/\s+/).filter(Boolean)); }
});
El.prototype.querySelector = function(sel){
  var d = this._descendants();
  for (var i = 0; i < d.length; i++) if (matches(d[i], sel)) return d[i];
  return null;
};
function parseChildren(html){
  var els = [], re = /<([a-zA-Z]+)((?:[^>"]|"[^"]*")*)>/g, m;
  while ((m = re.exec(html))) {
    var el = new El();
    el.tag = m[1].toLowerCase();
    var attrs = m[2] || '';
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
  var m = /^([a-zA-Z]+)?\[data-([a-zA-Z0-9-]+)(?:="([^"]*)")?\]$/.exec(sel);
  if (m) {
    if (m[1] && el.tag !== m[1].toLowerCase()) return false;
    var key = camel(m[2]);
    if (!(key in el.dataset)) return false;
    if (m[3] != null && el.dataset[key] !== m[3]) return false;
    return true;
  }
  return false;
}
"""


class CvdIncrementalRenderTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def test_render_cvd_into_keeps_stable_shell_and_patches_values(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            {DOM_SHIM}
            const context = {{
              window: {{}},
              document: {{ activeElement: null }},
              Date, Math, JSON, Object, Number, Array, String,
              console: {{ log(){{}}, warn(){{}}, error(){{}} }}
            }};
            context.El = El;
            context.window.V6OF = {{ format: {{ price: String, qty: String, signed: String }} }};
            vm.runInNewContext(fs.readFileSync({json.dumps(CVD_JS)}, 'utf8'), context);
            const V6OF = context.window.V6OF;

            function stateWith(delta, cvd) {{
              const buckets = [];
              for (let i = 0; i < 5; i++) buckets.push({{ delta: delta + i, cvd: cvd + i, ts: 1000 + i }});
              return {{
                settings: {{ deltaIntervalMs: 60000 }},
                deltaBuckets: buckets,
                deltaBucketsByInterval: {{ '60000': buckets }},
                latestDeltaByInterval: {{ '60000': {{ delta: delta, cvd: cvd }} }}
              }};
            }}

            const container = new El();
            V6OF.Panels.renderCvdInto(container, stateWith(120, 4000));
            const shell1 = container._v6CvdShell;
            const select1 = shell1.select;
            const deltaText1 = shell1.delta.textContent;

            // Second render: values change, shell + select element must persist.
            V6OF.Panels.renderCvdInto(container, stateWith(-80, 4200));
            const shell2 = container._v6CvdShell;

            process.stdout.write(JSON.stringify({{
              shellStable: shell1 === shell2,
              selectStable: select1 === shell2.select,
              selectValue: shell2.select.value,
              deltaUpdated: shell2.delta.textContent !== deltaText1,
              deltaNegClass: shell2.delta.className.indexOf('is-neg') !== -1
            }}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=PROJECT_DIR, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        out = json.loads(result.stdout)
        self.assertTrue(out["shellStable"], "CVD shell rebuilt on update")
        self.assertTrue(out["selectStable"], "interval <select> rebuilt on update")
        self.assertEqual(out["selectValue"], "60000")
        self.assertTrue(out["deltaUpdated"], "delta badge text not patched")
        self.assertTrue(out["deltaNegClass"], "delta badge class not patched for negative delta")

    def test_layout_wires_cvd_through_incremental_renderer(self):
        with open(LAYOUT_JS, "r", encoding="utf-8") as fh:
            src = fh.read()
        self.assertIn("renderCvdInto", src,
                      "layout does not use the incremental CVD renderer")
        self.assertNotRegex(
            src, r"cvd\.innerHTML\s*=\s*V6OF\.Panels\.renderCvd\b",
            "layout still rebuilds the CVD panel via full innerHTML",
        )


if __name__ == "__main__":
    unittest.main()
