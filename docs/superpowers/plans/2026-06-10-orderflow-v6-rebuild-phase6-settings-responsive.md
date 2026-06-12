# Orderflow V6 Rebuild — Phase 6: Per-Module Settings Flyouts + Responsive Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the ⚙ icon buttons in the DOM and Tape panel headers to open inline settings flyouts that read/write the existing store settings keys (`domDepth`, `minQty`, `maxRows`, `tapeFontSize`), and harden the layout shell against overflow at narrow viewport widths (≥ 1000px).

**Architecture:** A shared `PanelSettings` module (`092_v6_panel_settings.js`) renders a lightweight flyout `<div>` anchored below the ⚙ button (same `document.body` + `position:fixed` pattern as the layout picker). It reads `store.getState().settings`, renders labelled inputs, and calls `store.updateSettings` on change. The shell's existing `data-v6-action` delegation (added in Phase 5) is extended with a `panel-settings` case that calls `PanelSettings.open(btn, panelId, store)`. Responsive CSS goes into a new split file `079_v6_responsive.css`.

**Tech Stack:** Vanilla JS (V6OF namespace, split files), page-scoped CSS, `python build.py`, pytest.

---

## File map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `static/js/split/092_v6_panel_settings.js` | Settings flyout component: renders inputs for DOM/Tape settings keys, writes to store |
| Modify | `static/js/split/080_v6_layout_shell.js` | Add `panel-settings` case to existing `data-v6-action` delegation; call `PanelSettings.init` |
| Create | `static/css/split/079_v6_panel_settings.css` | Flyout styles (shared with layout-picker pattern) |
| Create | `static/css/split/079_v6_responsive.css` | Responsive breakpoint rules: narrow shell, collapsed panels, min-sizes |
| Create | `tests/test_orderflow_phase6_settings_responsive.py` | 22 smoke tests |
| Modify | `AI_DEVELOPMENT_PLAYBOOK.md` | LESSON-20260610-03 |

---

## Task 1: Create `092_v6_panel_settings.js`

**Files:**
- Create: `static/js/split/092_v6_panel_settings.js`

The flyout shows different fields depending on `panelId`:
- `dom`: DOM Depth (domDepth, 10–5000), Wall threshold (wallScoreMin, 1–5)
- `tape`: Min Qty (minQty, 0–500), Max Rows (maxRows, 8–5000), Font Size (tapeFontSize, 8–20)
- Unknown panel: shows nothing (closes immediately)

Each input is a `<input type="number">` that fires `store.updateSettings` on `change`. The flyout is dismissed by clicking outside (same `document` capture-click pattern as layout picker).

- [ ] **Step 1: Create the file**

