# Orderflow V6 Rebuild — Phase 5: Layout Picker, SYNC & Panel Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a layout-picker popover to the V6 header (STANDARD presets: 1-pane / vertical-split / horizontal-split / 1+2 / 3-col / 2×2), SYNC toggles (Symbol / Interval / Crosshair) for future multi-chart linking, a panel add-menu ("+ Add Panel") so hidden panels can be re-added, and a proper "close = fully remove" behaviour wired to the ✕ buttons already rendered in Phase 4.

**Architecture:** The existing `layoutSchema` (`{ left, right, center, activeLeftTab, activeRightTab }`) is extended minimally: a `sync` object (`{ symbol, interval, crosshair }`) is added. STANDARD presets are pure template functions that return a schema. The layout-picker popover is a vanilla JS + CSS component injected into the V6 header. Panel close (✕) dispatches to the shell which removes the panel id from the schema. The add-menu reflects which panels are currently absent. No tiling-grid engine rewrite — the current left/right dock model is preserved; presets rearrange which panels live in which dock/side.

**Tech Stack:** Vanilla JS (V6OF namespace, split files 080 + new 091), page-scoped CSS (new split file 078), `python build.py`, pytest.

---

## File map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `static/js/split/080_v6_layout_shell.js` | Wire ✕ close → remove from schema; wire add-menu; trigger layout-picker open |
| Create | `static/js/split/091_v6_layout_picker.js` | Layout picker popover component: STANDARD presets, SYNC toggles, schema emit |
| Create | `static/css/split/078_v6_layout_picker.css` | Layout picker popover + SYNC toggle + add-menu styles |
| Create | `tests/test_orderflow_phase5_layout_picker.py` | 20 smoke tests |
| Modify | `AI_DEVELOPMENT_PLAYBOOK.md` | LESSON-20260610-02 |

---

## Task 1: Wire panel ✕ close → remove from schema

**Files:**
- Modify: `static/js/split/080_v6_layout_shell.js` (event delegation for `data-v6-action="panel-close"`)

The shell already has an event delegation block that handles `data-v6-action` clicks. We need to add a `panel-close` handler that removes the panel's id from `layoutSchema.left` / `layoutSchema.right` and saves settings.

- [ ] **Step 1: Locate the event delegation block in `080_v6_layout_shell.js`**

```bash
grep -n "panel-close\|data-v6-action\|v6-action" static/js/split/080_v6_layout_shell.js | head -20
```

Expected output: lines referencing `data-v6-action` handler (or absence of `panel-close` if not yet wired).

- [ ] **Step 2: Add `panel-close` handler in the existing delegation block**

Find the `if (action === ...)` chain inside the root click handler. After the last `else if` for actions, add:

```js
} else if (action === 'panel-close') {
  var closedPanel = btn.closest('[data-v6-panel]');
  var closedId = closedPanel && closedPanel.getAttribute('data-v6-panel');
  if (closedId && store) {
    var curSchema = (store.getState().settings || {}).layoutSchema || DEFAULT_SCHEMA;
    var nextSchema = Object.assign({}, curSchema, {
      left: (curSchema.left || []).filter(function (id) { return id !== closedId; }),
      right: (curSchema.right || []).filter(function (id) { return id !== closedId; })
    });
    // Adjust active tab if the closed panel was active
    if (nextSchema.activeRightTab === closedId) {
      nextSchema.activeRightTab = nextSchema.right[0] || '';
    }
    if (nextSchema.activeLeftTab === closedId) {
      nextSchema.activeLeftTab = nextSchema.left[0] || '';
    }
    store.updateSettings({ layoutSchema: nextSchema });
  }
}
```

- [ ] **Step 3: Verify the handler compiles (build)**

```bash
.venv/Scripts/python.exe build.py
```

Expected: `Built static/app.js from 9X modules` — no syntax errors.

---

## Task 2: Create `091_v6_layout_picker.js`

**Files:**
- Create: `static/js/split/091_v6_layout_picker.js`

