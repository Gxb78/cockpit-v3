// 080_v6_layout_shell.js
// Layout shell: TradingView-inspired panel host for the V6 orderflow surface.
//
// NON-DESTRUCTIVE: instead of rebuilding root.innerHTML (which destroyed the
// Layout panels), this re-homes the existing Layout panels into TradingView
// regions by MOVING their nodes. The nodes stay inside #v6-orderflow-root, so
// Layout.render()'s querySelectors keep resolving and every panel keeps working.
//
// Structure produced (header + engine-bar from Layout are kept as the top bar):
//   .v6-shell
//     .v6-header        (kept — symbol/badge/metrics + reconnect control)
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
  if (!V6OF.register) {
    ['Core', 'Data', 'Transport', 'UI', 'Studies', 'Page'].forEach(function (name) { V6OF[name] = V6OF[name] || {}; });
    V6OF.register = function (domain, name, value, legacyName) {
      V6OF[domain] = V6OF[domain] || {};
      V6OF[domain][name] = value;
      if (legacyName) V6OF[legacyName] = value;
      return value;
    };
  }

  // Crisp inline SVG line icons (stroke = currentColor).
  var ICONS = {
    cursor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l6 16 2.5-6.5L20 10z"/></svg>',
    crosshair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    follow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l7 5-7 5z"/><path d="M14 7l7 5-7 5z"/></svg>',
    horiz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="3" y1="12" x2="21" y2="12"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>',
    trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="6" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="6" r="2" fill="currentColor"/><line x1="7.5" y1="16.5" x2="16.5" y2="7.5"/></svg>',
    rect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="1"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/></svg>',
    indicatorSettings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 4v8l-7 4-7-4V7z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    braces: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4c-2 1-2 3-2 5 0 2-2 3-2 3s2 1 2 3c0 2 0 4 2 5"/><path d="M16 4c2 1 2 3 2 5 0 2 2 3 2 3s-2 1-2 3c0 2 0 4-2 5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6.5 7l1 16h9l1-16"/><path d="M10 11v6M14 11v6"/></svg>',
    indicators: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18l5-7 4 4 7-10"/><path d="M4 21h16"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/></svg>'
  };

  function tool(name, title) {
    return '<button type="button" class="v6-tool" data-v6-tool="' + name + '" title="' + title +
      '" aria-label="' + title + '">' + ICONS[name] + '</button>';
  }

  function viewTool(name, label, title) {
    return '<button type="button" class="v6-tool v6-view-tool" data-v6-tool="' + name + '" title="' + title +
      '" aria-label="' + title + '"><span class="v6-view-tool-icon">' + ICONS[name === 'detach' ? 'follow' : name] +
      '</span><span class="v6-view-tool-label">' + label + '</span><span class="v6-view-tool-state" aria-hidden="true"></span></button>';
  }

  function indicatorButton(action, icon, title) {
    return '<button type="button" class="v6-indicator-action" data-v6-indicator-action="' + action +
      '" title="' + title + '" aria-label="' + title + '">' + ICONS[icon] + '</button>';
  }

  function indicatorToolbarHtml(id) {
    return [
      '<div class="v6-indicator-toolbar" data-v6-indicator-toolbar data-v6-indicator-id="' + id + '">',
        indicatorButton('hide', 'eye', 'Hide'),
        indicatorButton('settings', 'indicatorSettings', 'Settings'),
        indicatorButton('source', 'braces', 'Source'),
        indicatorButton('remove', 'trash', 'Remove'),
        indicatorButton('more', 'more', 'More'),
      '</div>'
    ].join('');
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
        { id: 'info', label: 'Info' },
        { id: 'indicators', label: 'Indicators', icon: true, glyph: ICONS.indicators },
        { id: 'settings', label: 'Settings', icon: true, glyph: '⚙' }
      ],
      'default': 'dom'
    }
  };
  V6OF.register('UI', 'LayoutSchema', V6OF.UI.LayoutSchema || DEFAULT_SCHEMA, 'LayoutSchema');

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
        viewTool('follow', 'Follow', 'Follow live'),
        viewTool('detach', 'Detach', 'Detach from live edge'),
        viewTool('fit', 'Fit', 'Fit price and time to loaded data'),
        viewTool('reset', 'Reset View', 'Reset chart view'),
        /* Hiding drawing placeholders until implementation
        '<div class="v6-tool-sep"></div>',
        tool('horiz', 'Horizontal Line (Drawing Placeholder)'),
        tool('trend', 'Trendline (Drawing Placeholder)'),
        tool('rect', 'Rectangle (Drawing Placeholder)'),
        */
      '</div>'
    ].join('');
  }

  function priceZoomControlsHtml() {
    return [
      '<div class="v6-price-zoom-controls" data-v6-price-zoom-controls aria-label="Price zoom controls">',
        '<button type="button" class="v6-price-zoom-btn" data-v6-price-zoom="in" title="Zoom price in" aria-label="Zoom price in">Price +</button>',
        '<button type="button" class="v6-price-zoom-btn" data-v6-price-zoom="out" title="Zoom price out" aria-label="Zoom price out">Price -</button>',
        '<button type="button" class="v6-price-zoom-btn" data-v6-price-zoom="auto" title="Auto fit price" aria-label="Auto fit price">Auto Y</button>',
      '</div>'
    ].join('');
  }

  function mainAreaHtml(schema) {
    return [
      '<div class="v6-main-area">',
        leftToolbarHtml(),
        '<div class="v6-center-col">',
          '<div class="v6-center-chart" data-v6-center-chart>',
            priceZoomControlsHtml(),
          '</div>',
          '<div class="v6-replay-strip" data-v6-replay-strip></div>',
          '<div class="v6-resize-v" title="Drag to resize indicator height"></div>',
          '<div class="v6-cvd-strip" data-v6-cvd-strip>',
            '<div class="v6-cvd-strip-head">',
              '<span class="v6-indicator-name" data-v6-cvd-label>CVD</span>',
              indicatorToolbarHtml('cvd'),
              '<button type="button" class="v6-cvd-collapse" data-v6-cvd-collapse aria-label="Hide CVD" title="Hide">▾</button>',
            '</div>',
            '<canvas class="v6-cvd-canvas" data-v6-cvd-canvas></canvas>',
          '</div>',
          '<div class="v6-indicator-panes" data-v6-indicator-panes></div>',
        '</div>',
        '<div class="v6-resize-h" title="Drag to resize right dock width"></div>',
        '<div class="v6-right-col" data-v6-right-col>',
          rtabsHtml(schema),
          '<div class="v6-rbody show-' + schema.right['default'] + '" data-v6-rbody>',
            // Custom info panel inside right dock
            '<section class="v6-panel v6-panel-info" data-v6-panel="info" id="v6-panel-info" role="tabpanel" aria-labelledby="v6-tab-info" aria-label="V6 Info">',
              '<div class="v6-panel-head"><span>Info</span><small>Candle inspector</small></div>',
              '<div class="v6-panel-body v6-info-body" data-v6-info-panel>',
                '<div class="v6-inspector-empty">Move over the chart to inspect a candle.</div>',
              '</div>',
            '</section>',
            '<section class="v6-panel v6-panel-indicators" data-v6-panel="indicators" id="v6-panel-indicators" role="tabpanel" aria-labelledby="v6-tab-indicators" aria-label="V6 Indicators">',
              '<div class="v6-panel-head"><span>Indicators</span><small>Live JS</small></div>',
              '<div class="v6-panel-body v6-indicators-body" data-v6-indicators-panel>',
                '<div class="v6-indicators-empty">Loading indicators...</div>',
              '</div>',
            '</section>',
          '</div>',
        '</div>',
      '</div>',
      '<footer class="v6-status-bar">',
        '<div class="v6-sb-sec">',
          '<span class="v6-sb-lbl">Engine:</span>',
          '<span class="v6-sb-val" data-v6-status-url>configured</span>',
        '</div>',
        '<div class="v6-sb-sec">',
          '<span class="v6-sb-lbl">Reconnects:</span>',
          '<span class="v6-sb-val" data-v6-status-reconnects>0</span>',
        '</div>',
        '<div class="v6-sb-sec">',
          '<span class="v6-sb-lbl">Health:</span>',
          '<span class="v6-sb-val">Lag <strong data-v6-status-lag>--</strong> | Q <strong data-v6-status-queue>0</strong> | Drop <strong data-v6-status-drops>0</strong></span>',
        '</div>',
        '<div class="v6-sb-sec">',
          '<span class="v6-sb-lbl">Engine Config:</span>',
          '<span class="v6-sb-val" data-v6-engine-config-status>stale</span>',
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

  V6OF.register('Page', 'Shell', {
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
      var store = V6OF.getStore ? V6OF.getStore(root) : null;

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
      var savedState = store && store.getState ? store.getState() : {};
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
      // Locate right col early for initial state restore
      var rightColInit = main.querySelector('[data-v6-right-col]');
      if (dockCollapsed) {
        root.classList.add('v6-dock-collapsed');
        // Clear inline sizes so CSS rules can take effect immediately
        if (rightColInit) { rightColInit.style.width = ''; rightColInit.style.flex = ''; }
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
          // Restore inline width so ResizablePanels' saved size is respected again
          var _rightCol = main.querySelector('[data-v6-right-col]');
          if (_rightCol) {
            var _saved = localStorage.getItem('cockpitV6.rightColWidth');
            if (_saved) { var _w = parseInt(_saved, 10); if (_w > 0) { _rightCol.style.width = _w + 'px'; _rightCol.style.flex = '0 0 ' + _w + 'px'; } }
          }
          if (store && store.updateSettings) {
            store.updateSettings({ dockCollapsed: false });
          }
        }

        rbody.className = 'v6-rbody show-' + name;
        Array.prototype.forEach.call(main.querySelectorAll('[data-v6-rtab]'), function (b) {
          var active = b === tab;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', String(active));
        });

        if (store && store.updateSettings) {
          var prevState = store.getState ? store.getState() : {};
          var prevSettings = (prevState && prevState.settings) || {};
          if ((prevSettings.activeTab || 'dom') === 'info' && name !== 'info' && store.updateUi) {
            store.updateUi({
              activeCandleOpenTime: 0,
              activeCandleCloseTime: 0,
              activeCandleSource: '',
              activeCandleSnapshot: null,
              activeCandleLocked: false,
              activeCandleUpdatedAt: Date.now(),
              pinnedCandle: null
            });
          }
          store.updateSettings({ activeTab: name });
        }

        var cv = root.querySelector('[data-v6-chart]');
        if (cv && V6OF.CanvasChart && store) {
          requestAnimationFrame(function () { V6OF.CanvasChart.draw(cv, store.getState()); });
        }
      });

      // Helper: clear/restore right-col inline sizes so CSS .v6-dock-collapsed rules
      // are not overridden by the ResizablePanels inline style.width / style.flex.
      var rightCol = main.querySelector('[data-v6-right-col]');
      function applyDockCollapsed(isCollapsed) {
        if (isCollapsed) {
          // Erase inline constraints → CSS takes over (flex-basis:36px, width:36px)
          if (rightCol) { rightCol.style.width = ''; rightCol.style.flex = ''; }
        } else {
          // Restore saved width (if any) so ResizablePanels' last value is respected
          if (rightCol) {
            var saved = localStorage.getItem('cockpitV6.rightColWidth');
            if (saved) {
              var w = parseInt(saved, 10);
              if (w > 0) { rightCol.style.width = w + 'px'; rightCol.style.flex = '0 0 ' + w + 'px'; }
            }
          }
        }
      }

      if (dockToggle) {
        dockToggle.addEventListener('click', function () {
          root.classList.toggle('v6-dock-collapsed');
          var isCollapsed = root.classList.contains('v6-dock-collapsed');
          dockToggle.innerHTML = isCollapsed ? '&#10095;' : '&#10094;';
          dockToggle.title = isCollapsed ? 'Expand dock' : 'Collapse dock';
          applyDockCollapsed(isCollapsed);
          if (isCollapsed && store && store.updateUi) {
            var st = store.getState ? store.getState() : {};
            var activeTab = st && st.settings && st.settings.activeTab;
            if ((activeTab || 'dom') === 'info') {
              store.updateUi({
                activeCandleOpenTime: 0,
                activeCandleCloseTime: 0,
                activeCandleSource: '',
                activeCandleSnapshot: null,
                activeCandleLocked: false,
                activeCandleUpdatedAt: Date.now(),
                pinnedCandle: null
              });
            }
          }
          if (store && store.updateSettings) {
            store.updateSettings({ dockCollapsed: isCollapsed });
          }
          requestAnimationFrame(function () {
            var cv = root.querySelector('[data-v6-chart]');
            if (cv && V6OF.CanvasChart && store) V6OF.CanvasChart.draw(cv, store.getState());
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
      if (cvdStrip) {
        function applyCvdChrome(state) {
          var nextSettings = (state && state.settings) || {};
          var visible = nextSettings.showCVD !== false;
          var collapsed = !!nextSettings.cvdCollapsed;
          cvdStrip.classList.toggle('is-removed', !visible);
          cvdStrip.classList.toggle('is-collapsed', visible && collapsed);
          cvdStrip.setAttribute('aria-hidden', String(!visible));
          var centerCol = root.querySelector('.v6-center-col');
          if (centerCol) {
            centerCol.style.setProperty('--v6-cvd-strip-height', !visible ? '0px' : (collapsed ? '24px' : ((cvdStrip.offsetHeight || 124) + 'px')));
          }
          var btn = cvdStrip.querySelector('[data-v6-cvd-collapse]');
          if (btn) {
            btn.textContent = collapsed ? '▸' : '▾';
            btn.title = collapsed ? 'Show' : 'Hide';
            btn.setAttribute('aria-label', collapsed ? 'Show CVD' : 'Hide CVD');
          }
          var resize = root.querySelector('.v6-resize-v');
          if (resize) resize.classList.toggle('is-hidden', !visible);
        }

        function redrawCvdAndChart() {
          requestAnimationFrame(function () {
            var current = store && store.getState ? store.getState() : {};
            if (canvas && V6OF.CanvasChart) V6OF.CanvasChart.draw(canvas, current);
            if (cvdCanvas && V6OF.CvdPanel && !cvdStrip.classList.contains('is-collapsed') && !cvdStrip.classList.contains('is-removed')) {
              V6OF.CvdPanel.draw(cvdCanvas, current);
            }
          });
        }

        function openDockTab(name) {
          var wasCollapsed = root.classList.contains('v6-dock-collapsed');
          root.classList.remove('v6-dock-collapsed');
          if (dockToggle) {
            dockToggle.innerHTML = '&#10094;';
            dockToggle.title = 'Collapse dock';
          }
          // Restore inline width if we just expanded from collapsed state
          if (wasCollapsed) {
            var _rightCol2 = main.querySelector('[data-v6-right-col]');
            if (_rightCol2) {
              var _saved2 = localStorage.getItem('cockpitV6.rightColWidth');
              if (_saved2) { var _w2 = parseInt(_saved2, 10); if (_w2 > 0) { _rightCol2.style.width = _w2 + 'px'; _rightCol2.style.flex = '0 0 ' + _w2 + 'px'; } }
            }
          }
          rbody.className = 'v6-rbody show-' + name;
          Array.prototype.forEach.call(main.querySelectorAll('[data-v6-rtab]'), function (b) {
            var active = b.getAttribute('data-v6-rtab') === name;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-selected', String(active));
          });
          if (store && store.updateSettings) {
            store.updateSettings({ activeTab: name, dockCollapsed: false });
          }
          redrawCvdAndChart();
        }

        function setCvdCollapsed(collapsed) {
          if (store && store.updateSettings) {
            store.updateSettings({ showCVD: true, cvdCollapsed: !!collapsed });
          } else {
            cvdStrip.classList.toggle('is-collapsed', !!collapsed);
          }
          redrawCvdAndChart();
        }

        function setCvdRemoved(removed) {
          if (store && store.updateSettings) {
            store.updateSettings({ showCVD: !removed });
          } else {
            cvdStrip.classList.toggle('is-removed', !!removed);
          }
          redrawCvdAndChart();
        }

        cvdStrip.addEventListener('click', function (e) {
          var actionBtn = e.target.closest('[data-v6-indicator-action]');
          if (!actionBtn || !cvdStrip.contains(actionBtn)) return;
          var action = actionBtn.getAttribute('data-v6-indicator-action');
          if (action === 'hide') {
            setCvdCollapsed(true);
          } else if (action === 'settings' || action === 'more') {
            openDockTab(action === 'settings' ? 'settings' : 'indicators');
          } else if (action === 'remove') {
            setCvdRemoved(true);
          } else if (action === 'source') {
            if (store && store.updateUi) {
              store.updateUi({ activeIndicatorId: 'cvd', indicatorEditorOpen: true });
            }
            openDockTab('indicators');
          }
        });

        var collapseBtn = cvdStrip.querySelector('[data-v6-cvd-collapse]');
        if (collapseBtn) collapseBtn.addEventListener('click', function () {
          setCvdCollapsed(!cvdStrip.classList.contains('is-collapsed'));
        });

        if (store) {
          applyCvdChrome(store.getState());
          var shellSlices = {};
          function sameSlice(name, slice) {
            var last = shellSlices[name];
            if (V6OF.shallowEqual && V6OF.shallowEqual(last, slice)) return true;
            shellSlices[name] = slice;
            return false;
          }
          storeUnsub = store.subscribe(function (state) {
            var settings = (state && state.settings) || {};
            var cvdChromeSlice = {
              showCVD: settings.showCVD !== false,
              cvdCollapsed: !!settings.cvdCollapsed
            };
            if (!sameSlice('cvdChrome', cvdChromeSlice)) applyCvdChrome(state);

            var cvdDrawSlice = {
              deltaIntervalMs: settings.deltaIntervalMs,
              deltaBuckets: state && state.deltaBuckets,
              latestDeltaByInterval: state && state.latestDeltaByInterval,
              showCVD: settings.showCVD !== false,
              cvdCollapsed: !!settings.cvdCollapsed
            };
            if (!sameSlice('cvdDraw', cvdDrawSlice) && cvdCanvas && V6OF.CvdPanel && !cvdStrip.classList.contains('is-collapsed') && !cvdStrip.classList.contains('is-removed')) {
              V6OF.CvdPanel.draw(cvdCanvas, state);
            }
            if (V6OF.Inspector) {
              var activeTab = settings.activeTab || 'dom';
              var dockCollapsed = !!settings.dockCollapsed;
              var inspectorSlice = {
                activeTab: activeTab,
                dockCollapsed: dockCollapsed,
                activeCandleOpenTime: state && state.ui && state.ui.activeCandleOpenTime,
                activeCandleLocked: state && state.ui && state.ui.activeCandleLocked,
                trades: state && state.trades,
                orderBook: state && state.orderBook
              };
              if (activeTab === 'info' && !dockCollapsed && !sameSlice('inspector', inspectorSlice)) {
                V6OF.Inspector.renderInto(root, state);
              }
            }
            if (V6OF.ReplayTimeline) {
              var replaySlice = { replay: state && state.replay };
              if (!sameSlice('replay', replaySlice)) V6OF.ReplayTimeline.renderInto(root, state);
            }
          });
          redrawCvdAndChart();
        }
      }

      // Initialize Resizable Panels and Workspace Manager
      if (V6OF.ResizablePanels) {
        V6OF.ResizablePanels.init(root);
      }
      if (V6OF.WorkspaceManager) {
        V6OF.WorkspaceManager.init(root);
      }
      if (V6OF.Inspector && store) {
        V6OF.Inspector.renderInto(root, store.getState());
      }
      if (V6OF.IndicatorPanel && store) {
        V6OF.IndicatorPanel.renderInto(root, store.getState());
        V6OF.IndicatorPanel.renderPanes(root, store.getState());
      }
      if (V6OF.ReplayTimeline && store) {
        V6OF.ReplayTimeline.renderInto(root, store.getState());
      }

      // Kick a redraw once the new layout sizes settle.
      requestAnimationFrame(function () {
        if (canvas && V6OF.CanvasChart && store) {
          V6OF.CanvasChart.draw(canvas, store.getState());
        }
      });
    }
  }, 'Shell');

  V6OF.registerPage('orderflow', {
    create: function (root) {
      root = root || document.getElementById('v6-orderflow-root');
      if (!root || !V6OF.Layout || typeof V6OF.Layout.create !== 'function') return;
      V6OF.Layout.create(root);
    },
    mount: function (root) {
      root = root || document.getElementById('v6-orderflow-root');
      if (!root || !V6OF.Layout || typeof V6OF.Layout.mount !== 'function') return;
      V6OF.Layout.mount(root);
      if (V6OF.Shell && typeof V6OF.Shell.init === 'function') {
        V6OF.Shell.init(root);
      }
    },
    bind: function (root) {
      root = root || document.getElementById('v6-orderflow-root');
      if (!root || !V6OF.Layout || typeof V6OF.Layout.bind !== 'function') return;
      V6OF.Layout.bind(root);
    },
    unmount: function (root) {
      root = root || document.getElementById('v6-orderflow-root');
      if (V6OF.Shell && typeof V6OF.Shell.dispose === 'function') {
        V6OF.Shell.dispose();
      }
      if (root && V6OF.Layout && typeof V6OF.Layout.unmount === 'function') {
        V6OF.Layout.unmount(root);
      }
    },
    destroy: function (root) {
      root = root || document.getElementById('v6-orderflow-root');
      if (root && V6OF.Layout && typeof V6OF.Layout.destroy === 'function') {
        V6OF.Layout.destroy(root);
      }
    }
  });
})();