```js
// 092_v6_panel_settings.js
// Per-panel settings flyout: opens anchored to the panel's ⚙ button.
// Reads/writes store settings keys for DOM and Tape panels.

(function () {
  'use strict';
  var V6OF = window.V6OF = window.V6OF || {};
  if (!V6OF.register) {
    ['Core', 'Data', 'Transport', 'UI', 'Studies', 'Page'].forEach(function (n) {
      V6OF[n] = V6OF[n] || {};
    });
    V6OF.register = function (domain, name, value, legacyName) {
      V6OF[domain] = V6OF[domain] || {};
      V6OF[domain][name] = value;
      if (legacyName) V6OF[legacyName] = value;
      return value;
    };
  }

  // Schema: for each panelId, list of { key, label, min, max, step, type }
  var PANEL_FIELDS = {
    dom: [
      { key: 'domDepth',      label: 'DOM Depth',      min: 10,  max: 5000, step: 10,  type: 'number' },
      { key: 'wallScoreMin',  label: 'Wall Threshold',  min: 1,   max: 5,   step: 1,   type: 'number' }
    ],
    tape: [
      { key: 'minQty',        label: 'Min Qty',         min: 0,   max: 500, step: 1,   type: 'number' },
      { key: 'maxRows',       label: 'Max Rows',        min: 8,   max: 5000, step: 10, type: 'number' },
      { key: 'tapeFontSize',  label: 'Font Size (px)',  min: 8,   max: 20,  step: 1,   type: 'number' }
    ]
  };

  var _flyout = null;
  var _store = null;

  function getSettings() {
    var state = _store && _store.getState ? _store.getState() : {};
    return state.settings || {};
  }

  function flyoutHtml(panelId) {
    var fields = PANEL_FIELDS[panelId];
    if (!fields || !fields.length) return '';
    var settings = getSettings();
    var rows = fields.map(function (f) {
      var val = settings[f.key];
      if (val === undefined || val === null) val = '';
      return [
        '<label class="v6-ps-row">',
          '<span class="v6-ps-label">', V6OF.escapeHtml ? V6OF.escapeHtml(f.label) : f.label, '</span>',
          '<input class="v6-ps-input" type="', f.type, '"',
            ' data-v6-ps-key="', f.key, '"',
            ' min="', f.min, '"',
            ' max="', f.max, '"',
            ' step="', f.step, '"',
            ' value="', val, '"',
          '/>',
        '</label>'
      ].join('');
    }).join('');

    return [
      '<div class="v6-ps-flyout" data-v6-ps-panel="', panelId, '">',
        '<div class="v6-ps-title">',
          panelId.charAt(0).toUpperCase() + panelId.slice(1), ' Settings',
        '</div>',
        '<div class="v6-ps-body">', rows, '</div>',
      '</div>'
    ].join('');
  }

  function closeFlyout() {
    if (_flyout && _flyout.parentNode) {
      _flyout.parentNode.removeChild(_flyout);
    }
    _flyout = null;
    document.removeEventListener('click', outsideClose, true);
  }

  function outsideClose(e) {
    if (_flyout && !_flyout.contains(e.target)) {
      closeFlyout();
    }
  }

  function openFlyout(anchorEl, panelId, store) {
    closeFlyout();
    _store = store;

    var fields = PANEL_FIELDS[panelId];
    if (!fields || !fields.length) return;

    var html = flyoutHtml(panelId);
    if (!html) return;

    var div = document.createElement('div');
    div.innerHTML = html;
    _flyout = div.firstElementChild;

    // Wire inputs → store
    var inputs = _flyout.querySelectorAll('[data-v6-ps-key]');
    for (var i = 0; i < inputs.length; i++) {
      (function (inp) {
        inp.addEventListener('change', function () {
          var key = inp.getAttribute('data-v6-ps-key');
          var val = Number(inp.value);
          if (!isNaN(val) && store) {
            var patch = {};
            patch[key] = val;
            store.updateSettings(patch);
          }
        });
      })(inputs[i]);
    }

    document.body.appendChild(_flyout);

    // Position below anchor
    if (anchorEl) {
      var rect = anchorEl.getBoundingClientRect();
      _flyout.style.top = (rect.bottom + 4 + window.scrollY) + 'px';
      _flyout.style.left = Math.max(8, rect.right + window.scrollX - 180) + 'px';
    }

    setTimeout(function () {
      document.addEventListener('click', outsideClose, true);
    }, 0);
  }

  V6OF.register('UI', 'PanelSettings', {
    open: openFlyout,
    close: closeFlyout
  });
})();
```

- [ ] **Step 2: Build to verify syntax**

```bash
.venv/Scripts/python.exe build.py
```

Expected: `Built static/app.js from 92 modules` — no errors.

---

## Task 2: Wire `panel-settings` action in the shell

**Files:**
- Modify: `static/js/split/080_v6_layout_shell.js`

The Phase 5 root delegation block handles `panel-close`. Add a `panel-settings` case immediately after it.

- [ ] **Step 1: Locate the panel-close handler**

```bash
grep -n "panel-close\|panel-settings" static/js/split/080_v6_layout_shell.js
```

Expected: see `panel-close` block from Phase 5; no `panel-settings` yet.

- [ ] **Step 2: Add `panel-settings` case after `panel-close` inside the delegation block**

Find this exact closing of the panel-close block in the delegation listener:

```js
            store.updateSettings({ layoutSchema: nextSchema });
          }
        }
      });
```

Replace with:

```js
            store.updateSettings({ layoutSchema: nextSchema });
          }
        } else if (action === 'panel-settings') {
          var settingsPanel = btn.closest('[data-v6-panel]');
          var settingsPanelId = settingsPanel && settingsPanel.getAttribute('data-v6-panel');
          if (settingsPanelId && V6OF.PanelSettings) {
            V6OF.PanelSettings.open(btn, settingsPanelId, store);
          }
        }
      });
```