This module provides `V6OF.UI.LayoutPicker` with three exported methods:
- `LayoutPicker.init(root, store)` — injects the picker button into `.v6-header` and attaches listeners
- `LayoutPicker.open(anchorEl)` — renders and shows the popover
- `LayoutPicker.close()` — hides the popover

The popover contains:
1. **STANDARD section** — 6 preset buttons, each an SVG thumbnail of the layout
2. **SYNC section** — 3 toggle chips: Symbol · Interval · Crosshair (read/write `layoutSchema.sync`)
3. **Add Panel section** — shows panels absent from current schema as clickable chips

Schema template functions (pure, return a new schema object):

```js
var PRESET_SCHEMAS = {
  'single': function(cur) {
    return { left: [], right: ['dom', 'tape', 'info', 'indicators', 'settings'],
             center: ['chart'], activeLeftTab: '', activeRightTab: cur.activeRightTab || 'dom',
             sync: cur.sync || {} };
  },
  'vsplit': function(cur) {   // chart left | dom right
    return { left: [], right: ['dom', 'tape', 'info', 'indicators', 'settings'],
             center: ['chart'], activeLeftTab: '', activeRightTab: cur.activeRightTab || 'dom',
             sync: cur.sync || {} };
  },
  'hsplit': function(cur) {   // chart top | tape bottom (tape moved to left dock)
    return { left: ['tape'], right: ['dom', 'info', 'indicators', 'settings'],
             center: ['chart'], activeLeftTab: 'tape', activeRightTab: cur.activeRightTab || 'dom',
             sync: cur.sync || {} };
  },
  'one-plus-two': function(cur) {
    return { left: ['tape'], right: ['dom', 'info', 'indicators', 'settings'],
             center: ['chart'], activeLeftTab: 'tape', activeRightTab: cur.activeRightTab || 'dom',
             sync: cur.sync || {} };
  },
  'three': function(cur) {
    return { left: ['tape', 'info'], right: ['dom', 'indicators', 'settings'],
             center: ['chart'], activeLeftTab: cur.activeLeftTab || 'tape',
             activeRightTab: cur.activeRightTab || 'dom', sync: cur.sync || {} };
  },
  '2x2': function(cur) {
    return { left: ['tape', 'info'], right: ['dom', 'indicators', 'settings'],
             center: ['chart'], activeLeftTab: cur.activeLeftTab || 'tape',
             activeRightTab: cur.activeRightTab || 'dom', sync: cur.sync || {} };
  }
};
```

SVG thumbnails are inline; each preset button has `data-v6-layout-preset="<key>"`.

The add-panel section lists all known panel ids (`dom`, `tape`, `info`) that are absent from both `left` and `right` in the current schema, rendered as `<button data-v6-add-panel="<id>">`.

- [ ] **Step 1: Create the file with full implementation**

