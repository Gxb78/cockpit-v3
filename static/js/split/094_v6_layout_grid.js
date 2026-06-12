// 094_v6_layout_grid.js
// Multi-chart tiling layout: header "▦" picker (chart-grid presets + SYNC
// toggles), and a CSS-grid of chart cells inside .v6-center-chart.
//
// SCOPE / HONESTY NOTES (read before extending):
// - The chart renderer (077_v6_canvas_chart.js) keeps ONE shared viewport
//   singleton on V6OF.chart (pan/zoom/crosshair state) and the data layer
//   (071/078) is single-symbol + single-active-timeframe (state.timeframe,
//   state.chartCandles). Per-cell independent symbol/interval would require
//   per-canvas viewport instances and per-interval candle streams — out of
//   scope for this MVP per the task brief.
// - Every grid cell therefore renders the SAME chart (same symbol, same
//   timeframe, same candle/footprint/heatmap data) via the existing
//   V6OF.CanvasChart.draw(canvas, state) + V6OF.ChartInteractions.attach().
//   Because the viewport (V6OF.chart) and crosshair timestamp are shared
//   singletons, panning/zooming/crosshair on ANY cell is automatically
//   reflected on all cells — i.e. SYNC Crosshair is effectively always-on
//   and the toggle is informational only (kept, but does not change
//   behaviour). This is reported in the task summary.
// - Per-cell interval selection and SYNC Interval are NOT implemented for
//   the same reason (no per-cell candle stream). The toggle is persisted
//   but is a documented no-op.
// - SYNC Symbol is a no-op because the store is single-symbol already (all
//   cells always show the same symbol).

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

  var DEFAULT_LAYOUT = {
    preset: 'single',
    sync: { symbol: true, interval: false, crosshair: true },
    cells: ['chart', 'chart', 'chart', 'chart']
  };

  // Modules that can be placed into a grid cell. 'chart' renders a chart
  // canvas (the existing behaviour); the others are single-instance panels
  // re-homed (moved) from the dock / another cell into the cell body.
  var MODULE_ORDER = ['chart', 'dom', 'tape', 'orderbook', 'info'];
  var MODULE_LABELS = { chart: 'Chart', dom: 'DOM', tape: 'Tape', orderbook: 'Orderbook', info: 'Info' };

  // Preset -> number of chart cells + grid-template.
  var PRESETS = {
    single:   { cells: 1, cls: 'v6-grid-single' },
    vsplit:   { cells: 2, cls: 'v6-grid-vsplit' },   // 2 columns
    hsplit:   { cells: 2, cls: 'v6-grid-hsplit' },   // 2 rows
    onePlus2: { cells: 3, cls: 'v6-grid-one-plus-two' },
    grid2x2:  { cells: 4, cls: 'v6-grid-2x2' }
  };

  var PRESET_ORDER = ['single', 'vsplit', 'hsplit', 'onePlus2', 'grid2x2'];

  var PRESET_LABELS = {
    single: 'Single', vsplit: 'Vertical', hsplit: 'Horizontal',
    onePlus2: '1 + 2', grid2x2: '2 x 2'
  };

  var PRESET_SVGS = {
    single:   '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="14" height="10" rx="1"/></svg>',
    vsplit:   '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="6.5" height="10" rx="1"/><rect x="8.5" y="1" width="6.5" height="10" rx="1"/></svg>',
    hsplit:   '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="14" height="4.5" rx="1"/><rect x="1" y="6.5" width="14" height="4.5" rx="1"/></svg>',
    onePlus2: '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="8.5" height="10" rx="1"/><rect x="10.5" y="1" width="4.5" height="4.5" rx="1"/><rect x="10.5" y="6.5" width="4.5" height="4.5" rx="1"/></svg>',
    grid2x2:  '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="6.5" height="4.5" rx="1"/><rect x="8.5" y="1" width="6.5" height="4.5" rx="1"/><rect x="1" y="6.5" width="6.5" height="4.5" rx="1"/><rect x="8.5" y="6.5" width="6.5" height="4.5" rx="1"/></svg>'
  };

  var _root = null;
  var _store = null;
  var _popover = null;
  var _popoverAnchor = null;
  var _gridEl = null;       // .v6-chart-grid container
  var _primaryCell = null;  // wrapper holding the original .v6-panel-chart
  var _extraCanvases = [];  // canvases for cells 2..N
  var _primaryCanvas = null; // cached [data-v6-chart] node (stable across re-parenting)
  var _resizeObserver = null;

  // Pop-out window bookkeeping: cellIndex -> { win, channel, unsubscribe }
  var _poppedCells = {};
  var POPOUT_CHANNEL = 'cockpitV6-orderflow';

  function normalizeCells(cells) {
    var out = (cells || []).slice(0, 4);
    while (out.length < 4) out.push('chart');
    return out.map(function (m) { return MODULE_ORDER.indexOf(m) !== -1 ? m : 'chart'; });
  }

  function getLayout() {
    var state = _store && _store.getState ? _store.getState() : {};
    var layout = (state.settings || {}).chartLayout;
    var base;
    if (!layout || !PRESETS[layout.preset]) {
      base = Object.assign({}, DEFAULT_LAYOUT, layout || {}, { preset: (layout && PRESETS[layout.preset]) ? layout.preset : 'single' });
    } else {
      base = Object.assign({}, DEFAULT_LAYOUT, layout, { sync: Object.assign({}, DEFAULT_LAYOUT.sync, layout.sync || {}) });
    }
    base.cells = normalizeCells(base.cells);
    return base;
  }

  function setLayout(patch) {
    if (!_store || !_store.updateSettings) return;
    var cur = getLayout();
    var next = Object.assign({}, cur, patch);
    next.sync = Object.assign({}, cur.sync, patch.sync || {});
    if (patch.cells) next.cells = normalizeCells(patch.cells);
    _store.updateSettings({ chartLayout: next });
  }

  // ---------------------------------------------------------------------
  // Popover (chart layout presets + pop-out button).
  // STANDARD (5 presets) + MONITOR (pop-out action).
  // SYNC toggles removed (all no-ops: symbol/interval/crosshair always shared).
  // ────────────────────────────────────────────────────────────────────────

  function popoverHtml(layout) {
    var presetBtns = PRESET_ORDER.map(function (key) {
      var active = layout.preset === key ? ' is-active' : '';
      return '<button type="button" class="v6-cgp-preset' + active + '" data-v6-grid-preset="' + key + '" title="' + PRESET_LABELS[key] + '">' +
        '<span class="v6-cgp-preset-thumb">' + PRESET_SVGS[key] + '</span>' +
        '<span class="v6-cgp-preset-label">' + PRESET_LABELS[key] + '</span></button>';
    }).join('');

    var syncRows = ['symbol', 'interval', 'crosshair'].map(function (key) {
      var active = sync[key] ? ' is-active' : '';
      return '<button type="button" class="v6-cgp-sync-row' + active + '" data-v6-grid-sync="' + key + '" role="switch" aria-checked="' + (sync[key] ? 'true' : 'false') + '">' +
        '<span class="v6-cgp-sync-label">' + SYNC_LABELS[key] + '</span>' +
        '<span class="v6-cgp-switch"><span class="v6-cgp-switch-knob"></span></span>' +
        '</button>';
    }).join('');

    return [
      '<div class="v6-cgp-popover" data-v6-grid-popover>',
        '<div class="v6-cgp-section">',
          '<div class="v6-cgp-section-title">STANDARD</div>',
          '<div class="v6-cgp-presets">', presetBtns, '</div>',
        '</div>',
        '<div class="v6-cgp-sep"></div>',
        '<div class="v6-cgp-section">',
          '<div class="v6-cgp-section-title">MONITOR</div>',
          '<div class="v6-cgp-monitors">',
            '<button type="button" class="v6-cgp-monitor" data-v6-grid-popout-new title="Pop the active layout out into a separate browser window">',
              '<span class="v6-cgp-monitor-thumb">⤢</span>',
              '<span class="v6-cgp-monitor-label">New window</span>',
            '</button>',
          '</div>',
          '<div class="v6-cgp-note">Browsers cannot detect physical monitors — &quot;New window&quot; pops the chart out into a separate, detached browser window you can drag to another screen.</div>',
        '</div>',
      '</div>'
    ].join('');
  }

  function rerenderPopover() {
    if (!_popover || !_popover.parentNode) return;
    var div = document.createElement('div');
    div.innerHTML = popoverHtml(getLayout());
    var next = div.firstElementChild;
    next.addEventListener('click', handlePopoverClick);
    _popover.parentNode.replaceChild(next, _popover);
    _popover = next;
    positionPopover(_popoverAnchor);
  }

  function handlePopoverClick(e) {
    var presetBtn = e.target.closest('[data-v6-grid-preset]');
    var popoutNewBtn = e.target.closest('[data-v6-grid-popout-new]');

    if (presetBtn) {
      var preset = presetBtn.getAttribute('data-v6-grid-preset');
      setLayout({ preset: preset });
      rerenderPopover();
      applyLayout();
      return;
    }

    if (popoutNewBtn) {
      popOutCell(0);
      closePopover();
      return;
    }
  }

  function openPopover(anchorEl) {
    closePopover();
    // Use centralized popover helper (000_popover_helper.js)
    _popover = V6OF.UI.PopoverHelper.create(popoverHtml(getLayout()));
    _popover.addEventListener('click', handlePopoverClick);
    _popoverAnchor = anchorEl || null;
    // Reposition on viewport change
    var onViewportChange = function() { if (_popover) V6OF.UI.PopoverHelper.position(_popover, _popoverAnchor); };
    // Open with root for design token scoping
    V6OF.UI.PopoverHelper.open(_popover, _root, function() { _popover = null; }, '[data-v6-action="layout-grid-picker"]');
    V6OF.UI.PopoverHelper.position(_popover, anchorEl);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
  }

  function closePopover() {
    if (_popover) {
      V6OF.UI.PopoverHelper.close(_popover);
      _popover = null;
    }
    _popoverAnchor = null;
  }

  // ---------------------------------------------------------------------
  // Grid DOM management
  // ---------------------------------------------------------------------

  // Module IDs that map onto re-homeable single-instance dock panels.
  var PANEL_MODULES = ['dom', 'tape', 'orderbook', 'info'];

  function ensureGridDom() {
    if (_gridEl && _gridEl.isConnected) return _gridEl;
    var center = _root.querySelector('[data-v6-center-chart]');
    if (!center) return null;

    var primaryPanel = center.querySelector('.v6-panel-chart');
    if (!primaryPanel) return null;

    var grid = document.createElement('div');
    grid.className = 'v6-chart-grid';
    grid.setAttribute('data-v6-chart-grid', '');

    // Move the existing chart panel (cell 0) into the grid, wrapped in a cell.
    var primaryCell = document.createElement('div');
    primaryCell.className = 'v6-chart-cell v6-chart-cell-primary';
    primaryCell.setAttribute('data-v6-chart-cell', '0');
    primaryPanel.parentNode.insertBefore(grid, primaryPanel);
    primaryCell.appendChild(primaryPanel);
    grid.appendChild(primaryCell);

    // Wrap the primary chart canvas in a body container so non-chart
    // modules can be moved in/out without disturbing .v6-panel-head.
    var primaryCanvas = primaryPanel.querySelector('[data-v6-chart]');
    if (primaryCanvas && !primaryCanvas.closest('[data-v6-cell-body]')) {
      var body0 = document.createElement('div');
      body0.className = 'v6-chart-cell-body';
      body0.setAttribute('data-v6-cell-body', '0');
      primaryCanvas.parentNode.insertBefore(body0, primaryCanvas);
      body0.appendChild(primaryCanvas);
    }

    // Inject the module selector into the primary panel's head.
    var head0 = primaryPanel.querySelector('.v6-panel-head');
    if (head0 && !head0.querySelector('[data-v6-cell-module-select]')) {
      head0.insertBefore(buildModuleSelectEl(0), head0.firstChild);
    }
    if (head0 && !head0.querySelector('[data-v6-cell-popout]')) {
      head0.appendChild(buildPopoutBtnEl(0));
    }

    _gridEl = grid;
    _primaryCell = primaryCell;
    return grid;
  }

  function buildPopoutBtnEl(index) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'v6-chart-cell-popout-btn';
    btn.setAttribute('data-v6-cell-popout', String(index));
    btn.setAttribute('title', 'Open this panel in a new window');
    btn.setAttribute('aria-label', 'Open this panel in a new window');
    btn.textContent = '⤢';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      popOutCell(index);
    });
    return btn;
  }

  function buildModuleSelectEl(index) {
    var sel = document.createElement('select');
    sel.className = 'v6-chart-cell-module-select';
    sel.setAttribute('data-v6-cell-module-select', String(index));
    sel.setAttribute('aria-label', 'Cell ' + (index + 1) + ' module');
    MODULE_ORDER.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m;
      opt.textContent = MODULE_LABELS[m];
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      setCellModule(index, sel.value);
    });
    sel.addEventListener('click', function (e) { e.stopPropagation(); });
    return sel;
  }

  function makeExtraCellHtml(index) {
    return [
      '<div class="v6-chart-cell" data-v6-chart-cell="' + index + '">',
        '<div class="v6-chart-cell-head">',
          '<span class="v6-chart-cell-label" data-v6-chart-cell-label>Chart ' + (index + 1) + '</span>',
          '<span class="v6-chart-cell-sub" data-v6-chart-cell-sub>same symbol &middot; same interval</span>',
        '</div>',
        '<div class="v6-chart-cell-body" data-v6-cell-body="' + index + '">',
          '<canvas class="v6-chart-canvas v6-grid-cell-canvas" data-v6-grid-cell-canvas data-v6-cell-index="' + index + '"></canvas>',
        '</div>',
      '</div>'
    ].join('');
  }

  // Move a panel node that is being evicted from a doomed cell back to the
  // dock so it remains live and the dock can reclaim it on its next render.
  function returnPanelToDock(panelNode) {
    if (!panelNode || !_root) return;
    var dockBody = _root.querySelector('[data-v6-rbody]') || _root.querySelector('[data-v6-lbody]');
    if (dockBody) dockBody.appendChild(panelNode);
  }

  function destroyExtraCells() {
    if (!_gridEl) { _extraCanvases = []; return; }
    var cells = Array.prototype.slice.call(_gridEl.querySelectorAll('[data-v6-chart-cell]'));
    cells.forEach(function (cell) {
      var idx = parseInt(cell.getAttribute('data-v6-chart-cell'), 10);
      if (idx === 0) return; // primary cell is never destroyed
      // Evict any re-homed panel back to the dock before removing the cell.
      var panelNode = cell.querySelector('[data-v6-panel]');
      if (panelNode) {
        returnPanelToDock(panelNode);
        if (V6OF._gridPlacedPanels) delete V6OF._gridPlacedPanels[panelNode.getAttribute('data-v6-panel')];
      }
      if (cell.parentNode) cell.parentNode.removeChild(cell);
    });
    _extraCanvases = [];
  }

  // Return the dock/cell node currently hosting `module` (a panel id from
  // PANEL_MODULES), searching the whole orderflow root (dock + any cell).
  function findPanelNode(module) {
    if (!_root) return null;
    return _root.querySelector('[data-v6-panel="' + module + '"]');
  }

  function cellBodyEl(index) {
    if (!_gridEl) return null;
    return _gridEl.querySelector('[data-v6-cell-body="' + index + '"]');
  }

  // Off-screen holder for the primary chart canvas when cell 0 hosts a
  // different module. Keeps the canvas (and its bound viewport/interaction
  // singletons) alive in the DOM without rendering it.
  function parkEl() {
    var park = _root.querySelector('[data-v6-chart-park]');
    if (!park) {
      park = document.createElement('div');
      park.setAttribute('data-v6-chart-park', '');
      park.style.display = 'none';
      _root.appendChild(park);
    }
    return park;
  }

  function parkPrimaryCanvas(canvas) {
    parkEl().appendChild(canvas);
  }

  function cellLabelEl(index) {
    if (!_gridEl) return null;
    if (index === 0) {
      var head0 = _gridEl.querySelector('.v6-chart-cell-primary .v6-panel-head');
      return head0 ? head0.querySelector('span') : null;
    }
    var cell = _gridEl.querySelector('[data-v6-chart-cell="' + index + '"]');
    return cell ? cell.querySelector('[data-v6-chart-cell-label]') : null;
  }

  // Move `module` (a panel id) into cell `index`'s body. If the module is
  // currently shown in another cell, that cell falls back to 'chart'
  // (single-instance panels can't be in two places at once — we MOVE).
  function placeModuleInCell(index, module) {
    var layout = getLayout();
    var cells = layout.cells.slice();

    // If another cell currently hosts this module, demote it to 'chart'.
    for (var i = 0; i < cells.length; i++) {
      if (i !== index && cells[i] === module) cells[i] = 'chart';
    }
    cells[index] = module;
    setLayout({ cells: cells });
  }

  function setCellModule(index, module) {
    if (MODULE_ORDER.indexOf(module) === -1) module = 'chart';
    placeModuleInCell(index, module);
    applyLayout();
  }

  // Render the current layout.cells assignment: move panel nodes into / out
  // of cell bodies, restoring chart canvases where module === 'chart'.
  function applyCellModules() {
    var layout = getLayout();
    var cells = layout.cells;
    var preset = PRESETS[layout.preset] || PRESETS.single;
    var activeCount = preset.cells;

    var gridPlaced = V6OF._gridPlacedPanels = V6OF._gridPlacedPanels || {};
    Object.keys(gridPlaced).forEach(function (k) { delete gridPlaced[k]; });

    for (var i = 0; i < activeCount; i++) {
      var module = cells[i] || 'chart';
      var body = cellBodyEl(i);
      if (!body) continue;

      var sel = body.parentNode && body.parentNode.querySelector ?
        (i === 0 ? _root.querySelector('[data-v6-cell-module-select="0"]') : body.parentNode.querySelector('[data-v6-cell-module-select="' + i + '"]')) : null;
      if (sel) sel.value = module;

      // If a panel node is sitting in this body but this cell no longer
      // wants that module, evict it back to the dock first.
      var resident = body.querySelector('[data-v6-panel]');
      if (resident && resident.getAttribute('data-v6-panel') !== module) {
        returnPanelToDock(resident);
        delete gridPlaced[resident.getAttribute('data-v6-panel')];
        resident = null;
      }

      if (module === 'chart') {
        if (i === 0) {
          // Restore the primary chart canvas into cell 0's body if it was
          // parked while another module occupied this cell.
          var primaryCanvas = _root.querySelector('[data-v6-chart]');
          if (primaryCanvas && primaryCanvas.parentNode !== body) {
            body.appendChild(primaryCanvas);
          }
        } else {
          var existingCanvas = body.querySelector('[data-v6-grid-cell-canvas]');
          if (!existingCanvas) {
            var cv = document.createElement('canvas');
            cv.className = 'v6-chart-canvas v6-grid-cell-canvas';
            cv.setAttribute('data-v6-grid-cell-canvas', '');
            cv.setAttribute('data-v6-cell-index', String(i));
            body.appendChild(cv);
            if (V6OF.ChartInteractions) V6OF.ChartInteractions.attach(cv);
          }
        }
        var label = cellLabelEl(i);
        if (label) label.textContent = (i === 0) ? 'Chart' : ('Chart ' + (i + 1));
      } else {
        // Move the single-instance panel into this cell's body.
        var panelNode = findPanelNode(module);
        if (panelNode && panelNode.parentNode !== body) {
          // Park a stray chart canvas (cell 0) or remove a placeholder
          // canvas (other cells) before mounting the panel.
          if (i === 0) {
            var primaryCanvas2 = body.querySelector('[data-v6-chart]');
            if (primaryCanvas2) parkPrimaryCanvas(primaryCanvas2);
          } else {
            var stray = body.querySelector('[data-v6-grid-cell-canvas]');
            if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
          }
          body.appendChild(panelNode);
          panelNode.classList.remove('v6-panel-hidden');
        }
        gridPlaced[module] = i;
        var label2 = cellLabelEl(i);
        if (label2) label2.textContent = MODULE_LABELS[module];
      }
    }

    // Rebuild _extraCanvases (cells 1..N-1 that are still 'chart').
    _extraCanvases = [];
    for (var j = 1; j < activeCount; j++) {
      var b = cellBodyEl(j);
      var cvEl = b && b.querySelector('[data-v6-grid-cell-canvas]');
      if (cvEl) _extraCanvases.push(cvEl);
    }
  }

  function applyLayout() {
    var grid = ensureGridDom();
    if (!grid) return;

    var layout = getLayout();
    var preset = PRESETS[layout.preset] || PRESETS.single;

    // Reset grid layout classes.
    Object.keys(PRESETS).forEach(function (k) { grid.classList.remove(PRESETS[k].cls); });
    grid.classList.add(preset.cls);

    destroyExtraCells();

    // Cells beyond the new preset's count become inactive — reset their
    // module assignment to 'chart' so reactivating them later (via a wider
    // preset) starts fresh rather than pointing at a panel that may now be
    // shown elsewhere.
    var cells = layout.cells.slice();
    var changed = false;
    for (var ci = preset.cells; ci < cells.length; ci++) {
      if (cells[ci] !== 'chart') { cells[ci] = 'chart'; changed = true; }
    }
    if (changed) setLayout({ cells: cells });

    for (var i = 1; i < preset.cells; i++) {
      var holder = document.createElement('div');
      holder.innerHTML = makeExtraCellHtml(i);
      var cellEl = holder.firstElementChild;
      grid.appendChild(cellEl);
      var head = cellEl.querySelector('.v6-chart-cell-head');
      if (head) {
        head.insertBefore(buildModuleSelectEl(i), head.firstChild);
        head.appendChild(buildPopoutBtnEl(i));
      }
      var cv = cellEl.querySelector('[data-v6-grid-cell-canvas]');
      if (cv && V6OF.ChartInteractions) V6OF.ChartInteractions.attach(cv);
    }

    applyCellModules();

    requestAnimationFrame(redrawAll);
  }

  function redrawAll() {
    if (!_store) return;
    var state = _store.getState ? _store.getState() : {};
    var primaryCanvas = _primaryCanvas || (_primaryCanvas = _root.querySelector('[data-v6-chart]'));
    if (primaryCanvas && V6OF.CanvasChart && primaryCanvas.offsetWidth > 0 && primaryCanvas.offsetHeight > 0) {
      V6OF.CanvasChart.draw(primaryCanvas, state);
    }
    _extraCanvases.forEach(function (cv) {
      if (cv && V6OF.CanvasChart && cv.offsetWidth > 0 && cv.offsetHeight > 0) {
        V6OF.CanvasChart.draw(cv, state);
      }
    });
  }

  function setupResizeObserver() {
    if (_resizeObserver) return;
    // Use centralized RAF-batched ResizeObserver from 001_utilities.js
    _resizeObserver = createResizeObserverRaf(redrawAll);
    if (_gridEl) _resizeObserver.observe(_gridEl);
  }

  // ---------------------------------------------------------------------
  // Pop-out windows (one-way mirror: main -> pop-out via BroadcastChannel)
  //
  // SCOPE / HONESTY NOTES:
  // - The pop-out window opens the SAME app at
  //   /?orderflow_popout=<module>&cell=<index>. The bootstrap in
  //   095_v6_popout.js detects the query param, hides the normal shell, and
  //   renders only the requested module full-window.
  // - Sync is ONE-WAY (main -> pop-out). The main window posts
  //   `store.getState()` on every state change over a BroadcastChannel
  //   named 'cockpitV6-orderflow'. The pop-out applies that state directly
  //   to V6OF.CanvasChart.draw() for the chart module — it does NOT open
  //   its own engine connection.
  // - For non-chart modules (DOM/Tape/Orderbook/Info) the pop-out shows an
  //   honest "live mirroring not available for this panel yet" placeholder
  //   with a re-dock button, because those panels are driven by per-module
  //   DOM subscriptions in other files (073/078/090/093) that this MVP does
  //   not duplicate. This is reported in the task summary.
  // - Closing the pop-out (or its tab) sends a 'closed' message back over
  //   the channel so the main window can clear the "popped out" indicator.
  // ---------------------------------------------------------------------
  function popOutCell(index) {
    if (typeof window.open !== 'function') return;
    var layout = getLayout();
    var module = layout.cells[index] || 'chart';

    var url = window.location.pathname + '?orderflow_popout=' + encodeURIComponent(module) + '&cell=' + encodeURIComponent(index);
    var win;
    try {
      win = window.open(url, 'v6-popout-' + index, 'width=900,height=640,menubar=no,toolbar=no,location=no');
    } catch (err) {
      win = null;
    }
    if (!win) return;

    var channel = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(POPOUT_CHANNEL);
    } catch (err) {
      channel = null;
    }

    var entry = { win: win, channel: channel, cellIndex: index, module: module };
    _poppedCells[index] = entry;
    markCellPopped(index, true);

    if (channel) {
      var postState = function () {
        if (!_store || !_store.getState) return;
        try {
          channel.postMessage({ type: 'state', cell: index, module: module, state: _store.getState() });
        } catch (err) { /* ignore postMessage failures (non-cloneable state) */ }
      };
      // Initial push, then on every store update while popped.
      postState();
      var unsubscribe = _store && _store.subscribe ? _store.subscribe(postState) : null;

      channel.onmessage = function (ev) {
        var msg = ev && ev.data;
        if (!msg) return;
        if (msg.type === 'closed' && msg.cell === index) {
          reDockCell(index);
        }
      };
      entry.unsubscribe = unsubscribe;
      entry.postState = postState;
    }

    // Fallback: if BroadcastChannel is unavailable, poll for pop-out closure.
    // Check every 5s instead of 1s to reduce CPU overhead (BroadcastChannel preferred).
    // Note: 095 also sends 'closed' message on beforeunload if channel available.
    var poll = setInterval(function () {
      if (win.closed) {
        clearInterval(poll);
        reDockCell(index);
      }
    }, 5000);
    entry.poll = poll;
  }

  function markCellPopped(index, isPopped) {
    var btn;
    if (index === 0) {
      btn = _root && _root.querySelector('[data-v6-cell-popout="0"]');
    } else {
      btn = _gridEl && _gridEl.querySelector('[data-v6-cell-popout="' + index + '"]');
    }
    if (btn) btn.classList.toggle('is-popped', !!isPopped);
  }

  function reDockCell(index) {
    var entry = _poppedCells[index];
    if (!entry) return;
    if (entry.unsubscribe) entry.unsubscribe();
    if (entry.poll) clearInterval(entry.poll);
    if (entry.channel) {
      try { entry.channel.close(); } catch (err) { /* ignore */ }
    }
    if (entry.win && !entry.win.closed) {
      try { entry.win.close(); } catch (err) { /* ignore */ }
    }
    delete _poppedCells[index];
    markCellPopped(index, false);
  }

  // ---------------------------------------------------------------------
  // Header button
  // ---------------------------------------------------------------------
  function injectHeaderButton() {
    var header = _root.querySelector('.v6-header');
    if (!header || header._v6ChartGridBtnMounted) return;
    header._v6ChartGridBtnMounted = true;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'v6-header-grid-btn';
    btn.setAttribute('data-v6-action', 'layout-grid-picker');
    btn.setAttribute('title', 'Chart layout');
    btn.setAttribute('aria-label', 'Chart layout');
    btn.textContent = '▦'; // ▦

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (_popover) { closePopover(); return; }
      openPopover(btn);
    });

    var headerActions = header.querySelector('.v6-header-actions');
    if (headerActions) {
      headerActions.insertBefore(btn, headerActions.firstChild);
    } else {
      header.appendChild(btn);
    }
  }

  // ---------------------------------------------------------------------
  // Public init
  // ---------------------------------------------------------------------
  V6OF.register('UI', 'ChartLayoutGrid', {
    init: function (root, store) {
      if (!root) return;
      _root = root;
      _store = store;

      injectHeaderButton();
      applyLayout();
      setupResizeObserver();

      if (store && store.subscribe) {
        var lastPreset = null;
        var lastCellsKey = null;
        var lastKey = null;
        store.subscribe(function (state) {
          var settings = (state && state.settings) || {};
          var layout = settings.chartLayout || DEFAULT_LAYOUT;
          var cellsKey = (layout.cells || []).join(',');
          var key = layout.preset + '|' + cellsKey + '|' + state.timeframe + '|' + ((state.chartCandles || []).length);
          if (key === lastKey) return;
          var presetChanged = lastKey === null || layout.preset !== lastPreset;
          var cellsChanged = lastKey === null || cellsKey !== lastCellsKey;
          lastKey = key;
          lastPreset = layout.preset;
          lastCellsKey = cellsKey;
          if (presetChanged) {
            applyLayout();
          } else if (cellsChanged) {
            applyCellModules();
            requestAnimationFrame(redrawAll);
          } else {
            requestAnimationFrame(redrawAll);
          }
        });
      }
    },
    open: openPopover,
    close: closePopover,
    redraw: redrawAll
  }, 'ChartLayoutGrid');
})();
