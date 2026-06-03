// 080_v6_layout_shell.js
// Phase 16 + 17: TradingView-like shell host for the V6 orderflow surface.
//
// NON-DESTRUCTIVE: instead of rebuilding root.innerHTML (which destroyed the
// Layout panels), this re-homes the existing Layout panels into TradingView
// regions by MOVING their nodes. The nodes stay inside #v6-orderflow-root, so
// Layout.render()'s querySelectors keep resolving and every panel keeps working.
//
// Structure produced (header + engine-bar from Layout are kept as the top bar):
//   .v6-shell
//     .v6-header        (kept — symbol/badge/metrics + Connect Local Engine)
//     .v6-engine-bar    (kept — status + counters + pause)
//     .v6-main-area     (NEW — replaces .v6-grid)
//       .v6-left-toolbar   Cursor / Crosshair / Fit / Reset / Follow live
//       .v6-center-and-panels
//         .v6-center-chart  <- chart panel (canvas)
//         .v6-bottom-panel  <- CVD + VWAP panels
//       .v6-right-panels    <- Tape + DOM + Settings panels

(function () {
  'use strict';
  var V6OF = window.V6OF = window.V6OF || {};

  // Crisp inline SVG line icons (stroke = currentColor).
  var ICONS = {
    cursor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l6 16 2.5-6.5L20 10z"/></svg>',
    crosshair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    follow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l7 5-7 5z"/><path d="M14 7l7 5-7 5z"/></svg>',
    horiz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="3" y1="12" x2="21" y2="12"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>',
    trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="6" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="6" r="2" fill="currentColor"/><line x1="7.5" y1="16.5" x2="16.5" y2="7.5"/></svg>',
    rect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="1"/></svg>'
  };

  function tool(name, title) {
    return '<button type="button" class="v6-tool" data-v6-tool="' + name + '" title="' + title +
      '" aria-label="' + title + '">' + ICONS[name] + '</button>';
  }

  // ── Declarative layout schema (single source of truth) ──
  // Reordering panels = edit these arrays. The right-dock tab buttons are
  // generated in `right.tabs` order, and panels are re-homed into their region
  // by matching `data-v6-panel="<id>"` (id === the `.v6-panel-<id>` CSS class,
  // so the existing `show-<id>` visibility rules keep working untouched).
  //   center : Layout panel ids stacked in the center column (chart slot).
  //   right  : tabbed right dock. Each tab { id, label, icon?, glyph? }.
  var DEFAULT_SCHEMA = {
    center: ['chart'],
    right: {
      tabs: [
        { id: 'dom', label: 'DOM' },
        { id: 'tape', label: 'Tape' },
        { id: 'settings', label: 'Settings', icon: true, glyph: '⚙' }
      ],
      'default': 'dom'
    }
  };
  V6OF.LayoutSchema = V6OF.LayoutSchema || DEFAULT_SCHEMA;

  function rtabHtml(spec, isDefault) {
    var sel = isDefault ? 'true' : 'false';
    var activeCls = isDefault ? ' is-active' : '';
    var iconCls = spec.icon ? ' v6-rtab-icon' : '';
    var extra = spec.icon ? ' title="' + spec.label + '" aria-label="' + spec.label + '"' : '';
    var content = spec.icon ? (spec.glyph || spec.label) : spec.label;
    return '<button type="button" class="v6-rtab' + iconCls + activeCls + '" id="v6-tab-' + spec.id +
      '" role="tab" aria-selected="' + sel + '" aria-controls="v6-panel-' + spec.id +
      '" data-v6-rtab="' + spec.id + '"' + extra + '>' + content + '</button>';
  }

  // Generate the tablist from the schema. Text tabs render first, then the dock
  // collapse toggle (fixed control), then icon tabs — preserving the original
  // DOM / Tape / [collapse] / Settings arrangement for the default schema.
  function rtabsHtml(schema) {
    var def = schema.right['default'];
    var parts = ['<div class="v6-rtabs" data-v6-rtabs role="tablist" aria-label="Orderflow tabs">'];
    schema.right.tabs.forEach(function (t) { if (!t.icon) parts.push(rtabHtml(t, t.id === def)); });
    parts.push('<button type="button" class="v6-rtab v6-rtab-icon" data-v6-dock-toggle title="Collapse dock" aria-label="Collapse dock">&#10094;</button>');
    schema.right.tabs.forEach(function (t) { if (t.icon) parts.push(rtabHtml(t, t.id === def)); });
    parts.push('</div>');
    return parts.join('');
  }

  function leftToolbarHtml() {
    return [
      '<div class="v6-left-toolbar">',
        tool('cursor', 'Cursor'),
        tool('crosshair', 'Crosshair'),
        '<div class="v6-tool-sep"></div>',
        tool('fit', 'Fit view'),
        tool('reset', 'Reset view'),
        tool('follow', 'Follow live'),
        /* Hiding drawing placeholders until implementation
        '<div class="v6-tool-sep"></div>',
        tool('horiz', 'Horizontal Line (Drawing Placeholder)'),
        tool('trend', 'Trendline (Drawing Placeholder)'),
        tool('rect', 'Rectangle (Drawing Placeholder)'),
        */
      '</div>'
    ].join('');
  }

  function mainAreaHtml(schema) {
    return [
      '<div class="v6-main-area">',
        leftToolbarHtml(),
        '<div class="v6-center-col">',
          '<div class="v6-center-chart" data-v6-center-chart></div>',
          '<div class="v6-resize-v" title="Drag to resize indicator height"></div>',
          '<div class="v6-cvd-strip" data-v6-cvd-strip>',
            '<div class="v6-cvd-strip-head">',
              '<span class="v6-cvd-strip-title">CVD · Delta</span>',
              '<button type="button" class="v6-cvd-collapse" data-v6-cvd-collapse aria-label="Toggle CVD" title="Collapse CVD">▾</button>',
            '</div>',
            '<canvas class="v6-cvd-canvas" data-v6-cvd-canvas></canvas>',
          '</div>',
        '</div>',
        '<div class="v6-resize-h" title="Drag to resize right dock width"></div>',
        '<div class="v6-right-col" data-v6-right-col>',
          rtabsHtml(schema),
          '<div class="v6-rbody show-' + schema.right['default'] + '" data-v6-rbody>',
            // Custom info panel inside right dock
            '<section class="v6-panel v6-panel-info" data-v6-panel="info" aria-label="V6 Info">',
              '<div class="v6-panel-head"><span>Info</span><small>Market metrics</small></div>',
              '<div class="v6-panel-body v6-info-body">',
                '<div class="v6-info-grid">',
                  '<div class="v6-info-card"><em>Best Bid</em><strong data-v6-info-bid>--</strong></div>',
                  '<div class="v6-info-card"><em>Best Ask</em><strong data-v6-info-ask>--</strong></div>',
                  '<div class="v6-info-card"><em>Spread</em><strong data-v6-info-spread>--</strong></div>',
                  '<div class="v6-info-card"><em>Mid Price</em><strong data-v6-info-mid>--</strong></div>',
                  '<div class="v6-info-card"><em>Session CVD</em><strong data-v6-info-cvd>--</strong></div>',
                  '<div class="v6-info-card"><em>Last Price</em><strong data-v6-info-last>--</strong></div>',
                '</div>',
              '</div>',
            '</section>',
          '</div>',
        '</div>',
      '</div>',
      '<footer class="v6-status-bar">',
        '<div class="v6-sb-sec">',
          '<span class="v6-sb-lbl">Engine:</span>',
          '<span class="v6-sb-val" data-v6-status-url>ws://127.0.0.1:8765/stream</span>',
        '</div>',
        '<div class="v6-sb-sec">',
          '<span class="v6-sb-lbl">Reconnects:</span>',
          '<span class="v6-sb-val" data-v6-status-reconnects>0</span>',
        '</div>',
        '<div class="v6-sb-sec">',
          '<span class="v6-sb-lbl">Local Time:</span>',
          '<span class="v6-sb-val" data-v6-status-time>--</span>',
        '</div>',
        '<div class="v6-sb-sec">',
          '<span class="v6-sb-lbl">Buffer:</span>',
          '<span class="v6-sb-val">T: <strong data-v6-status-buffer-trades>0</strong> | HM: <strong data-v6-status-buffer-heatmap>0</strong> | FP: <strong data-v6-status-buffer-footprint>0</strong></span>',
        '</div>',
      '</footer>'
    ].join('');
  }

  function move(target, node) {
    if (target && node) target.appendChild(node);
  }

  var storeUnsub = null;

  V6OF.Shell = {
    dispose: function () {
      if (storeUnsub) {
        try { storeUnsub(); } catch (_) {}
        storeUnsub = null;
      }
      if (V6OF.Backtest && typeof V6OF.Backtest.dispose === 'function') {
        try { V6OF.Backtest.dispose(); } catch (_) {}
      }
      var root = document.getElementById('v6-orderflow-root');
      if (root) {
        delete root.dataset.v6ShellMounted;
        root.removeAttribute('data-v6-shell-mounted');
      }
    },
    init: function (root) {
      if (!root) return;
      var shell = root.querySelector('.v6-shell');
      var grid = root.querySelector('.v6-grid');
      if (!shell || !grid) return;            // Layout not mounted yet
      if (root.dataset.v6ShellMounted === '1') return;

      this.dispose();
      root.dataset.v6ShellMounted = '1';

      var schema = V6OF.LayoutSchema;

      // Snapshot the live Layout panels before re-homing (these hold the render
      // targets). Lookup is by stable id; falls back to the legacy class.
      var layoutPanels = Array.prototype.slice.call(grid.querySelectorAll('[data-v6-panel]'));
      function panelById(id) {
        return root.querySelector('[data-v6-panel="' + id + '"]') || root.querySelector('.v6-panel-' + id);
      }

      // Build the TradingView main area as a detached subtree. Tabs + regions
      // are generated from `schema`, so reordering panels is a one-array edit.
      var holder = document.createElement('div');
      holder.innerHTML = mainAreaHtml(schema);
      var main = holder.querySelector('.v6-main-area');
      var statusBar = holder.querySelector('.v6-status-bar');

      var center = main.querySelector('[data-v6-center-chart]');
      var rbody = main.querySelector('[data-v6-rbody]');
      var cvdStrip = main.querySelector('[data-v6-cvd-strip]');

      // Re-home panels declaratively (nodes are MOVED, listeners + identity
      // preserved). `placed` tracks which Layout panels the schema claimed.
      var placed = {};

      // Center column: the chart slot (and any other stacked center panels).
      schema.center.forEach(function (id) {
        var p = panelById(id);
        if (p) { move(center, p); placed[id] = 1; }
      });

      // Right dock: place each tab's panel in schema order, wiring a11y to the
      // matching generated tab button.
      schema.right.tabs.forEach(function (spec) {
        var p = panelById(spec.id);
        if (!p) return;
        placed[spec.id] = 1;
        p.setAttribute('role', 'tabpanel');
        p.setAttribute('id', 'v6-panel-' + spec.id);
        p.setAttribute('aria-labelledby', 'v6-tab-' + spec.id);
        move(rbody, p);
      });

      // Any Layout panel the schema didn't claim stays hidden (e.g. cvd/vwap —
      // the center CVD strip is its own chrome, not the re-homed cvd panel).
      layoutPanels.forEach(function (p) {
        if (!placed[p.getAttribute('data-v6-panel')]) p.classList.add('v6-panel-hidden');
      });

      // Swap .v6-grid -> .v6-main-area inside the shell.
      shell.replaceChild(main, grid);
      shell.appendChild(statusBar);
      root.classList.add('v6-shell-tv');

      var dockToggle = main.querySelector('[data-v6-dock-toggle]');

      // --- Saved State Restore ---
      var savedState = V6OF.store ? V6OF.store.getState() : {};
      var settings = savedState.settings || {};

      // 1. Active Tab
      var activeTab = settings.activeTab || 'dom';
      rbody.className = 'v6-rbody show-' + activeTab;
      Array.prototype.forEach.call(main.querySelectorAll('[data-v6-rtab]'), function (b) {
        var active = b.getAttribute('data-v6-rtab') === activeTab;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      });

      // 2. Right Dock Collapsed Status
      var dockCollapsed = !!settings.dockCollapsed;
      if (dockCollapsed) {
        root.classList.add('v6-dock-collapsed');
        if (dockToggle) {
          dockToggle.innerHTML = '&#10095;';
          dockToggle.title = 'Expand dock';
        }
      } else {
        root.classList.remove('v6-dock-collapsed');
        if (dockToggle) {
          dockToggle.innerHTML = '&#10094;';
          dockToggle.title = 'Collapse dock';
        }
      }

      // 3. CVD Collapsed Status
      var cvdCollapsed = !!settings.cvdCollapsed;
      if (cvdCollapsed && cvdStrip) {
        cvdStrip.classList.add('is-collapsed');
        var collapseBtn = cvdStrip.querySelector('[data-v6-cvd-collapse]');
        if (collapseBtn) {
          collapseBtn.textContent = '▸';
          collapseBtn.title = 'Expand CVD';
        }
      } else if (cvdStrip) {
        cvdStrip.classList.remove('is-collapsed');
        var collapseBtn = cvdStrip.querySelector('[data-v6-cvd-collapse]');
        if (collapseBtn) {
          collapseBtn.textContent = '▾';
          collapseBtn.title = 'Collapse CVD';
        }
      }

      // Right-column tab switching (DOM / Tape / Settings).
      main.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-v6-rtab]');
        if (!tab || !main.contains(tab)) return;
        var name = tab.getAttribute('data-v6-rtab');

        // Expand the dock if tab is clicked while collapsed
        if (root.classList.contains('v6-dock-collapsed')) {
          root.classList.remove('v6-dock-collapsed');
          if (dockToggle) {
            dockToggle.innerHTML = '&#10094;';
            dockToggle.title = 'Collapse dock';
          }
          if (V6OF.store && V6OF.store.updateSettings) {
            V6OF.store.updateSettings({ dockCollapsed: false });
          }
        }

        rbody.className = 'v6-rbody show-' + name;
        Array.prototype.forEach.call(main.querySelectorAll('[data-v6-rtab]'), function (b) {
          var active = b === tab;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', String(active));
        });

        if (V6OF.store && V6OF.store.updateSettings) {
          V6OF.store.updateSettings({ activeTab: name });
        }

        var cv = root.querySelector('[data-v6-chart]');
        if (cv && V6OF.CanvasChart && V6OF.store) {
          requestAnimationFrame(function () { V6OF.CanvasChart.draw(cv, V6OF.store.getState()); });
        }
      });

      if (dockToggle) {
        dockToggle.addEventListener('click', function () {
          root.classList.toggle('v6-dock-collapsed');
          var isCollapsed = root.classList.contains('v6-dock-collapsed');
          dockToggle.innerHTML = isCollapsed ? '&#10095;' : '&#10094;';
          dockToggle.title = isCollapsed ? 'Expand dock' : 'Collapse dock';
          if (V6OF.store && V6OF.store.updateSettings) {
            V6OF.store.updateSettings({ dockCollapsed: isCollapsed });
          }
          requestAnimationFrame(function () {
            var cv = root.querySelector('[data-v6-chart]');
            if (cv && V6OF.CanvasChart && V6OF.store) V6OF.CanvasChart.draw(cv, V6OF.store.getState());
          });
        });
      }

      // Wire placeholders active state for drawings
      var leftToolbar = main.querySelector('.v6-left-toolbar');
      if (leftToolbar) {
        leftToolbar.addEventListener('click', function (e) {
          var btn = e.target.closest('[data-v6-tool]');
          if (!btn) return;
          var name = btn.getAttribute('data-v6-tool');
          if (name === 'horiz' || name === 'trend' || name === 'rect') {
            var active = btn.classList.contains('is-active');
            // Remove active states from placeholders
            Array.prototype.forEach.call(leftToolbar.querySelectorAll('[data-v6-tool="horiz"], [data-v6-tool="trend"], [data-v6-tool="rect"]'), function (b) {
              b.classList.remove('is-active');
            });
            if (!active) btn.classList.add('is-active');
          }
        });
      }

      // Wire the chart engine: attach pointer interactions + toolbar.
      var canvas = root.querySelector('[data-v6-chart]');
      var cvdCanvas = root.querySelector('[data-v6-cvd-canvas]');
      
      if (V6OF.ChartInteractions) {
        if (canvas) V6OF.ChartInteractions.attach(canvas);
        if (cvdCanvas) V6OF.ChartInteractions.attachCvd(cvdCanvas);
        V6OF.ChartInteractions.wireToolbar(root, canvas);
      }

      // CVD strip: render on store updates + collapse toggle.
      cvdStrip = root.querySelector('[data-v6-cvd-strip]') || cvdStrip;
      if (cvdCanvas && V6OF.CvdPanel && V6OF.store) {
        var drawCvd = function () {
          if (cvdStrip && cvdStrip.classList.contains('is-collapsed')) return;
          V6OF.CvdPanel.draw(cvdCanvas, V6OF.store.getState());
        };
        storeUnsub = V6OF.store.subscribe(drawCvd);
        requestAnimationFrame(drawCvd);
      }
      if (cvdStrip) {
        var collapseBtn = cvdStrip.querySelector('[data-v6-cvd-collapse]');
        if (collapseBtn) collapseBtn.addEventListener('click', function () {
          cvdStrip.classList.toggle('is-collapsed');
          var isCollapsed = cvdStrip.classList.contains('is-collapsed');
          collapseBtn.textContent = isCollapsed ? '▸' : '▾';
          collapseBtn.title = isCollapsed ? 'Expand CVD' : 'Collapse CVD';
          if (V6OF.store && V6OF.store.updateSettings) {
            V6OF.store.updateSettings({ cvdCollapsed: isCollapsed });
          }
          requestAnimationFrame(function () {
            if (canvas && V6OF.CanvasChart && V6OF.store) V6OF.CanvasChart.draw(canvas, V6OF.store.getState());
            if (cvdCanvas && V6OF.CvdPanel && V6OF.store && !isCollapsed) V6OF.CvdPanel.draw(cvdCanvas, V6OF.store.getState());
          });
        });
      }

      // Initialize Resizable Panels and Workspace Manager
      if (V6OF.ResizablePanels) {
        V6OF.ResizablePanels.init(root);
      }
      if (V6OF.WorkspaceManager) {
        V6OF.WorkspaceManager.init(root);
      }

      // Kick a redraw once the new layout sizes settle.
      requestAnimationFrame(function () {
        if (canvas && V6OF.CanvasChart && V6OF.store) {
          V6OF.CanvasChart.draw(canvas, V6OF.store.getState());
        }
      });
    }
  };

  document.addEventListener('pageChange', function (event) {
    if (event.detail && event.detail.page !== 'orderflow') {
      V6OF.Shell.dispose();
    }
  });

  function tryAutoInit() {
    var root = document.getElementById('v6-orderflow-root');
    if (!root) return;
    V6OF.Shell.init(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tryAutoInit, 120); });
  } else {
    setTimeout(tryAutoInit, 120);
  }
})();