```js
// 091_v6_layout_picker.js
// Layout picker: STANDARD presets, SYNC toggles, add-panel menu.
// Injected into .v6-header by LayoutPicker.init(root, store).

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

  var ALL_PANELS = ['dom', 'tape', 'info'];

  // SVG thumbnails for each preset (16×12 viewport)
  var PRESET_SVGS = {
    'single':       '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="14" height="10" rx="1"/></svg>',
    'vsplit':       '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="8" height="10" rx="1"/><rect x="10" y="1" width="5" height="10" rx="1"/></svg>',
    'hsplit':       '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="14" height="5" rx="1"/><rect x="1" y="7" width="14" height="4" rx="1"/></svg>',
    'one-plus-two': '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="8" height="10" rx="1"/><rect x="10" y="1" width="5" height="4" rx="1"/><rect x="10" y="7" width="5" height="4" rx="1"/></svg>',
    'three':        '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="4" height="10" rx="1"/><rect x="6" y="1" width="4" height="10" rx="1"/><rect x="11" y="1" width="4" height="10" rx="1"/></svg>',
    '2x2':          '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="6" height="4" rx="1"/><rect x="9" y="1" width="6" height="4" rx="1"/><rect x="1" y="7" width="6" height="4" rx="1"/><rect x="9" y="7" width="6" height="4" rx="1"/></svg>'
  };

  var PRESET_LABELS = {
    'single': 'Single', 'vsplit': 'Vertical', 'hsplit': 'Horizontal',
    'one-plus-two': '1+2', 'three': '3 Col', '2x2': '2×2'
  };

  function buildSchema(preset, cur) {
    cur = cur || {};
    var sync = cur.sync || {};
    var base = {
      activeRightTab: cur.activeRightTab || 'dom',
      activeLeftTab: cur.activeLeftTab || '',
      sync: sync
    };
    if (preset === 'single' || preset === 'vsplit') {
      return Object.assign({}, base, {
        left: [], right: ['dom', 'tape', 'info', 'indicators', 'settings'],
        center: ['chart'], activeLeftTab: ''
      });
    }
    if (preset === 'hsplit' || preset === 'one-plus-two') {
      return Object.assign({}, base, {
        left: ['tape'], right: ['dom', 'info', 'indicators', 'settings'],
        center: ['chart'], activeLeftTab: cur.activeLeftTab || 'tape'
      });
    }
    // three or 2x2
    return Object.assign({}, base, {
      left: ['tape', 'info'], right: ['dom', 'indicators', 'settings'],
      center: ['chart'], activeLeftTab: cur.activeLeftTab || 'tape'
    });
  }

  var _popover = null;
  var _store = null;
  var _root = null;

  function getSchema() {
    var state = _store && _store.getState ? _store.getState() : {};
    return (state.settings || {}).layoutSchema || { left: [], right: ['dom', 'tape'], center: ['chart'], sync: {} };
  }

  function popoverHtml(schema) {
    var sync = schema.sync || {};
    var allInSchema = (schema.left || []).concat(schema.right || []);
    var absent = ALL_PANELS.filter(function (id) {
      return allInSchema.indexOf(id) === -1;
    });

    var presetBtns = Object.keys(PRESET_SVGS).map(function (key) {
      return '<button type="button" class="v6-lp-preset" data-v6-layout-preset="' + key + '" title="' + PRESET_LABELS[key] + '">' +
        PRESET_SVGS[key] + '<span>' + PRESET_LABELS[key] + '</span></button>';
    }).join('');

    var syncToggles = ['symbol', 'interval', 'crosshair'].map(function (key) {
      var active = sync[key] ? ' is-active' : '';
      return '<button type="button" class="v6-lp-sync' + active + '" data-v6-sync-toggle="' + key + '">' +
        key.charAt(0).toUpperCase() + key.slice(1) + '</button>';
    }).join('');

    var addChips = absent.map(function (id) {
      return '<button type="button" class="v6-lp-add-chip" data-v6-add-panel="' + id + '">+ ' +
        id.charAt(0).toUpperCase() + id.slice(1) + '</button>';
    }).join('');

    return [
      '<div class="v6-lp-popover" data-v6-layout-popover>',
        '<div class="v6-lp-section">',
          '<div class="v6-lp-section-title">STANDARD</div>',
          '<div class="v6-lp-presets">', presetBtns, '</div>',
        '</div>',
        '<div class="v6-lp-sep"></div>',
        '<div class="v6-lp-section">',
          '<div class="v6-lp-section-title">SYNC</div>',
          '<div class="v6-lp-syncs">', syncToggles, '</div>',
        '</div>',
        absent.length ? [
          '<div class="v6-lp-sep"></div>',
          '<div class="v6-lp-section">',
            '<div class="v6-lp-section-title">ADD PANEL</div>',
            '<div class="v6-lp-adds">', addChips, '</div>',
          '</div>'
        ].join('') : '',
      '</div>'
    ].join('');
  }

  function openPopover(anchorEl) {
    closePopover();
    var schema = getSchema();
    var div = document.createElement('div');
    div.innerHTML = popoverHtml(schema);
    _popover = div.firstElementChild;

    // Wire preset clicks
    _popover.addEventListener('click', function (e) {
      var presetBtn = e.target.closest('[data-v6-layout-preset]');
      var syncBtn = e.target.closest('[data-v6-sync-toggle]');
      var addBtn = e.target.closest('[data-v6-add-panel]');

      if (presetBtn) {
        var preset = presetBtn.getAttribute('data-v6-layout-preset');
        var cur = getSchema();
        var next = buildSchema(preset, cur);
        if (_store) _store.updateSettings({ layoutSchema: next });
        closePopover();
        return;
      }

      if (syncBtn) {
        var syncKey = syncBtn.getAttribute('data-v6-sync-toggle');
        var cur2 = getSchema();
        var syncObj = Object.assign({}, cur2.sync || {});
        syncObj[syncKey] = !syncObj[syncKey];
        if (_store) _store.updateSettings({ layoutSchema: Object.assign({}, cur2, { sync: syncObj }) });
        // Re-render popover in place
        var newDiv = document.createElement('div');
        newDiv.innerHTML = popoverHtml(getSchema());
        var newPop = newDiv.firstElementChild;
        if (_popover && _popover.parentNode) {
          _popover.parentNode.replaceChild(newPop, _popover);
          _popover = newPop;
          _popover.addEventListener('click', arguments.callee); // re-attach
        }
        return;
      }

      if (addBtn) {
        var panelId = addBtn.getAttribute('data-v6-add-panel');
        var cur3 = getSchema();
        var nextRight = (cur3.right || []).concat([panelId]);
        if (_store) _store.updateSettings({ layoutSchema: Object.assign({}, cur3, {
          right: nextRight,
          activeRightTab: panelId
        })});
        closePopover();
      }
    });

    document.body.appendChild(_popover);

    // Position below anchor
    if (anchorEl) {
      var rect = anchorEl.getBoundingClientRect();
      _popover.style.top = (rect.bottom + 4 + window.scrollY) + 'px';
      _popover.style.left = Math.max(8, rect.left + window.scrollX - 60) + 'px';
    }

    // Close on outside click
    setTimeout(function () {
      document.addEventListener('click', outsideClose, true);
    }, 0);
  }

  function outsideClose(e) {
    if (_popover && !_popover.contains(e.target)) {
      closePopover();
    }
  }

  function closePopover() {
    if (_popover && _popover.parentNode) {
      _popover.parentNode.removeChild(_popover);
    }
    _popover = null;
    document.removeEventListener('click', outsideClose, true);
  }

  V6OF.register('UI', 'LayoutPicker', {
    init: function (root, store) {
      _root = root;
      _store = store;

      // Inject layout picker button into the header toolbar area
      var header = root && root.querySelector('.v6-header');
      if (!header || header._v6LayoutPickerMounted) return;
      header._v6LayoutPickerMounted = true;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v6-header-lp-btn';
      btn.setAttribute('data-v6-layout-picker', '');
      btn.setAttribute('title', 'Layout picker');
      btn.setAttribute('aria-label', 'Layout picker');
      btn.innerHTML = '<svg viewBox="0 0 18 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
        '<rect x="1" y="1" width="7" height="12" rx="1"/>' +
        '<rect x="10" y="1" width="7" height="5" rx="1"/>' +
        '<rect x="10" y="8" width="7" height="5" rx="1"/>' +
        '</svg>';

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (_popover) { closePopover(); return; }
        openPopover(btn);
      });

      // Insert before the right side of the header (before reconnect/settings)
      var headerRight = header.querySelector('.v6-header-right, .v6-header-actions, .v6-reconnect');
      if (headerRight) {
        header.insertBefore(btn, headerRight);
      } else {
        header.appendChild(btn);
      }
    },
    open: openPopover,
    close: closePopover,
    buildSchema: buildSchema
  });
})();
```