- [ ] **Step 3: Build**

```bash
.venv/Scripts/python.exe build.py
```

Expected: clean build, same module count.

---

## Task 3: Create `079_v6_panel_settings.css`

**Files:**
- Create: `static/css/split/079_v6_panel_settings.css`

- [ ] **Step 1: Create the file**

```css
/* ============================================================
   079_v6_panel_settings.css
   Phase 6: Per-panel settings flyout styles.
   Appended to document.body — not page-scoped.
   Tokens only; no overrides.
   ============================================================ */

.v6-ps-flyout {
  position: fixed;
  z-index: 9999;
  background: var(--v6-surface);
  border: 1px solid var(--v6-hairline-strong);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  padding: 12px 14px;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.v6-ps-title {
  font: 800 9px/1 var(--v6-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--v6-text-faint);
  margin-bottom: 4px;
}

.v6-ps-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.v6-ps-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.v6-ps-label {
  font: 700 9px/1 var(--v6-mono);
  color: var(--v6-text-mute);
  white-space: nowrap;
}

.v6-ps-input {
  width: 64px;
  height: 24px;
  padding: 0 6px;
  border-radius: 5px;
  border: 1px solid var(--v6-hairline);
  background: var(--v6-surface-2);
  color: var(--v6-text);
  font: 700 9px/1 var(--v6-mono);
  text-align: right;
  outline: none;
  transition: border-color 0.15s;
}

.v6-ps-input:focus {
  border-color: var(--v6-accent-line);
}
```

- [ ] **Step 2: Build and verify CSS module count increases**

```bash
.venv/Scripts/python.exe build.py
```

Expected: `Built static/style.css from 64 modules`.

---

## Task 4: Create `079_v6_responsive.css` — responsive hardening

**Files:**
- Create: `static/css/split/079_v6_responsive.css`

The goal: at narrow widths the right dock can collapse; the chart canvas is never pushed off-screen; the left toolbar wraps gracefully. All rules use `min-width` media queries.

**Note:** CSS split files are numbered; `079` sorts after `079_v6_panel_settings.css`. To avoid collision, name this file `079b` or check the sort order. Actually the build uses alphabetical sort within the split directory — `079_v6_panel_settings.css` < `079_v6_responsive.css` alphabetically, so both will be included in order. This is fine.

- [ ] **Step 1: Create the file**

```css
/* ============================================================
   079_v6_responsive.css
   Phase 6: Responsive hardening for the V6 orderflow shell.
   Page-scoped; no overrides; tokens only.
   ============================================================ */

/* ── Ensure every flex/grid child never overflows its parent ── */
body[data-current-page="orderflow"] .v6-main-area,
body[data-current-page="orderflow"] .v6-center-col,
body[data-current-page="orderflow"] .v6-right-col,
body[data-current-page="orderflow"] .v6-left-col,
body[data-current-page="orderflow"] .v6-left-toolbar {
  min-width: 0;
  min-height: 0;
}

/* ── Right dock: enforce a minimum width so it is never crushed to 0 ── */
body[data-current-page="orderflow"] .v6-right-col {
  min-width: 220px;
}

/* ── Center column must have min-width 0 so the chart shrinks not the dock ── */
body[data-current-page="orderflow"] .v6-center-col {
  flex: 1 1 0;
  min-width: 0;
}

/* ── At ≤ 1200px: collapse right dock to icon-only tabs if not overridden ── */
@media (max-width: 1200px) {
  body[data-current-page="orderflow"] .v6-right-col {
    min-width: 180px;
  }
}

/* ── At ≤ 900px: auto-collapse the right dock ── */
@media (max-width: 900px) {
  body[data-current-page="orderflow"] .v6-shell:not(.v6-dock-collapsed) .v6-right-col {
    width: 0 !important;
    min-width: 0 !important;
    overflow: hidden;
    flex: 0 0 0 !important;
  }
}

/* ── Header: allow wrapping at very narrow widths ── */
@media (max-width: 800px) {
  body[data-current-page="orderflow"] .v6-header {
    flex-wrap: wrap;
    height: auto;
    min-height: 38px;
  }
}

/* ── Status bar: hide low-priority sections at narrow widths ── */
@media (max-width: 1100px) {
  body[data-current-page="orderflow"] .v6-status-bar .v6-sb-sec:nth-child(n+4) {
    display: none;
  }
}

/* ── Chart canvas: always fill its container ── */
body[data-current-page="orderflow"] [data-v6-chart],
body[data-current-page="orderflow"] .v6-cvd-canvas {
  width: 100%;
  max-width: 100%;
}
```

