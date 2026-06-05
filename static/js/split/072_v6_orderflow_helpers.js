// ---------- 072_v6_orderflow_helpers.js ----------
// Shared UI helpers for the V6 orderflow surface.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

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

  V6OF.OrderflowSelectors = {
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
        domWallRatio: Number(s.domWallRatio || 4),
        domWallsOnly: s.domWallsOnly === true,
        domValueMode: s.domValueMode || 'coin',
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
        showCandles: s.showCandles !== false,
        showBubbles: s.showBubbles === true,
        showHeatmap: s.showHeatmap === true,
        showFootprint: s.showFootprint === true,
        showLastPrice: s.showLastPrice !== false,
        showGrid: s.showGrid !== false,
        bgColor: s.bgColor,
        upColor: s.upColor,
        downColor: s.downColor,
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
  };

  V6OF.RenderScheduler = {
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
  };

  V6OF.VirtualList = {
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
  };
})();