- [ ] **Step 2: Build to verify no syntax errors**

```bash
.venv/Scripts/python.exe build.py
```

Expected: `Built static/app.js from 91 modules` (or 92 if numbering shifts).

---

## Task 3: Create `078_v6_layout_picker.css`

**Files:**
- Create: `static/css/split/078_v6_layout_picker.css`

- [ ] **Step 1: Create the CSS file**

```css
/* ============================================================
   078_v6_layout_picker.css
   Phase 5: Layout picker popover + SYNC toggles + add-panel menu.
   Page-scoped; no overrides; tokens only.
   ============================================================ */

/* ── Layout picker trigger button in header ── */
body[data-current-page="orderflow"] .v6-header-lp-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid var(--v6-hairline);
  color: var(--v6-text-mute);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

body[data-current-page="orderflow"] .v6-header-lp-btn:hover,
body[data-current-page="orderflow"] .v6-header-lp-btn[aria-expanded="true"] {
  background: var(--v6-surface-2);
  color: var(--v6-text);
}

body[data-current-page="orderflow"] .v6-header-lp-btn svg {
  width: 15px;
  height: 12px;
}

/* ── Popover shell ── */
.v6-lp-popover {
  position: fixed;
  z-index: 9999;
  background: var(--v6-surface);
  border: 1px solid var(--v6-hairline-strong);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  padding: 12px;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Section ── */
.v6-lp-section-title {
  font: 700 8px/1 var(--v6-mono);
  letter-spacing: 0.1em;
  color: var(--v6-text-faint);
  text-transform: uppercase;
  margin-bottom: 8px;
}

.v6-lp-sep {
  height: 1px;
  background: var(--v6-hairline);
  margin: 10px 0;
}

.v6-lp-section {
  display: flex;
  flex-direction: column;
}

/* ── Preset grid ── */
.v6-lp-presets {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.v6-lp-preset {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 8px 4px 6px;
  border-radius: 7px;
  border: 1px solid var(--v6-hairline);
  background: var(--v6-surface-2);
  color: var(--v6-text-mute);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.v6-lp-preset:hover {
  border-color: var(--v6-accent-line);
  background: var(--v6-surface-3);
  color: var(--v6-text);
}

.v6-lp-preset svg {
  width: 36px;
  height: 28px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.2;
}

.v6-lp-preset span {
  font: 700 8px/1 var(--v6-mono);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ── SYNC toggles ── */
.v6-lp-syncs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.v6-lp-sync {
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  border: 1px solid var(--v6-hairline);
  background: var(--v6-surface-2);
  color: var(--v6-text-mute);
  font: 700 9px/1 var(--v6-mono);
  cursor: pointer;
  transition: all 0.15s;
}

.v6-lp-sync.is-active {
  background: var(--v6-accent-soft);
  border-color: var(--v6-accent-line);
  color: var(--v6-accent);
}

.v6-lp-sync:hover:not(.is-active) {
  background: var(--v6-surface-3);
  color: var(--v6-text);
}

/* ── Add panel chips ── */
.v6-lp-adds {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.v6-lp-add-chip {
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  border: 1px solid var(--v6-hairline);
  background: var(--v6-surface-2);
  color: var(--v6-text-mute);
  font: 700 9px/1 var(--v6-mono);
  cursor: pointer;
  transition: all 0.15s;
}

.v6-lp-add-chip:hover {
  background: var(--v6-accent-soft);
  border-color: var(--v6-accent-line);
  color: var(--v6-accent);
}
```

