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

  function leftToolbarHtml() {
    return [
      '<div class="v6-left-toolbar">',
        tool('cursor', 'Cursor'),
        tool('crosshair', 'Crosshair'),
        '<div class="v6-tool-sep"></div>',
        tool('fit', 'Fit view'),
        tool('reset', 'Reset view'),
        tool('follow', 'Follow live'),
        '<div class="v6-tool-sep"></div>',
        tool('horiz', 'Horizontal Line (Drawing Placeholder)'),
        tool('trend', 'Trendline (Drawing Placeholder)'),
        tool('rect', 'Rectangle (Drawing Placeholder)'),
      '</div>'
    ].join('');
  }

  function mainAreaHtml() {
    return [
      '<div class="v6-main-area">',
        leftToolbarHtml(),
        '<div class="v6-center-col">',
          '<div class="v6-center-chart" data-v6-center-chart></div>',
          '<div class="v6-resize-v" title="Drag to resize indicator height"></div>',
          '<div class="v6-cvd-strip" data-v6-cvd-strip>',
            '<div class="v6-cvd-strip-head">',
              '<span class="v6-cvd-strip-title">CVD · Delta</span>',
              '<button type="button" class="v6-cvd-collapse" data-v6-cvd-collapse aria-label="Toggle CVD">▾</button>',
            '</div>',
            '<canvas class="v6-cvd-canvas" data-v6-cvd-canvas></canvas>',
          '</div>',
        '</div>',
        '<div class="v6-resize-h" title="Drag to resize right dock width"></div>',
        '<div class="v6-right-col" data-v6-right-col>',
          '<div class="v6-rtabs" data-v6-rtabs>',
            '<button type="button" class="v6-rtab is-active" data-v6-rtab="dom">DOM</button>',
            '<button type="button" class="v6-rtab" data-v6-rtab="tape">Tape</button>',
            '<button type="button" class="v6-rtab v6-rtab-icon" data-v6-dock-toggle title="Collapse dock">&#10094;</button>',
            '<button type="button" class="v6-rtab v6-rtab-icon" data-v6-rtab="settings" title="Settings">⚙</button>',
          '</div>',
          '<div class="v6-rbody show-dom" data-v6-rbody>',
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

  V6OF.Shell = {
    init: function (root) {
      if (!root) return;
      var shell = root.querySelector('.v6-shell');
      var grid = root.querySelector('.v6-grid');
      if (!shell || !grid) return;            // Layout not mounted yet
      if (root.dataset.v6ShellMounted === '1') return;
      root.dataset.v6ShellMounted = '1';

      // Grab existing Layout panels (these contain the live render targets).
      var pTape = root.querySelector('.v6-panel-tape');
      var pChart = root.querySelector('.v6-panel-chart');
      var pDom = root.querySelector('.v6-panel-dom');
      var pSettings = root.querySelector('.v6-panel-settings');
      var pCvd = root.querySelector('.v6-panel-cvd');
      var pVwap = root.querySelector('.v6-panel-vwap');

      // Build the TradingView main area as a detached subtree.
      var holder = document.createElement('div');
      holder.innerHTML = mainAreaHtml();
      var main = holder.querySelector('.v6-main-area');
      var statusBar = holder.querySelector('.v6-status-bar');

      var center = main.querySelector('[data-v6-center-chart]');
      var rbody = main.querySelector('[data-v6-rbody]');

      // Re-home panels (nodes are MOVED, listeners + identity preserved).
      // Chart dominates; the orderflow panels live in a tabbed right column.
      move(center, pChart);
      [pDom, pTape, pSettings].forEach(function (p) { move(rbody, p); });
      if (pCvd) pCvd.classList.add('v6-panel-hidden');
      if (pVwap) pVwap.classList.add('v6-panel-hidden');

      // Swap .v6-grid -> .v6-main-area inside the shell.
      shell.replaceChild(main, grid);
      shell.appendChild(statusBar);
      root.classList.add('v6-shell-tv');

      // Right-column tab switching (DOM / Tape / Settings).
      main.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-v6-rtab]');
        if (!tab || !main.contains(tab)) return;
        var name = tab.getAttribute('data-v6-rtab');
        rbody.className = 'v6-rbody show-' + name;
        Array.prototype.forEach.call(main.querySelectorAll('[data-v6-rtab]'), function (b) {
          b.classList.toggle('is-active', b === tab);
        });
        var cv = root.querySelector('[data-v6-chart]');
        if (cv && V6OF.CanvasChart && V6OF.store) {
          requestAnimationFrame(function () { V6OF.CanvasChart.draw(cv, V6OF.store.getState()); });
        }
      });

      var dockToggle = main.querySelector('[data-v6-dock-toggle]');
      if (dockToggle) {
        dockToggle.addEventListener('click', function () {
          root.classList.toggle('v6-dock-collapsed');
          dockToggle.innerHTML = root.classList.contains('v6-dock-collapsed') ? '&#10095;' : '&#10094;';
          dockToggle.title = root.classList.contains('v6-dock-collapsed') ? 'Expand dock' : 'Collapse dock';
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
      var cvdStrip = root.querySelector('[data-v6-cvd-strip]');
      if (cvdCanvas && V6OF.CvdPanel && V6OF.store) {
        var drawCvd = function () {
          if (cvdStrip && cvdStrip.classList.contains('is-collapsed')) return;
          V6OF.CvdPanel.draw(cvdCanvas, V6OF.store.getState());
        };
        V6OF.store.subscribe(drawCvd);
        requestAnimationFrame(drawCvd);
      }
      if (cvdStrip) {
        var collapseBtn = cvdStrip.querySelector('[data-v6-cvd-collapse]');
        if (collapseBtn) collapseBtn.addEventListener('click', function () {
          cvdStrip.classList.toggle('is-collapsed');
          collapseBtn.textContent = cvdStrip.classList.contains('is-collapsed') ? '▸' : '▾';
          requestAnimationFrame(function () {
            if (canvas && V6OF.CanvasChart && V6OF.store) V6OF.CanvasChart.draw(canvas, V6OF.store.getState());
            if (cvdCanvas && V6OF.CvdPanel && V6OF.store && !cvdStrip.classList.contains('is-collapsed')) V6OF.CvdPanel.draw(cvdCanvas, V6OF.store.getState());
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
