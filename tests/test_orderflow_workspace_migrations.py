import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "089_v6_workspace_manager.js")


class OrderflowWorkspaceMigrationTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _run_node(self, script):
        result = subprocess.run(
            ["node", "-e", script],
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_flat_legacy_workspace_storage_is_migrated_to_schema_envelope(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(WORKSPACE_JS)}, 'utf8');
            const storage = {{
              'cockpitV6.workspaces': JSON.stringify({{
                Legacy: {{ chartMode: 'both', showTape: false, activeTab: 'dom' }}
              }}),
              'cockpitV6.activeWorkspace': 'Legacy'
            }};
            const fakeStore = {{
              getState() {{ return {{ settings: {{}} }}; }},
              updateSettings(patch) {{ this.patch = patch; }},
              updateSlice(name, patch) {{ this.slice = {{ name, patch }}; }}
            }};
            const root = {{
              querySelector() {{ return null; }}
            }};
            const context = {{
              window: {{}},
              document: {{ head: {{ appendChild() {{}} }}, createElement() {{ return {{}}; }} }},
              localStorage: {{
                getItem(k) {{ return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; }},
                setItem(k, v) {{ storage[k] = String(v); }},
                removeItem(k) {{ delete storage[k]; }}
              }},
              fetch() {{ return Promise.resolve({{ ok: true, json() {{ return Promise.resolve({{ settings: {{}} }}); }} }}); }},
              Blob: function() {{}},
              URL: {{ createObjectURL() {{ return 'blob:'; }}, revokeObjectURL() {{}} }},
              setTimeout(fn) {{ return 1; }},
              clearTimeout() {{}},
              console: {{ log() {{}}, warn() {{}}, error() {{}} }},
              Object, JSON, Number, String, Array, Date
            }};
            context.window.V6OF = {{
              escapeHtml(v) {{ return String(v); }},
              getStore() {{ return fakeStore; }}
            }};
            context.V6OF = context.window.V6OF;
            vm.runInNewContext(code, context);
            context.window.V6OF.WorkspaceManager.init(root);
            const saved = JSON.parse(storage['cockpitV6.workspaces']);
            process.stdout.write(JSON.stringify({{
              schemaVersion: saved.schemaVersion,
              legacySchemaVersion: saved.list.Legacy.schemaVersion,
              hasDefaultPreset: !!saved.list.Scalping,
              activeWorkspace: fakeStore.slice.patch.activeWorkspace,
              listSchemaVersion: fakeStore.slice.patch.workspaceList.Legacy.schemaVersion
            }}));
            """
        )
        out = self._run_node(script)
        self.assertEqual(out["schemaVersion"], 1)
        self.assertEqual(out["legacySchemaVersion"], 1)
        self.assertTrue(out["hasDefaultPreset"])
        self.assertEqual(out["activeWorkspace"], "Legacy")
        self.assertEqual(out["listSchemaVersion"], 1)


if __name__ == "__main__":
    unittest.main()