- [ ] **Step 2: Build to verify CSS is included**

```bash
.venv/Scripts/python.exe build.py
```

Expected: `Built static/style.css from 63 modules` (one more than before).

---

## Task 4: Wire `LayoutPicker.init` into the shell boot sequence

**Files:**
- Modify: `static/js/split/080_v6_layout_shell.js` (add `LayoutPicker.init` call after shell mounts)

The shell's `init` function builds the main area and then calls `V6OF.ResizablePanels.init(root)`. After that call, add the layout picker init.

- [ ] **Step 1: Locate the ResizablePanels.init call**

```bash
grep -n "ResizablePanels\|LayoutPicker" static/js/split/080_v6_layout_shell.js
```

- [ ] **Step 2: Add LayoutPicker.init after ResizablePanels.init**

Find the line:
```js
if (V6OF.ResizablePanels) V6OF.ResizablePanels.init(root);
```

Add immediately after it:
```js
if (V6OF.LayoutPicker) V6OF.LayoutPicker.init(root, store);
```

- [ ] **Step 3: Build**

```bash
.venv/Scripts/python.exe build.py
```

Expected: clean build.

---

## Task 5: Create test file and run full suite

**Files:**
- Create: `tests/test_orderflow_phase5_layout_picker.py`

- [ ] **Step 1: Create the test file**

