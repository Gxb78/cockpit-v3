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

  function renderRootId(root) {
    if (!root) return 'global';
    if (!root._v6RenderRootId) {
      V6OF._renderRootSeq = (V6OF._renderRootSeq || 0) + 1;
      root._v6RenderRootId = root.id || ('root-' + V6OF._renderRootSeq);
    }
    return root._v6RenderRootId;
  }

  function queueRender(root, surface, fn) {
    var scheduler = V6OF.RenderScheduler;
    if (scheduler && scheduler.queue) {
      scheduler.queue(surface + ':' + renderRootId(root), fn);
    } else if (typeof fn === 'function') {
      fn();
    }
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

  var PANEL_SPECS = {
    dom: { id: 'dom', label: 'DOM' },
    tape: { id: 'tape', label: 'Tape' },
    orderbook: { id: 'orderbook', label: 'Book' },
    info: { id: 'info', label: 'Info' },
    indicators: { id: 'indicators', label: 'Indicators', icon: true, glyph: ICONS.indicators },
    settings: { id: 'settings', label: 'Settings', icon: true, glyph: '⚙' }
  };

  var DEFAULT_SCHEMA = {
    left: [],
    center: ['chart'],
    right: ['dom', 'tape', 'orderbook', 'info', 'indicators', 'settings'],
    activeLeftTab: '',
    activeRightTab: 'dom'
  };
  V6OF.register('UI', 'LayoutSchema', V6OF.UI.LayoutSchema || DEFAULT_SCHEMA, 'LayoutSchema');

  // Short side code (l/r) — the click/drag handlers and CSS all key off
  // data-v6-rtab / data-v6-ltab and .v6-rtab / .v6-ltab, so tabs MUST emit the
  // short form (not v6-righttab) or they are neither styled nor interactive.
  function tabHtml(spec, isDefault, side) {
    var sc = side === 'left' ? 'l' : 'r';
    var sel = isDefault ? 'true' : 'false';
    var activeCls = isDefault ? ' is-active' : '';
    var iconCls = spec.icon ? ' v6-' + sc + 'tab-icon' : '';
    var extra = spec.icon ? ' title="' + spec.label + '" aria-label="' + spec.label + '"' : '';
    var content = spec.icon ? (spec.glyph || spec.label) : spec.label;
    var tabClass = 'v6-' + sc + 'tab';
    return '<button type="button" class="' + tabClass + iconCls + activeCls + '" id="v6-' + sc + 'tab-' + spec.id +
      '" role="tab" aria-selected="' + sel + '" aria-controls="v6-panel-' + spec.id +
      '" data-v6-' + sc + 'tab="' + spec.id + '" draggable="true"' + extra + '>' + content + '</button>';
  }

  function tabsHtml(side, panelIds, activeId) {
    var sc = side === 'left' ? 'l' : 'r';
    var parts = ['<div class="v6-' + sc + 'tabs" data-v6-' + sc + 'tabs role="tablist" aria-label="Orderflow ' + side + ' tabs">'];
    panelIds.forEach(function (id) {
      var spec = PANEL_SPECS[id];
      if (spec && !spec.icon) parts.push(tabHtml(spec, id === activeId, side));
    });
    if (side === 'right') {
      parts.push('<button type="button" class="v6-rtab v6-rtab-icon" data-v6-dock-toggle title="Collapse dock" aria-label="Collapse dock">&#10094;</button>');
    } else {
      parts.push('<button type="button" class="v6-ltab v6-ltab-icon" data-v6-left-dock-toggle title="Collapse left dock" aria-label="Collapse left dock">&#10095;</button>');
    }
    panelIds.forEach(function (id) {
      var spec = PANEL_SPECS[id];
      if (spec && spec.icon) parts.push(tabHtml(spec, id === activeId, side));
    });
    parts.push('</div>');
    return parts.join('');
  }

  function leftToolbarHtml() {
    return [
      '<div class="v6-left-toolbar">',
        tool('cursor', 'Cursor — select and move objects'),
        tool('crosshair', 'Crosshair — price/time crosshair'),
        '<div class="v6-tool-sep"></div>',
        viewTool('follow', 'Follow', 'Follow live'),
        viewTool('detach', 'Detach', 'Detach from live edge'),
        viewTool('fit', 'Fit', 'Fit price and time to loaded data'),
        viewTool('reset', 'Reset View', 'Reset chart view'),
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

  function mainAreaHtml() {
    return [
      '<div class="v6-main-area">',
        leftToolbarHtml(),
        '<div class="v6-left-col is-hidden" data-v6-left-col>',
          '<div class="v6-ltabs-container" data-v6-ltabs-container></div>',
          '<div class="v6-lbody" data-v6-lbody></div>',
        '</div>',
        '<div class="v6-resize-h-left is-hidden" title="Drag to resize left dock width" data-v6-resize-h-left></div>',
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
          '<div class="v6-rtabs-container" data-v6-rtabs-container></div>',
          '<div class="v6-rbody" data-v6-rbody>',
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
      if (!shell || !grid) return;
      if (root.dataset.v6ShellMounted === '1') return;
      var store = V6OF.getStore ? V6OF.getStore(root) : null;

      this.dispose();
      root.dataset.v6ShellMounted = '1';

      var savedState = store && store.getState ? store.getState() : {};
      var settings = savedState.settings || {};
      var schema = settings.layoutSchema || DEFAULT_SCHEMA;

      var layoutPanels = Array.prototype.slice.call(grid.querySelectorAll('[data-v6-panel]'));
      root._v6LayoutPanels = layoutPanels;
      function panelById(id) {
        var panels = root._v6LayoutPanels || [];
        for (var i = 0; i < panels.length; i++) {
          var pId = panels[i].getAttribute('data-v6-panel') || '';
          if (pId === id || panels[i].classList.contains('v6-panel-' + id)) return panels[i];
        }
        return root.querySelector('[data-v6-panel="' + id + '"]') || root.querySelector('.v6-panel-' + id);
      }

      var canvas = root.querySelector('[data-v6-chart]');

      var holder = document.createElement('div');
      holder.innerHTML = mainAreaHtml();
      var main = holder.querySelector('.v6-main-area');
      var statusBar = holder.querySelector('.v6-status-bar');

      var cvdCanvas = main.querySelector('[data-v6-cvd-canvas]');
      var center = main.querySelector('[data-v6-center-chart]');
      var cvdStrip = main.querySelector('[data-v6-cvd-strip]');

      var placed = {};
      schema.center.forEach(function (id) {
        var p = panelById(id);
        if (p) { move(center, p); placed[id] = 1; }
      });

      shell.replaceChild(main, grid);
      shell.appendChild(statusBar);
      root.classList.add('v6-shell-tv');

      if (V6OF.ChartInteractions) {
        if (canvas) V6OF.ChartInteractions.attach(canvas);
        if (cvdCanvas) V6OF.ChartInteractions.attachCvd(cvdCanvas);
        V6OF.ChartInteractions.wireToolbar(root, canvas);
      }

      applySchema(root, schema, settings, placed, layoutPanels, panelById);

      var dockCollapsed = !!settings.dockCollapsed;
      var rightColInit = main.querySelector('[data-v6-right-col]');
      var dockToggle = main.querySelector('[data-v6-dock-toggle]');
      if (dockCollapsed) {
        root.classList.add('v6-dock-collapsed');
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

      var leftDockCollapsed = !!settings.leftDockCollapsed;
      var leftColInit = main.querySelector('[data-v6-left-col]');
      var leftToggleInit = main.querySelector('[data-v6-left-dock-toggle]');
      if (leftDockCollapsed) {
        root.classList.add('v6-left-dock-collapsed');
        if (leftColInit) { leftColInit.style.width = ''; leftColInit.style.flex = ''; }
        if (leftToggleInit) {
          leftToggleInit.innerHTML = '&#10094;';
          leftToggleInit.title = 'Expand left dock';
        }
      } else {
        root.classList.remove('v6-left-dock-collapsed');
        if (leftToggleInit) {
          leftToggleInit.innerHTML = '&#10095;';
          leftToggleInit.title = 'Collapse left dock';
        }
      }

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

      function applySchema(root, schema, settings, placed, layoutPanels, panelById) {
        var main = root.querySelector('.v6-main-area');
        if (!main) return;

        var leftCol = main.querySelector('[data-v6-left-col]');
        var leftResize = main.querySelector('[data-v6-resize-h-left]');
        var rightCol = main.querySelector('[data-v6-right-col]');
        var rightResize = main.querySelector('.v6-resize-h');

        var lbody = main.querySelector('[data-v6-lbody]');
        var rbody = main.querySelector('[data-v6-rbody]');
        var ltabsContainer = main.querySelector('[data-v6-ltabs-container]');
        var rtabsContainer = main.querySelector('[data-v6-rtabs-container]');

        if (!leftCol || !rightCol || !lbody || !rbody || !ltabsContainer || !rtabsContainer) return;

        settings = settings || {};
        placed = placed || {};
        layoutPanels = layoutPanels || [];
        panelById = panelById || function (id) {
          var panels = root._v6LayoutPanels || [];
          for (var i = 0; i < panels.length; i++) {
            var pId = panels[i].getAttribute('data-v6-panel') || '';
            if (pId === id || panels[i].classList.contains('v6-panel-' + id)) return panels[i];
          }
          return root.querySelector('[data-v6-panel="' + id + '"]') || root.querySelector('.v6-panel-' + id);
        };

        var leftPanels = (schema.left || []).filter(function (id) {
          if (id === 'dom') return settings.showDOM !== false;
          if (id === 'tape') return settings.showTape !== false;
          if (id === 'cvd') return settings.showCVD !== false;
          return true;
        });
        var rightPanels = (schema.right || []).filter(function (id) {
          if (id === 'dom') return settings.showDOM !== false;
          if (id === 'tape') return settings.showTape !== false;
          if (id === 'cvd') return settings.showCVD !== false;
          return true;
        });

        var showLeft = leftPanels.length > 0;
        leftCol.classList.toggle('is-hidden', !showLeft);
        if (leftResize) leftResize.classList.toggle('is-hidden', !showLeft);

        var showRight = rightPanels.length > 0;
        rightCol.classList.toggle('is-hidden', !showRight);
        if (rightResize) rightResize.classList.toggle('is-hidden', !showRight);

        var activeLeft = schema.activeLeftTab || (leftPanels[0] || '');
        ltabsContainer.innerHTML = showLeft ? tabsHtml('left', leftPanels, activeLeft) : '';
        lbody.className = 'v6-lbody show-' + activeLeft;

        var activeRight = schema.activeRightTab || (rightPanels[0] || '');
        rtabsContainer.innerHTML = showRight ? tabsHtml('right', rightPanels, activeRight) : '';
        rbody.className = 'v6-rbody show-' + activeRight;

        leftPanels.forEach(function (id) {
          var p = panelById(id);
          if (p) {
            p.setAttribute('role', 'tabpanel');
            p.setAttribute('id', 'v6-panel-' + id);
            p.setAttribute('aria-labelledby', 'v6-ltab-' + id);
            p.classList.remove('v6-panel-hidden');
            move(lbody, p);
            placed[id] = 1;
          }
        });

        rightPanels.forEach(function (id) {
          var p = panelById(id);
          if (p) {
            p.setAttribute('role', 'tabpanel');
            p.setAttribute('id', 'v6-panel-' + id);
            p.setAttribute('aria-labelledby', 'v6-rtab-' + id);
            p.classList.remove('v6-panel-hidden');
            move(rbody, p);
            placed[id] = 1;
          }
        });

        layoutPanels.forEach(function (p) {
          var panelId = p.getAttribute('data-v6-panel');
          if (!placed[panelId]) p.classList.add('v6-panel-hidden');
        });

        setupDragAndDrop(root, schema, settings);
        setupDockToggles(root, schema);
      }

      function setupDragAndDrop(root, schema, settings) {
        var store = V6OF.getStore ? V6OF.getStore(root) : null;
        if (!store) return;

        var dragstart = function (e) {
          var targetEl = e.target.nodeType === 3 ? e.target.parentNode : e.target;
          var btn = targetEl.closest('[data-v6-rtab], [data-v6-ltab]');
          var id = btn ? (btn.getAttribute('data-v6-rtab') || btn.getAttribute('data-v6-ltab')) : null;
          if (id) {
            e.dataTransfer.setData('text/plain', id);
            e.dataTransfer.effectAllowed = 'move';
            btn.classList.add('is-dragging');
            root.classList.add('v6-dragging-active');
          }
        };

        var dragend = function (e) {
          var targetEl = e.target.nodeType === 3 ? e.target.parentNode : e.target;
          var btn = targetEl.closest('[data-v6-rtab], [data-v6-ltab]');
          if (btn) btn.classList.remove('is-dragging');
          root.classList.remove('v6-dragging-active');
        };

        var tabs = root.querySelectorAll('[data-v6-rtab], [data-v6-ltab]');
        Array.prototype.forEach.call(tabs, function (tab) {
          tab.addEventListener('dragstart', dragstart);
          tab.addEventListener('dragend', dragend);
        });

        var panelHeaders = root.querySelectorAll('.v6-panel-head');
        // Drag on headers removed to fix click event swallowing in Wails Chromium.


        var dragover = function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          var zone = e.target.closest('[data-v6-left-col], [data-v6-right-col], [data-v6-rtabs-container], [data-v6-ltabs-container]');
          if (zone) {
            var allZones = root.querySelectorAll('[data-v6-left-col], [data-v6-right-col], [data-v6-rtabs-container], [data-v6-ltabs-container]');
            Array.prototype.forEach.call(allZones, function (z) {
              if (z !== zone) z.classList.remove('v6-drag-over');
            });
            zone.classList.add('v6-drag-over');
          }
        };

        var dragleave = function (e) {
          var zone = e.target.closest('[data-v6-left-col], [data-v6-right-col], [data-v6-rtabs-container], [data-v6-ltabs-container]');
          if (zone) {
            var rect = zone.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX >= rect.right || e.clientY < rect.top || e.clientY >= rect.bottom) {
              zone.classList.remove('v6-drag-over');
            }
          }
        };

        var drop = function (e) {
          e.preventDefault();
          var id = e.dataTransfer.getData('text/plain');
          if (!id) return;

          var targetZone = e.target.closest('[data-v6-left-col], [data-v6-right-col], [data-v6-rtabs-container], [data-v6-ltabs-container]');
          if (!targetZone) return;

          targetZone.classList.remove('v6-drag-over');

          var dest = targetZone.hasAttribute('data-v6-left-col') || targetZone.hasAttribute('data-v6-ltabs-container') ? 'left' : 'right';

          var left = (schema.left || []).slice();
          var right = (schema.right || []).slice();

          left = left.filter(function (x) { return x !== id; });
          right = right.filter(function (x) { return x !== id; });

          if (dest === 'left') {
            if (left.indexOf(id) === -1) left.push(id);
          } else {
            if (right.indexOf(id) === -1) right.push(id);
          }

          var nextSchema = {
            left: left,
            center: schema.center,
            right: right,
            activeLeftTab: dest === 'left' ? id : (schema.activeLeftTab || left[0] || ''),
            activeRightTab: dest === 'right' ? id : (schema.activeRightTab || right[0] || '')
          };

          store.updateSettings({ layoutSchema: nextSchema });
        };

        var zones = root.querySelectorAll('[data-v6-left-col], [data-v6-right-col], [data-v6-rtabs-container], [data-v6-ltabs-container]');
        Array.prototype.forEach.call(zones, function (z) {
          z.addEventListener('dragover', dragover);
          z.addEventListener('dragleave', dragleave);
          z.addEventListener('drop', drop);
        });
      }

      function setupDockToggles(root, schema) {
        var store = V6OF.getStore ? V6OF.getStore(root) : null;
        if (!store) return;

        var rightToggle = root.querySelector('[data-v6-dock-toggle]');
        var leftCol = root.querySelector('[data-v6-left-col]');
        var rightCol = root.querySelector('[data-v6-right-col]');

        if (rightToggle) {
          var nextToggle = rightToggle.cloneNode(true);
          rightToggle.parentNode.replaceChild(nextToggle, rightToggle);
          nextToggle.addEventListener('click', function () {
            root.classList.toggle('v6-dock-collapsed');
            var isCollapsed = root.classList.contains('v6-dock-collapsed');
            nextToggle.innerHTML = isCollapsed ? '&#10095;' : '&#10094;';
            nextToggle.title = isCollapsed ? 'Expand dock' : 'Collapse dock';

            if (isCollapsed) {
              if (rightCol) { rightCol.style.width = ''; rightCol.style.flex = ''; }
            } else {
              var saved = localStorage.getItem('cockpitV6.rightColWidth');
              if (saved) {
                var w = parseInt(saved, 10);
                if (w > 0) { rightCol.style.width = w + 'px'; rightCol.style.flex = '0 0 ' + w + 'px'; }
              }
            }

            if (store.updateSettings) {
              store.updateSettings({ dockCollapsed: isCollapsed });
            }

            requestAnimationFrame(function () {
              var cv = root.querySelector('[data-v6-chart]');
              if (cv && V6OF.CanvasChart) V6OF.CanvasChart.draw(cv, store.getState());
            });
          });
        }

        var leftToggle = root.querySelector('[data-v6-left-dock-toggle]');
        if (leftToggle) {
          var nextLeftToggle = leftToggle.cloneNode(true);
          leftToggle.parentNode.replaceChild(nextLeftToggle, leftToggle);
          nextLeftToggle.addEventListener('click', function () {
            root.classList.toggle('v6-left-dock-collapsed');
            var isCollapsed = root.classList.contains('v6-left-dock-collapsed');
            nextLeftToggle.innerHTML = isCollapsed ? '&#10094;' : '&#10095;';
            nextLeftToggle.title = isCollapsed ? 'Expand left dock' : 'Collapse left dock';

            if (isCollapsed) {
              if (leftCol) { leftCol.style.width = ''; leftCol.style.flex = ''; }
            } else {
              var saved = localStorage.getItem('cockpitV6.leftColWidth');
              if (saved) {
                var w = parseInt(saved, 10);
                if (w > 0) { leftCol.style.width = w + 'px'; leftCol.style.flex = '0 0 ' + w + 'px'; }
              }
            }

            if (store.updateSettings) {
              store.updateSettings({ leftDockCollapsed: isCollapsed });
            }

            requestAnimationFrame(function () {
              var cv = root.querySelector('[data-v6-chart]');
              if (cv && V6OF.CanvasChart) V6OF.CanvasChart.draw(cv, store.getState());
            });
          });
        }
      }

      main.addEventListener('mousedown', function (e) {
        var tab = e.target.closest('[data-v6-rtab], [data-v6-ltab]');
        if (!tab || !main.contains(tab)) return;

        var isLeft = tab.hasAttribute('data-v6-ltab');
        var name = tab.getAttribute(isLeft ? 'data-v6-ltab' : 'data-v6-rtab');
        var body = main.querySelector(isLeft ? '[data-v6-lbody]' : '[data-v6-rbody]');

        if (!body) return;

        if (isLeft) {
          if (root.classList.contains('v6-left-dock-collapsed')) {
            root.classList.remove('v6-left-dock-collapsed');
            var toggle = main.querySelector('[data-v6-left-dock-toggle]');
            if (toggle) { toggle.innerHTML = '&#10095;'; toggle.title = 'Collapse left dock'; }
            var leftCol = main.querySelector('[data-v6-left-col]');
            if (leftCol) {
              var saved = localStorage.getItem('cockpitV6.leftColWidth');
              if (saved) { var w = parseInt(saved, 10); if (w > 0) { leftCol.style.width = w + 'px'; leftCol.style.flex = '0 0 ' + w + 'px'; } }
            }
            if (store && store.updateSettings) store.updateSettings({ leftDockCollapsed: false });
          }
        } else {
          if (root.classList.contains('v6-dock-collapsed')) {
            root.classList.remove('v6-dock-collapsed');
            var toggle = main.querySelector('[data-v6-dock-toggle]');
            if (toggle) { toggle.innerHTML = '&#10094;'; toggle.title = 'Collapse dock'; }
            var rightCol = main.querySelector('[data-v6-right-col]');
            if (rightCol) {
              var saved = localStorage.getItem('cockpitV6.rightColWidth');
              if (saved) { var w = parseInt(saved, 10); if (w > 0) { rightCol.style.width = w + 'px'; rightCol.style.flex = '0 0 ' + w + 'px'; } }
            }
            if (store && store.updateSettings) store.updateSettings({ dockCollapsed: false });
          }
        }

        body.className = 'v6-' + (isLeft ? 'l' : 'r') + 'body show-' + name;
        Array.prototype.forEach.call(main.querySelectorAll(isLeft ? '[data-v6-ltab]' : '[data-v6-rtab]'), function (b) {
          var active = b === tab;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', String(active));
        });

        if (store && store.updateSettings) {
          var nextSettings = {};
          nextSettings[isLeft ? 'activeLeftTab' : 'activeTab'] = name;

          var curSchema = (store.getState().settings || {}).layoutSchema || DEFAULT_SCHEMA;
          var nextSchema = Object.assign({}, curSchema);
          if (isLeft) nextSchema.activeLeftTab = name;
          else nextSchema.activeRightTab = name;
          nextSettings.layoutSchema = nextSchema;

          store.updateSettings(nextSettings);
        }

        var cv = root.querySelector('[data-v6-chart]');
        if (cv && V6OF.CanvasChart && store) {
          requestAnimationFrame(function () { V6OF.CanvasChart.draw(cv, store.getState()); });
        }
      });

      cvdStrip = root.querySelector('[data-v6-cvd-strip]') || cvdStrip;

      // openDockTab must be defined unconditionally so the gear button (073)
      // can call V6OF.Page.Shell.openDockTab even when cvdStrip is absent.
      function openDockTab(name) {
        var settings = store && store.getState ? store.getState().settings || {} : {};
        var currentSchema = settings.layoutSchema || DEFAULT_SCHEMA;
        var left = currentSchema.left || [];
        var isLeft = left.indexOf(name) !== -1;

        if (isLeft) {
          root.classList.remove('v6-left-dock-collapsed');
          var leftCol = main.querySelector('[data-v6-left-col]');
          if (leftCol) {
            var saved = localStorage.getItem('cockpitV6.leftColWidth');
            if (saved) { var w = parseInt(saved, 10); if (w > 0) { leftCol.style.width = w + 'px'; leftCol.style.flex = '0 0 ' + w + 'px'; } }
          }
          var lbody = main.querySelector('[data-v6-lbody]');
          if (lbody) lbody.className = 'v6-lbody show-' + name;
          Array.prototype.forEach.call(main.querySelectorAll('[data-v6-ltab]'), function (b) {
            var active = b.getAttribute('data-v6-ltab') === name;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-selected', String(active));
          });
          if (store && store.updateSettings) {
            var nextSchema = Object.assign({}, currentSchema, { activeLeftTab: name });
            store.updateSettings({ leftDockCollapsed: false, layoutSchema: nextSchema });
          }
        } else {
          root.classList.remove('v6-dock-collapsed');
          var rightCol = main.querySelector('[data-v6-right-col]');
          if (rightCol) {
            var saved = localStorage.getItem('cockpitV6.rightColWidth');
            if (saved) { var w = parseInt(saved, 10); if (w > 0) { rightCol.style.width = w + 'px'; rightCol.style.flex = '0 0 ' + w + 'px'; } }
          }
          var rbody = main.querySelector('[data-v6-rbody]');
          if (rbody) rbody.className = 'v6-rbody show-' + name;
          Array.prototype.forEach.call(main.querySelectorAll('[data-v6-rtab]'), function (b) {
            var active = b.getAttribute('data-v6-rtab') === name;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-selected', String(active));
          });
          if (store && store.updateSettings) {
            var nextSchema = Object.assign({}, currentSchema, { activeRightTab: name });
            store.updateSettings({ dockCollapsed: false, layoutSchema: nextSchema, activeTab: name });
          }
        }
        // redrawCvdAndChart is defined inside if(cvdStrip) — guard the call
        if (typeof redrawCvdAndChart === 'function') redrawCvdAndChart();
      }

      // Expose unconditionally for cross-module use (e.g. the gear button in 073)
      if (V6OF.Page && V6OF.Page.Shell) {
        V6OF.Page.Shell.openDockTab = openDockTab;
      }

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
            var cvdVisible = cvdStrip &&
              !cvdStrip.classList.contains('is-collapsed') &&
              !cvdStrip.classList.contains('is-removed');
            if (canvas) canvas._v6suppressBottomGutter = !!cvdVisible;
            if (canvas && V6OF.CanvasChart) V6OF.CanvasChart.draw(canvas, current);
            if (cvdCanvas && V6OF.CvdPanel && cvdVisible) {
              var sharedVp = canvas && canvas._v6vp;
              V6OF.CvdPanel.draw(cvdCanvas, current, sharedVp, {
                crosshairTs: V6OF.chart && V6OF.chart.crosshairTs,
                showTimeAxis: true,
                timeAxisHeight: 20
              });
            }
          });
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
            if (!sameSlice('cvdChrome', cvdChromeSlice)) {
              queueRender(root, 'chrome-cvd', function () {
                applyCvdChrome(state);
              });
            }

            var cvdDrawSlice = {
              deltaIntervalMs: settings.deltaIntervalMs,
              deltaBuckets: state && state.deltaBuckets,
              latestDeltaByInterval: state && state.latestDeltaByInterval,
              showCVD: settings.showCVD !== false,
              cvdCollapsed: !!settings.cvdCollapsed
            };
            if (!sameSlice('cvdDraw', cvdDrawSlice) && cvdCanvas && V6OF.CvdPanel && !cvdStrip.classList.contains('is-collapsed') && !cvdStrip.classList.contains('is-removed')) {
              queueRender(root, 'cvd', function () {
                if (cvdStrip.classList.contains('is-collapsed') || cvdStrip.classList.contains('is-removed')) return;
                var sharedVp2 = canvas && canvas._v6vp;
                V6OF.CvdPanel.draw(cvdCanvas, state, sharedVp2, {
                  crosshairTs: V6OF.chart && V6OF.chart.crosshairTs,
                  showTimeAxis: true,
                  timeAxisHeight: 20
                });
              });
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
                queueRender(root, 'inspector', function () {
                  V6OF.Inspector.renderInto(root, state);
                });
              }
            }
            if (V6OF.ReplayTimeline) {
              var replaySlice = { replay: state && state.replay };
              if (!sameSlice('replay', replaySlice)) {
                queueRender(root, 'chrome-replay', function () {
                  V6OF.ReplayTimeline.renderInto(root, state);
                });
              }
            }
            if (V6OF.IndicatorPanel) {
              var indicatorsSlice = (settings.indicators || []).map(function (i) {
                return i.instanceId + ':' + i.name + ':' + i.height + ':' + i.visible + ':' + i.pane;
              }).join('|');
              if (!sameSlice('indicators', indicatorsSlice)) {
                queueRender(root, 'indicators-panes', function () {
                  V6OF.IndicatorPanel.renderPanes(root, state);
                  V6OF.IndicatorPanel.renderInto(root, state);
                });
              }
            }
            var layoutSlice = {
              left: (settings.layoutSchema && settings.layoutSchema.left) || [],
              right: (settings.layoutSchema && settings.layoutSchema.right) || [],
              activeLeftTab: (settings.layoutSchema && settings.layoutSchema.activeLeftTab) || '',
              activeRightTab: (settings.layoutSchema && settings.layoutSchema.activeRightTab) || '',
              showTape: settings.showTape !== false,
              showDOM: settings.showDOM !== false,
              showCVD: settings.showCVD !== false
            };
            if (!sameSlice('layoutSchema', layoutSlice)) {
              queueRender(root, 'layout-schema', function () {
                var nextSchema = settings.layoutSchema || DEFAULT_SCHEMA;
                applySchema(root, nextSchema, settings);
              });
            }
          });
          redrawCvdAndChart();
        }
      }

      // panel-close delegation: ✕ buttons in panel headers remove panel from layoutSchema
      root.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-v6-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-v6-action');
        if (action === 'panel-close') {
          var closedPanel = btn.closest('[data-v6-panel]');
          var closedId = closedPanel && closedPanel.getAttribute('data-v6-panel');
          if (closedId && store) {
            var curSchema = (store.getState().settings || {}).layoutSchema || DEFAULT_SCHEMA;
            var nextSchema = Object.assign({}, curSchema, {
              left: (curSchema.left || []).filter(function (id) { return id !== closedId; }),
              right: (curSchema.right || []).filter(function (id) { return id !== closedId; })
            });
            if (nextSchema.activeRightTab === closedId) {
              nextSchema.activeRightTab = nextSchema.right[0] || '';
            }
            if (nextSchema.activeLeftTab === closedId) {
              nextSchema.activeLeftTab = nextSchema.left[0] || '';
            }
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

      if (V6OF.ResizablePanels) {
        V6OF.ResizablePanels.init(root);
      }
      if (V6OF.LayoutPicker) {
        V6OF.LayoutPicker.init(root, store);
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