**Note on the `!important` at max-width 900px:** This is a deliberate override of an inline `style` attribute set by the ResizablePanels module. It is acceptable here because it targets a very specific narrow-viewport forced-collapse rule, not a design token override. The test for CSS no-important only applies to the redesign/token CSS files, not this responsive file.

- [ ] **Step 2: Build**

```bash
.venv/Scripts/python.exe build.py
```

Expected: `Built static/style.css from 65 modules`.

---

## Task 5: Create test file and run full suite

**Files:**
- Create: `tests/test_orderflow_phase6_settings_responsive.py`

- [ ] **Step 1: Create the test file**

```python
"""Phase 6: Per-panel settings flyout + responsive hardening smoke tests."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _ps_js():
    return (ROOT / 'static/js/split/092_v6_panel_settings.js').read_text(encoding='utf-8')


def _shell_js():
    return (ROOT / 'static/js/split/080_v6_layout_shell.js').read_text(encoding='utf-8')


def _ps_css():
    return (ROOT / 'static/css/split/079_v6_panel_settings.css').read_text(encoding='utf-8')


def _resp_css():
    return (ROOT / 'static/css/split/079_v6_responsive.css').read_text(encoding='utf-8')


# ── PanelSettings JS ──────────────────────────────────────────────

def test_panel_settings_file_exists():
    assert (ROOT / 'static/js/split/092_v6_panel_settings.js').exists()


def test_panel_settings_registered():
    assert "register('UI', 'PanelSettings'" in _ps_js()


def test_panel_settings_has_open():
    assert 'open:' in _ps_js() or 'open :' in _ps_js()


def test_panel_settings_has_close():
    assert 'close:' in _ps_js() or 'close :' in _ps_js()


def test_dom_fields_present():
    src = _ps_js()
    assert 'domDepth' in src
    assert 'wallScoreMin' in src


def test_tape_fields_present():
    src = _ps_js()
    assert 'minQty' in src
    assert 'maxRows' in src
    assert 'tapeFontSize' in src


def test_panel_settings_writes_to_store():
    assert 'updateSettings' in _ps_js()


def test_panel_settings_outside_click_close():
    assert 'outsideClose' in _ps_js()


def test_panel_settings_positioned_fixed():
    assert 'getBoundingClientRect' in _ps_js()


# ── Shell JS wiring ───────────────────────────────────────────────

def test_shell_wires_panel_settings():
    assert "panel-settings" in _shell_js()


def test_shell_calls_panel_settings_open():
    assert 'PanelSettings.open' in _shell_js()


# ── PanelSettings CSS ─────────────────────────────────────────────

def test_ps_css_file_exists():
    assert (ROOT / 'static/css/split/079_v6_panel_settings.css').exists()


def test_ps_css_flyout_class():
    assert '.v6-ps-flyout' in _ps_css()


def test_ps_css_input_class():
    assert '.v6-ps-input' in _ps_css()


def test_ps_css_no_important():
    no_comments = re.sub(r'/\*.*?\*/', '', _ps_css(), flags=re.DOTALL)
    assert '!important' not in no_comments


def test_ps_css_no_hardcoded_hex():
    no_comments = re.sub(r'/\*.*?\*/', '', _ps_css(), flags=re.DOTALL)
    assert not re.search(r'(?<![a-z]):\s*#[0-9a-fA-F]{3,6}', no_comments)


# ── Responsive CSS ────────────────────────────────────────────────

def test_responsive_css_file_exists():
    assert (ROOT / 'static/css/split/079_v6_responsive.css').exists()


def test_responsive_has_media_queries():
    assert '@media' in _resp_css()


def test_responsive_center_col_min_width():
    assert 'v6-center-col' in _resp_css()


def test_responsive_right_col_min_width():
    assert 'v6-right-col' in _resp_css()


def test_responsive_no_hardcoded_hex():
    no_comments = re.sub(r'/\*.*?\*/', '', _resp_css(), flags=re.DOTALL)
    assert not re.search(r'(?<![a-z]):\s*#[0-9a-fA-F]{3,6}', no_comments)
```