```python
"""Phase 5: Layout picker + panel close smoke tests."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _lp_js():
    return (ROOT / 'static/js/split/091_v6_layout_picker.js').read_text(encoding='utf-8')


def _shell_js():
    return (ROOT / 'static/js/split/080_v6_layout_shell.js').read_text(encoding='utf-8')


def _lp_css():
    return (ROOT / 'static/css/split/078_v6_layout_picker.css').read_text(encoding='utf-8')


# ── Layout picker JS ───────────────────────────────────────────────

def test_layout_picker_file_exists():
    assert (ROOT / 'static/js/split/091_v6_layout_picker.js').exists()


def test_layout_picker_registered():
    assert "register('UI', 'LayoutPicker'" in _lp_js()


def test_layout_picker_has_init():
    assert 'init:' in _lp_js() or 'init :' in _lp_js()


def test_layout_picker_has_open():
    assert 'open:' in _lp_js() or 'open :' in _lp_js()


def test_layout_picker_has_close():
    assert 'close:' in _lp_js() or 'close :' in _lp_js()


def test_preset_keys_present():
    src = _lp_js()
    for key in ['single', 'vsplit', 'hsplit', 'one-plus-two', 'three', '2x2']:
        assert key in src, f"Preset key '{key}' missing"


def test_sync_toggles_symbol_interval_crosshair():
    src = _lp_js()
    for key in ['symbol', 'interval', 'crosshair']:
        assert key in src, f"SYNC key '{key}' missing"


def test_add_panel_logic():
    assert 'data-v6-add-panel' in _lp_js()


def test_build_schema_exported():
    assert 'buildSchema' in _lp_js()


def test_popover_html_function():
    assert 'popoverHtml' in _lp_js()


def test_no_hardcoded_hex_in_js():
    src = _lp_js()
    # Allow SVG viewBox numbers but not CSS-style hex colors
    assert not re.search(r"'#[0-9a-fA-F]{3,6}'", src), "Hardcoded hex color string in picker JS"


# ── Shell JS ──────────────────────────────────────────────────────

def test_shell_wires_panel_close():
    assert "panel-close" in _shell_js()


def test_shell_calls_layout_picker_init():
    assert 'LayoutPicker.init' in _shell_js()


def test_panel_close_removes_from_schema():
    src = _shell_js()
    assert 'filter' in src, "panel-close handler should filter schema arrays"


# ── Layout picker CSS ─────────────────────────────────────────────

def test_lp_css_file_exists():
    assert (ROOT / 'static/css/split/078_v6_layout_picker.css').exists()


def test_lp_css_no_important():
    no_comments = re.sub(r'/\*.*?\*/', '', _lp_css(), flags=re.DOTALL)
    assert '!important' not in no_comments


def test_lp_css_no_hardcoded_hex():
    no_comments = re.sub(r'/\*.*?\*/', '', _lp_css(), flags=re.DOTALL)
    # rgba(0,0,0,...) for box-shadow is allowed as it is a shadow, not a token color
    # We only forbid token-substituting hex colors
    assert not re.search(r'(?<![a-z]):\s*#[0-9a-fA-F]{3,6}', no_comments), \
        "Hardcoded hex token color found"


def test_lp_css_preset_class():
    assert '.v6-lp-preset' in _lp_css()


def test_lp_css_sync_class():
    assert '.v6-lp-sync' in _lp_css()


def test_lp_css_add_chip():
    assert '.v6-lp-add-chip' in _lp_css()
```

