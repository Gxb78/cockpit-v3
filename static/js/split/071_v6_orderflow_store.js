// ---------- 071_v6_orderflow_store.js ----------
// Minimal observable store for the isolated Cockpit V6 mock surface.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  function cloneSettings(settings) {
    return Object.assign({}, settings || {});
  }

  function cloneUi(ui) {
    return Object.assign({}, ui || {});
  }

  function cloneObjectMap(value) {
    return Object.assign({}, value || {});
  }

  function normalizeState(next) {
    var empty = V6OF.Contract.createEmptyState();
    next = next || {};
    next.settings = Object.assign(empty.settings, cloneSettings(next.settings));
    next.ui = Object.assign(empty.ui, cloneUi(next.ui));
    next.trades = Array.isArray(next.trades) ? next.trades : [];
    next.candles = Array.isArray(next.candles) ? next.candles : [];
    next.chartCandles = Array.isArray(next.chartCandles) ? next.chartCandles : [];
    next._candlesByInterval = next._candlesByInterval || {};
    next.deltaBuckets = Array.isArray(next.deltaBuckets) ? next.deltaBuckets : [];
    next.deltaBucketsByInterval = cloneObjectMap(next.deltaBucketsByInterval || empty.deltaBucketsByInterval);
    next.latestDeltaByInterval = cloneObjectMap(next.latestDeltaByInterval || empty.latestDeltaByInterval);
    next.orderBook = next.orderBook || null;
    next.lastOrderBookBySymbol = cloneObjectMap(next.lastOrderBookBySymbol || empty.lastOrderBookBySymbol);
    next.orderBookCount = Number.isFinite(next.orderBookCount) ? next.orderBookCount : 0;
    next.lastOrderBookTs = Number.isFinite(next.lastOrderBookTs) ? next.lastOrderBookTs : 0;
    next.selectedDomSymbol = next.selectedDomSymbol || empty.selectedDomSymbol;
    next.heatmapFrames = Array.isArray(next.heatmapFrames) ? next.heatmapFrames : [];
    next.heatmapFrameCount = Number.isFinite(next.heatmapFrameCount) ? next.heatmapFrameCount : 0;
    next.lastHeatmapFrame = next.lastHeatmapFrame || null;
    next.lastHeatmapTs = Number.isFinite(next.lastHeatmapTs) ? next.lastHeatmapTs : 0;
    next.selectedHeatmapSymbol = next.selectedHeatmapSymbol || empty.selectedHeatmapSymbol;
    next.footprintCandles = Array.isArray(next.footprintCandles) ? next.footprintCandles : [];
    next.footprintCandleCount = Number.isFinite(next.footprintCandleCount) ? next.footprintCandleCount : 0;
    next.lastFootprintCandle = next.lastFootprintCandle || null;
    next.lastFootprintTs = Number.isFinite(next.lastFootprintTs) ? next.lastFootprintTs : 0;
    next.selectedFootprintSymbol = next.selectedFootprintSymbol || empty.selectedFootprintSymbol;
    next.vwap = next.vwap || null;
    next.vwapBySymbol = cloneObjectMap(next.vwapBySymbol || empty.vwapBySymbol);
    next.lastMessageAt = Number.isFinite(next.lastMessageAt) ? next.lastMessageAt : 0;
    next.isStale = !!next.isStale;
    next.contractVersion = next.contractVersion || empty.contractVersion;
    next.source = next.source || empty.source;
    next.symbol = next.symbol || empty.symbol;
    next.timeframe = next.timeframe || empty.timeframe;
    next.depthHistory = Array.isArray(next.depthHistory) ? next.depthHistory : [];
    return next;
  }

  V6OF.createStore = function (initialState) {
    var state = normalizeState(initialState || V6OF.Contract.createEmptyState());
    var listeners = [];

    function notify() {
      listeners.slice().forEach(function (fn) {
        try { fn(state); } catch (err) { console.error('[V6OF] store listener failed', err); }
      });
    }

    return {
      getState: function () {
        return state;
      },
      setState: function (patch, reason) {
        var next = typeof patch === 'function' ? patch(state) : patch;
        if (!next) return state;
        state = normalizeState(Object.assign({}, state, next));
        state.lastUpdateReason = reason || 'setState';
        notify();
        return state;
      },
      updateSettings: function (patch) {
        this.setState({ settings: Object.assign({}, state.settings, patch || {}) }, 'settings');
      },
      updateUi: function (patch) {
        this.setState({ ui: Object.assign({}, state.ui, patch || {}) }, 'ui');
      },
      clearHeatmap: function () {
        this.setState({
          heatmapFrames: [],
          lastHeatmapFrame: null,
          lastHeatmapTs: 0
        }, 'clear-heatmap');
      },
      clearFootprint: function () {
        this.setState({
          footprintCandles: [],
          lastFootprintCandle: null,
          lastFootprintTs: 0
        }, 'clear-footprint');
      },
      clearAllBuffers: function () {
        this.setState({
          trades: [],
          heatmapFrames: [],
          lastHeatmapFrame: null,
          lastHeatmapTs: 0,
          footprintCandles: [],
          lastFootprintCandle: null,
          lastFootprintTs: 0
        }, 'clear-all-buffers');
      },
      subscribe: function (fn) {
        if (typeof fn !== 'function') return function () {};
        listeners.push(fn);
        return function () {
          listeners = listeners.filter(function (item) { return item !== fn; });
        };
      }
    };
  };
})();