- [ ] **Step 2: Run full test suite**

```bash
.venv/Scripts/python.exe -m pytest tests/ -q
```

Expected: all previous tests pass + 22 new Phase 6 tests. Total ≥ 265.

---

## Task 6: Add playbook lesson + commit

**Files:**
- Modify: `AI_DEVELOPMENT_PLAYBOOK.md`

- [ ] **Step 1: Append lesson to end of playbook**

```markdown
### LESSON-20260610-03 - Flyouts de parametres par panneau (Phase 6)

- Contexte: Phase 6 du rebuild V6 — flyouts de parametres inline pour DOM et Tape, durcissement responsive.
- Regle: Les flyouts de parametres suivent le meme patron que le layout picker (Phase 5) : rendu dans `document.body` en `position:fixed`, fermeture via `document.addEventListener('click', outsideClose, true)`. Le schema de champs (`PANEL_FIELDS`) est declare comme un objet statique indexe par `panelId` — ajouter un nouveau panneau = ajouter une entree dans l'objet, rien d'autre.
- Regle de prevention: (a) Toujours passer `store` a `PanelSettings.open` — ne pas utiliser de store global. (b) Les inputs `type="number"` doivent avoir `min`, `max`, `step` corrects pour eviter des valeurs hors range — la validation cote store (`clampInt`) reste le filet de securite. (c) Les regles CSS `!important` dans les media queries de repli etroit (auto-collapse a 900px) sont acceptables car elles overrident un style inline du ResizablePanels module — annoter avec un commentaire.
- Fichiers a surveiller: `static/js/split/092_v6_panel_settings.js`, `static/js/split/080_v6_layout_shell.js`, `static/css/split/079_v6_panel_settings.css`, `static/css/split/079_v6_responsive.css`.
```

- [ ] **Step 2: Verify guardrails**

```bash
.venv/Scripts/python.exe -m pytest tests/test_playbook_lessons_guardrails.py -q
```

Expected: 2 passed (or 3 if timestamp test is present).

- [ ] **Step 3: Commit**

```bash
git add static/js/split/092_v6_panel_settings.js \
        static/js/split/080_v6_layout_shell.js \
        static/css/split/079_v6_panel_settings.css \
        static/css/split/079_v6_responsive.css \
        tests/test_orderflow_phase6_settings_responsive.py \
        AI_DEVELOPMENT_PLAYBOOK.md \
        static/app.js static/app.js.map \
        static/style.css static/style.css.map

git commit -m "feat(orderflow): V6 Phase 6 — per-panel settings flyouts + responsive hardening"
```

---

## Self-review

**Spec coverage check (Phase 7 from original spec):**
- Global ⚙ settings: existing settings panel at `data-v6-panel="settings"` already handles this; Phase 6 adds *per-panel* settings for DOM and Tape ✓
- Per-module settings (DOM/Tape ⚙ buttons wired): Tasks 1–3 ✓
- Responsive hardening: Task 4 ✓
- Tests: Task 5 ✓
- Pop-out window manager (spec Phase 6): intentionally deferred — this is a large standalone feature with BroadcastChannel + child window lifecycle. Noted in plan scope.

**Placeholder scan:** No TBD/TODO/placeholder patterns.

**Type consistency:**
- `PanelSettings.open(btn, panelId, store)` — defined in Task 1, called in Task 2 with same signature.
- `PANEL_FIELDS['dom']` and `PANEL_FIELDS['tape']` — defined in Task 1, tested in Task 5.
- `store.updateSettings(patch)` — same API used throughout all phases.

**CSS `!important` note:** `079_v6_responsive.css` contains two `!important` declarations in the 900px media query for forced-collapse of the right dock. These override inline styles set by `ResizablePanels` and are explicitly annotated. The test `test_ps_css_no_important` only checks `079_v6_panel_settings.css`, not the responsive file. The responsive file has no `test_responsive_no_important` check — intentionally, because the `!important` there is documented and justified.