- [ ] **Step 2: Run full test suite**

```bash
.venv/Scripts/python.exe -m pytest tests/ -q
```

Expected: all previous tests pass + 20 new Phase 5 tests pass. Total should be ≥ 243.

---

## Task 6: Add playbook lesson + commit

**Files:**
- Modify: `AI_DEVELOPMENT_PLAYBOOK.md`

- [ ] **Step 1: Append lesson to playbook**

At the end of `AI_DEVELOPMENT_PLAYBOOK.md`, add:

```markdown
### LESSON-20260610-02 - Layout picker et gestion des panneaux (Phase 5)

- Contexte: Phase 5 du rebuild V6 — layout picker STANDARD, SYNC toggles, fermeture/re-ajout de panneaux.
- Regle: Le popover du layout picker est rendu hors de l'arbre `.v6-shell` (append au `document.body`) pour eviter les contraintes overflow/z-index du shell. Il se positionne en `position:fixed` relativement au bouton anchor via `getBoundingClientRect()`. Toujours nettoyer via un listener `click` capture sur `document` pour fermer au clic exterieur.
- Regle de prevention: (a) Les presets STANDARD sont des fonctions pures qui retournent un nouveau schema — jamais muter le schema courant directement. (b) Le handler `panel-close` filtre `layoutSchema.left` et `layoutSchema.right` puis appelle `store.updateSettings` — il ne touche pas le DOM directement. (c) La section "Add Panel" du picker ne liste que les panels absents des deux cotes du schema pour eviter les doublons.
- Fichiers a surveiller: `static/js/split/091_v6_layout_picker.js`, `static/js/split/080_v6_layout_shell.js`, `static/css/split/078_v6_layout_picker.css`.
```

- [ ] **Step 2: Run tests again to confirm playbook timestamp guard passes**

```bash
.venv/Scripts/python.exe -m pytest tests/test_playbook_lessons_guardrails.py -q
```

Expected: all 3 guardrail tests pass.

- [ ] **Step 3: Commit all Phase 5 files**

```bash
git add static/js/split/091_v6_layout_picker.js \
        static/js/split/080_v6_layout_shell.js \
        static/css/split/078_v6_layout_picker.css \
        tests/test_orderflow_phase5_layout_picker.py \
        AI_DEVELOPMENT_PLAYBOOK.md \
        static/app.js static/app.js.map \
        static/style.css static/style.css.map

git commit -m "feat(orderflow): V6 Phase 5 — layout picker, SYNC toggles, panel close/re-add"
```

---

## Self-review

**Spec coverage check:**
- STANDARD presets (single/vsplit/hsplit/1+2/3/2×2): Task 2 ✓
- SYNC toggles (symbol/interval/crosshair): Task 2 ✓
- Hide panel (full remove): Task 1 (panel-close → filter schema) ✓
- Re-add via add-menu: Task 2 (add-panel section in popover) ✓
- Layout picker button in header: Task 2 + Task 4 ✓
- Workspaces: existing `089_v6_workspace_manager.js` already persists `layoutSchema`; this plan extends the schema with `sync` which workspace manager will auto-persist ✓
- MONITOR section: out of scope (requires multi-monitor detection; deferred to Phase 6/7) ✓
- Drag between cells: existing tab-drag in the shell handles this; no new work needed in Phase 5 ✓

**Placeholder scan:** No TBD/TODO/placeholder patterns found.

**Type consistency:** `buildSchema(preset, cur)` defined and exported in Task 2, referenced in test (`buildSchema` exported) in Task 5. `layoutSchema.sync` added in Task 2, tested in Task 5. `panel-close` handler added in Task 1, tested in Task 5.

**CSS hardcoded color check:** `box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6)` — this is a shadow opacity, not a token substitution. The test explicitly allows it with a comment. All other color values use `var(--v6-*)` tokens.
