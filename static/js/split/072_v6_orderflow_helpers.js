// ---------- 072_v6_orderflow_helpers.js ----------
// Shared UI helpers for the V6 orderflow surface.

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

  function shallow(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    var ak = Object.keys(a);
    var bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (var i = 0; i < ak.length; i++) {
      var k = ak[i];
      if (!Object.prototype.hasOwnProperty.call(b, k) || a[k] !== b[k]) return false;
    }
    return true;
  }

  V6OF.register('Data', 'Selectors', {
    tape: function (state) {
      var s = (state && state.settings) || {};
      return {
        trades: state && state.trades,
        minQty: Number(s.minQty || 0),
        maxRows: Number(s.maxRows || 420),
        tapeFontSize: Number(s.tapeFontSize || 10),
        showTape: s.showTape !== false
      };
    },
    dom: function (state, ladder) {
      var s = (state && state.settings) || {};
      return {
        ladderLevels: ladder && ladder.levels,
        ladderUpdate: ladder && (ladder.lastUpdate || ladder.tsLocal || 0),
        orderBookCount: state && state.orderBookCount,
        lastOrderBookTs: state && state.lastOrderBookTs,
        selectedDomSymbol: state && state.selectedDomSymbol,
        symbol: state && state.symbol,
        domRangeLevels: Number(s.domRangeLevels || 1000),
        domValueMode: s.domValueMode || 'coin',
        domColumns: s.domColumns || ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs'],
        domSoftWallPercentile: Number(s.domSoftWallPercentile || 0.85),
        domMajorWallPercentile: Number(s.domMajorWallPercentile || 0.95),
        showDOM: s.showDOM !== false
      };
    },
    chart: function (state) {
      var s = (state && state.settings) || {};
      return {
        chartCandles: state && state.chartCandles,
        trades: state && state.trades,
        heatmapFrames: state && state.heatmapFrames,
        footprintCandles: state && state.footprintCandles,
        vwap: state && state.vwap,
        activeCandleOpenTime: state && state.ui && state.ui.activeCandleOpenTime,
        activeCandleLocked: state && state.ui && state.ui.activeCandleLocked,
        isStale: !!(state && state.isStale),
        journalTrades: state && state.journalTrades,
        replayEvents: state && state.replayEvents,
        replay: state && state.replay,
        markers: s.markers,
        showCandles: s.showCandles !== false,
        showBubbles: s.showBubbles === true,
        showHeatmap: s.showHeatmap === true,
        showFootprint: s.showFootprint === true,
        showLastPrice: s.showLastPrice !== false,
        showGrid: s.showGrid !== false,
        bgColor: s.bgColor,
        upColor: s.upColor,
        downColor: s.downColor,
        showVolumeProfile: s.showVolumeProfile === true,
        volumeProfileType: s.volumeProfileType || 'visible',
        volumeProfileSide: s.volumeProfileSide || 'right',
        volumeProfileStyle: s.volumeProfileStyle || 'volume',
        volumeProfileValueArea: s.volumeProfileValueArea || 70,
        volumeProfileFixedStart: s.volumeProfileFixedStart || 0,
        volumeProfileFixedEnd: s.volumeProfileFixedEnd || 0,
        volumeProfileShowPocTrail: s.volumeProfileShowPocTrail === true,
        indicatorsKey: JSON.stringify((s.indicators || []).map(function (it) {
          return [it.instanceId, it.sourceId, it.visible, it.pane, it.name, JSON.stringify(it.inputs || {})].join(':');
        })),
        indicatorSourcesKey: JSON.stringify((s.indicatorSources || []).map(function (src) {
          return [src.sourceId, src.updatedAt].join(':');
        }))
      };
    },
    cvd: function (state) {
      var s = (state && state.settings) || {};
      return {
        deltaIntervalMs: Number(s.deltaIntervalMs || 60000),
        deltaBuckets: state && state.deltaBuckets,
        latestDeltaByInterval: state && state.latestDeltaByInterval,
        source: state && state.source,
        dataFreshness: state && state.dataFreshness,
        transportStatus: state && state.transportStatus,
        showCVD: s.showCVD !== false
      };
    }
  }, 'OrderflowSelectors');

  // ── Central settings schema + resolver — single source of truth ──
  // Every setting key defined once: type, default, boolean resolution rule,
  // allowed values / numeric bounds. All consumers use resolveSettings().

  var SETTINGS_SCHEMA = {
    // ── Boolean toggles: on-by-default = truthy unless explicitly false ──
    showTape:       { type: 'bool', default: true,  on: true },
    showDOM:        { type: 'bool', default: true,  on: true },
    showCVD:        { type: 'bool', default: true,  on: true },
    showVwap:       { type: 'bool', default: true,  on: true },
    showCandles:    { type: 'bool', default: true,  on: true },
    showLastPrice:  { type: 'bool', default: true,  on: true },
    showGrid:       { type: 'bool', default: true,  on: true },
    showSessionZones:{ type: 'bool', default: true, on: true },
    showFootprintVA:{ type: 'bool', default: true,  on: true },
    // ── Boolean toggles: off-by-default = only true when explicitly enabled ──
    showBubbles:    { type: 'bool', default: false, on: false },
    showHeatmap:    { type: 'bool', default: false, on: false },
    showFootprint:  { type: 'bool', default: false, on: false },
    showVolumeProfile: { type: 'bool', default: false, on: false },
    volumeProfileShowPocTrail: { type: 'bool', default: false, on: false },
    // ── Enum ──
    chartMode:      { type: 'enum', default: 'both', values: ['both', 'candles', 'footprint'] },
    sessionProfile: { type: 'enum', default: 'global', values: ['global', 'rth', 'eth'] },
    theme:          { type: 'enum', default: 'light-tv', values: ['light-tv', 'dark-tv'] },
    domValueMode:   { type: 'enum', default: 'coin', values: ['coin', 'notional', 'ticks', 'contracts'] },
    inspectorTimeZoneMode: { type: 'enum', default: 'utc', values: ['utc', 'local', 'exchange'] },
    volumeProfileType: { type: 'enum', default: 'visible', values: ['visible', 'session', 'fixed', 'composite'] },
    volumeProfileSide: { type: 'enum', default: 'right', values: ['left', 'right'] },
    volumeProfileStyle: { type: 'enum', default: 'volume', values: ['volume', 'delta', 'split'] },
    // ── Number with bounds ──
    minQty:         { type: 'number', default: 0,    min: 0 },
    maxRows:         { type: 'number', default: 420,  min: 1, max: 2000 },
    maxTrades:       { type: 'number', default: 5000, min: 100, max: 50000 },
    heatmapMaxFrames:{ type: 'number', default: 3600, min: 60, max: 10000 },
    footprintMaxCandles:{ type: 'number', default: 1200, min: 60, max: 5000 },
    footprintHistoryLookbackMinutes:{ type: 'number', default: 360, min: 1, max: 10080 },
    deltaIntervalMs: { type: 'number', default: 60000, min: 1000, max: 3600000 },
    domDepth:        { type: 'number', default: 1000, min: 10, max: 5000 },
    domRangeLevels:  { type: 'number', default: 1000, min: 10, max: 5000 },
    domSoftWallPercentile:  { type: 'number', default: 0.85,  min: 0.5, max: 0.99 },
    domMajorWallPercentile: { type: 'number', default: 0.95,  min: 0.5, max: 0.999 },
    tickSize:        { type: 'number', default: 1,    min: 0 },
    imbalanceRatio:  { type: 'number', default: 3.0,  min: 1, max: 20 },
    imbalanceStack:  { type: 'number', default: 3,    min: 1, max: 10 },
    imbalanceMinVolume:{ type: 'number', default: 1.0, min: 0 },
    exhaustionFactor:{ type: 'number', default: 0.35, min: 0.05, max: 1 },
    footprintValueAreaPct:{ type: 'number', default: 70, min: 10, max: 90 },
    minWickTicks:    { type: 'number', default: 0,    min: 0 },
    tapeFontSize:    { type: 'number', default: 10,   min: 8, max: 16 },
    singleClickFitLiveDelayMs:{ type: 'number', default: 180, min: 0, max: 2000 },
    volumeProfileValueArea: { type: 'number', default: 70, min: 10, max: 100 },
    volumeProfileFixedStart: { type: 'number', default: 0, min: 0 },
    volumeProfileFixedEnd: { type: 'number', default: 0, min: 0 },
    // ── Passthrough (validated elsewhere or free-form) ──
    bgColor:         { type: 'string', default: '#ffffff' },
    upColor:         { type: 'string', default: '#089981' },
    downColor:       { type: 'string', default: '#f23645' },
    indicators:      { type: 'array',  default: [] },
    indicatorSources:{ type: 'array',  default: [] },
    domColumns:      { type: 'array',  default: ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs'] }
  };

  function resolveSettings(rawSettings, rawUi) {
    var s = rawSettings || {};
    var u = rawUi || {};
    var out = {};

    // Resolve settings from schema
    var keys = Object.keys(SETTINGS_SCHEMA);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var def = SETTINGS_SCHEMA[key];
      var val = s[key];

      if (def.type === 'bool') {
        if (def.on) {
          out[key] = val !== false;
        } else {
          out[key] = val === true;
        }
      } else if (def.type === 'enum') {
        out[key] = (def.values.indexOf(val) >= 0) ? val : def.default;
      } else if (def.type === 'number') {
        var n = Number(val);
        if (!Number.isFinite(n)) n = def.default;
        if (def.min != null && n < def.min) n = def.min;
        if (def.max != null && n > def.max) n = def.max;
        out[key] = n;
      } else if (def.type === 'array') {
        out[key] = Array.isArray(val) ? val : def.default;
      } else {
        // string / passthrough
        out[key] = (val != null) ? val : def.default;
      }
    }

    // ── UI projection (from state.ui, not settings) ──
    out.activeTab = u.activeTab || 'dom';
    out.dockCollapsed = !!u.dockCollapsed;
    out.hoveredCandle = u.hoveredCandle || null;
    out.pinnedCandle = u.pinnedCandle || null;
    out.panelSizes = u.panelSizes || {};
    out.layerPreset = u.layerPreset || 'scalping';
    out.activeIndicatorId = u.activeIndicatorId || '';
    out.indicatorEditorOpen = !!u.indicatorEditorOpen;
    out.indicatorPaneSizes = u.indicatorPaneSizes || {};
    out.indicatorToolbarOpen = u.indicatorToolbarOpen || '';
    out.activeCandleOpenTime = Number.isFinite(u.activeCandleOpenTime) ? u.activeCandleOpenTime : 0;
    out.activeCandleCloseTime = Number.isFinite(u.activeCandleCloseTime) ? u.activeCandleCloseTime : 0;
    out.activeCandleSource = u.activeCandleSource || '';
    out.activeCandleSnapshot = u.activeCandleSnapshot || null;
    out.activeCandleLocked = !!u.activeCandleLocked;
    out.activeCandleUpdatedAt = Number.isFinite(u.activeCandleUpdatedAt) ? u.activeCandleUpdatedAt : 0;
    out.seed = Number.isFinite(u.seed) ? u.seed : 42;

    return out;
  }

  V6OF.register('Data', 'resolveSettings', resolveSettings, 'resolveSettings');
  V6OF.register('Data', 'SETTINGS_SCHEMA', SETTINGS_SCHEMA, 'SETTINGS_SCHEMA');

  V6OF.register('UI', 'RenderScheduler', {
    _pending: false,
    _jobs: {},
    _stats: {},
    queue: function (name, fn) {
      if (typeof fn !== 'function') return;
      this._jobs[name || 'default'] = fn;
      if (this._pending) return;
      var self = this;
      this._pending = true;
      var schedule = typeof requestAnimationFrame === 'function' && !document.hidden
        ? requestAnimationFrame
        : function (cb) { return setTimeout(cb, 33); };
      schedule(function () {
        var jobs = self._jobs;
        self._jobs = {};
        self._pending = false;
        Object.keys(jobs).forEach(function (key) {
          var started = window.performance ? performance.now() : 0;
          try {
            jobs[key]();
          } catch (err) {
            console.error('[V6OF RenderScheduler] job failed:', key, err);
          }
          if (started && window.performance) {
            var ms = performance.now() - started;
            var slot = self._stats[key] || (self._stats[key] = { count: 0, totalMs: 0, lastMs: 0, avgMs: 0 });
            slot.count += 1;
            slot.totalMs += ms;
            slot.lastMs = ms;
            slot.avgMs = slot.totalMs / slot.count;
            slot.updatedAt = Date.now();
          }
        });
        V6OF.renderStats = self._stats;
      });
    }
  }, 'RenderScheduler');

  V6OF.register('UI', 'VirtualList', {
    render: function (host, config) {
      if (!host || !config) return;
      var rows = Array.isArray(config.rows) ? config.rows : [];
      var rowHeight = Math.max(14, Number(config.rowHeight || 20));
      var buffer = Math.max(2, Number(config.buffer || 8));
      var renderRow = config.renderRow;
      if (typeof renderRow !== 'function') return;

      if (!host._v6VirtualBound) {
        host._v6VirtualBound = true;
        host.addEventListener('scroll', function () {
          if (host._v6VirtualRender) host._v6VirtualRender(false);
        }, { passive: true });
        host.addEventListener('wheel', function () {
          host._v6UserScrolledAt = Date.now();
        }, { passive: true });
        host.addEventListener('pointerdown', function () {
          host._v6UserScrolledAt = Date.now();
        }, { passive: true });
      }

      if (!host._v6VirtualShell ||
          !host._v6VirtualShell.spacer ||
          !host.contains(host._v6VirtualShell.spacer) ||
          host._v6VirtualClassName !== (config.className || '')) {
        host._v6VirtualClassName = config.className || '';
        host.innerHTML =
          '<div class="v6-virtual-spacer">' +
            '<div class="v6-virtual-window ' + (config.className || '') + '"></div>' +
          '</div>';
        host._v6VirtualShell = {
          spacer: host.querySelector('.v6-virtual-spacer'),
          win: host.querySelector('.v6-virtual-window')
        };
      }

      var shell = host._v6VirtualShell;
      var wasAtTop = host.scrollTop <= 2;
      var wasAtBottom = Math.abs(host.scrollHeight - host.clientHeight - host.scrollTop) <= 2;
      host._v6VirtualRows = rows;
      host._v6VirtualRenderRow = renderRow;
      host._v6VirtualRowHeight = rowHeight;
      shell.spacer.style.height = Math.max(rowHeight, rows.length * rowHeight) + 'px';

      host._v6VirtualRender = function (preserveEdge) {
        var count = rows.length;
        var viewport = Math.max(rowHeight, host.clientHeight || rowHeight * 20);
        var start = Math.max(0, Math.floor(host.scrollTop / rowHeight) - buffer);
        var visible = Math.ceil(viewport / rowHeight) + buffer * 2;
        var end = Math.min(count, start + visible);
        var html = '';
        for (var i = start; i < end; i++) {
          html += renderRow(rows[i], i);
        }
        shell.win.style.transform = 'translateY(' + (start * rowHeight) + 'px)';
        shell.win.innerHTML = html;
        if (preserveEdge === 'top' && wasAtTop) host.scrollTop = 0;
        if (preserveEdge === 'bottom' && wasAtBottom) host.scrollTop = Math.max(0, host.scrollHeight - host.clientHeight);
      };

      host._v6VirtualRender(config.stickToTop ? 'top' : (config.stickToBottom ? 'bottom' : false));
    },
    same: shallow
  }, 'VirtualList');
})();
