// ---------- 071_v6_orderflow_store.js ----------
// Observable store for the Cockpit V6 orderflow surface.
//
// State domains (see 070_v6_orderflow_contract.js):
//   trader    → store.getTrader()   — market data
//   render    → store.getRender()   — UI config + transient state
//   transport → store.getTransport()— connection state
//   workspace → store.getWorkspace()— layout profiles
//
// Existing flat access (state.symbol, state.settings.X, ...) still works.
// Domain accessors are the migration path toward architectural separation.

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
  var storesByRoot = typeof WeakMap === 'function' ? new WeakMap() : null;
  var fallbackStores = [];
  var crosshairsByRoot = typeof WeakMap === 'function' ? new WeakMap() : null;
  var fallbackCrosshairs = [];

  function resolveRoot(ref) {
    if (ref && ref.dataset && ref.dataset.v6Mounted === '1') return ref;
    if (ref && ref.closest) {
      var closest = ref.closest('[data-v6-mounted="1"]');
      if (closest) return closest;
    }
    return document.querySelector('[data-v6-mounted="1"]');
  }

  V6OF.register('Core', 'setRootStore', function (root, store) {
    if (!root || !store) return store;
    if (storesByRoot) {
      storesByRoot.set(root, store);
    } else {
      fallbackStores = fallbackStores.filter(function (entry) { return entry.root !== root; });
      fallbackStores.push({ root: root, store: store });
    }
    root._v6Store = store;
    return store;
  }, 'setRootStore');

  V6OF.register('Core', 'getStore', function (ref) {
    var root = resolveRoot(ref);
    if (!root) return null;
    if (storesByRoot) return storesByRoot.get(root) || root._v6Store || null;
    for (var i = fallbackStores.length - 1; i >= 0; i--) {
      if (fallbackStores[i].root === root) return fallbackStores[i].store;
    }
    return root._v6Store || null;
  }, 'getStore');

  V6OF.register('Core', 'clearRootStore', function (root) {
    if (!root) return;
    if (storesByRoot && storesByRoot.delete) storesByRoot.delete(root);
    fallbackStores = fallbackStores.filter(function (entry) { return entry.root !== root; });
    if (root._v6Store) delete root._v6Store;
  }, 'clearRootStore');

  function createCrosshairState() {
    return {
      enabled: true,
      visible: false,
      x: 0,
      y: 0,
      cy: null,
      hoveringSource: null, // 'chart' | 'cvd'
      time: null,
      price: null
    };
  }

  V6OF.register('Core', 'getChartCrosshair', function (ref) {
    var root = resolveRoot(ref);
    if (!root) {
      V6OF._fallbackChartCrosshair = V6OF._fallbackChartCrosshair || createCrosshairState();
      return V6OF._fallbackChartCrosshair;
    }
    if (crosshairsByRoot) {
      var cross = crosshairsByRoot.get(root) || root._v6ChartCrosshair || null;
      if (!cross) {
        cross = createCrosshairState();
        crosshairsByRoot.set(root, cross);
      }
      root._v6ChartCrosshair = cross;
      return cross;
    }
    for (var i = fallbackCrosshairs.length - 1; i >= 0; i--) {
      if (fallbackCrosshairs[i].root === root) return fallbackCrosshairs[i].crosshair;
    }
    var fallback = root._v6ChartCrosshair || createCrosshairState();
    fallbackCrosshairs.push({ root: root, crosshair: fallback });
    root._v6ChartCrosshair = fallback;
    return fallback;
  }, 'getChartCrosshair');

  V6OF.register('Core', 'clearChartCrosshair', function (root) {
    if (!root) return;
    if (crosshairsByRoot && crosshairsByRoot.delete) crosshairsByRoot.delete(root);
    fallbackCrosshairs = fallbackCrosshairs.filter(function (entry) { return entry.root !== root; });
    if (root._v6ChartCrosshair) delete root._v6ChartCrosshair;
  }, 'clearChartCrosshair');

  function cloneSettings(settings) {
    return Object.assign({}, settings || {});
  }

  function cloneUi(ui) {
    return Object.assign({}, ui || {});
  }

  function cloneObjectMap(value) {
    return Object.assign({}, value || {});
  }

  function normalizeState(next, prev) {
    var empty = V6OF.Contract.createEmptyState();
    next = next || {};
    if (!prev || next.settings !== prev.settings) {
      next.settings = Object.assign(empty.settings, cloneSettings(next.settings));
    } else {
      next.settings = prev.settings;
    }
    if (!prev || next.ui !== prev.ui) {
      next.ui = Object.assign(empty.ui, cloneUi(next.ui));
    } else {
      next.ui = prev.ui;
    }
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
    next.tradeHistoryCount = Number.isFinite(next.tradeHistoryCount) ? next.tradeHistoryCount : (next.trades ? next.trades.length : 0);
    next.deltaBucketHistoryCount = Number.isFinite(next.deltaBucketHistoryCount) ? next.deltaBucketHistoryCount : (next.deltaBuckets ? next.deltaBuckets.length : 0);
    next.vwap = next.vwap || null;
    next.vwapBySymbol = cloneObjectMap(next.vwapBySymbol || empty.vwapBySymbol);
    next.lastMessageAt = Number.isFinite(next.lastMessageAt) ? next.lastMessageAt : 0;
    next.isStale = !!next.isStale;
    next.activeWorkspace = next.activeWorkspace || empty.activeWorkspace;
    next.workspaceList = typeof next.workspaceList === 'object' && next.workspaceList ? next.workspaceList : {};
    next.contractVersion = next.contractVersion || empty.contractVersion;
    next.source = next.source || empty.source;
    next.dataFreshness = next.dataFreshness || empty.dataFreshness;
    next.transportStatus = next.transportStatus || empty.transportStatus;
    next.symbol = next.symbol || empty.symbol;
    next.timeframe = next.timeframe || empty.timeframe;
    next.depthHistory = Array.isArray(next.depthHistory) ? next.depthHistory : [];
    next.depthHistoryCount = Number.isFinite(next.depthHistoryCount) ? next.depthHistoryCount : next.depthHistory.length;
    return next;
  }

  function shallowEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
      return false;
    }
    var isArrayA = Array.isArray(a);
    var isArrayB = Array.isArray(b);
    if (isArrayA !== isArrayB) return false;
    if (isArrayA) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }
    var keysA = Object.keys(a);
    var keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (var j = 0; j < keysA.length; j++) {
      var key = keysA[j];
      if (!Object.prototype.hasOwnProperty.call(b, key) || a[key] !== b[key]) {
        return false;
      }
    }
    return true;
  }

  V6OF.register('Core', 'shallowEqual', shallowEqual, 'shallowEqual');

  // ── Slice map: every top-level state key belongs to exactly one domain slice ──
  var SLICE_MAP = {
    // trader
    symbol: 'trader', timeframe: 'trader', dataSource: 'trader',
    trades: 'trader', orderBook: 'trader', lastOrderBookBySymbol: 'trader',
    orderBookCount: 'trader', lastOrderBookTs: 'trader', selectedDomSymbol: 'trader',
    heatmapFrames: 'trader', heatmapFrameCount: 'trader', lastHeatmapFrame: 'trader',
    lastHeatmapTs: 'trader', selectedHeatmapSymbol: 'trader',
    footprintCandles: 'trader', footprintCandleCount: 'trader', lastFootprintCandle: 'trader',
    lastFootprintTs: 'trader', selectedFootprintSymbol: 'trader',
    candles: 'trader', chartCandles: 'trader', _candlesByInterval: 'trader',
    deltaBuckets: 'trader', deltaBucketsByInterval: 'trader', latestDeltaByInterval: 'trader',
    tradeHistoryCount: 'trader', deltaBucketHistoryCount: 'trader',
    vwap: 'trader', vwapBySymbol: 'trader',
    depthHistory: 'trader', depthHistoryCount: 'trader', restTradesTs: 'trader', restKlinesTs: 'trader', restDepthTs: 'trader',
    // render
    settings: 'render', ui: 'render',
    // transport
    source: 'transport', dataFreshness: 'transport', transportStatus: 'transport',
    engineConfigStatus: 'transport', engineConfigSyncedAt: 'transport',
    engineConfigStaleAt: 'transport', engineConfigError: 'transport',
    isStale: 'transport', lastMessageAt: 'transport',
    // workspace
    activeWorkspace: 'workspace', workspaceList: 'workspace',
    // meta (never triggers slice notifications)
    contractVersion: null, lastUpdateReason: null
  };

  function changedSlices(prev, next) {
    if (!prev) return ['trader', 'render', 'transport', 'workspace'];
    var set = {};
    for (var key in next) {
      if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
      if (next[key] !== prev[key]) {
        var s = SLICE_MAP[key];
        if (s) set[s] = true;
      }
    }
    var result = Object.keys(set);
    return result.length ? result : null; // null = no slices changed
  }

  V6OF.register('Core', 'createStore', function (initialState) {
    var state = normalizeState(initialState || V6OF.Contract.createEmptyState());
    var listeners = [];

    function notify(changed) {
      // changed: array of slice names that were modified, or null/falsy = notify all
      var snapshot = listeners.slice();
      for (var i = 0; i < snapshot.length; i++) {
        var entry = snapshot[i];
        // Skip if this listener has slice constraints and none match
        if (entry.slices && changed) {
          var match = false;
          for (var j = 0; j < changed.length; j++) {
            if (entry.slices.indexOf(changed[j]) >= 0) { match = true; break; }
          }
          if (!match) continue;
        }
        // Selector check (legacy)
        if (entry.needsSelectorCheck) {
          var selected;
          try { selected = entry.selector(state); } catch (err) {
            console.error('[V6OF] selector failed', err);
            continue;
          }
          if (entry.hasLast && shallowEqual(entry.lastSelected, selected)) continue;
          entry.lastSelected = selected;
          entry.hasLast = true;
        }
        try { entry.fn(state); } catch (err) { console.error('[V6OF] store listener failed', err); }
      }
    }

    return {
      getState: function () {
        return state;
      },
      setState: function (patch, reason) {
        var prev = state;
        var next = typeof patch === 'function' ? patch(state) : patch;
        if (!next) return state;
        state = normalizeState(Object.assign({}, state, next), state);
        state._stateVersion = (state._stateVersion || 0) + 1;
        state.lastUpdateReason = reason || 'setState';
        notify(changedSlices(prev, state));
        return state;
      },

      // ── Targeted slice updates (only notify that slice's subscribers) ──
      updateSlice: function (sliceName, patch) {
        var prev = state;
        if (sliceName === 'render') {
          // render = settings + ui merged
          state = normalizeState(Object.assign({}, state, {
            settings: Object.assign({}, state.settings, (patch && patch.settings) || {}),
            ui: Object.assign({}, state.ui, (patch && patch.ui) || {})
          }), state);
        } else if (sliceName === 'trader') {
          state = normalizeState(Object.assign({}, state, patch || {}), state);
        } else if (sliceName === 'transport') {
          state = normalizeState(Object.assign({}, state, patch || {}), state);
        } else if (sliceName === 'workspace') {
          state = normalizeState(Object.assign({}, state, patch || {}), state);
        } else {
          // Unknown slice — fall back to broad update
          return this.setState(patch, 'slice-' + sliceName);
        }
        state.lastUpdateReason = 'slice-' + sliceName;
        state._stateVersion = (state._stateVersion || 0) + 1;
        notify([sliceName]);
        return state;
      },

      updateSettings: function (patch) {
        this.updateSlice('render', { settings: patch || {} });
      },
      updateUi: function (patch) {
        this.updateSlice('render', { ui: patch || {} });
      },
      clearHeatmap: function () {
        this.updateSlice('trader', {
          heatmapFrames: [],
          lastHeatmapFrame: null,
          lastHeatmapTs: 0
        });
      },
      clearFootprint: function () {
        this.updateSlice('trader', {
          footprintCandles: [],
          lastFootprintCandle: null,
          lastFootprintTs: 0
        });
      },
      clearAllBuffers: function () {
        this.updateSlice('trader', {
          trades: [],
          heatmapFrames: [],
          lastHeatmapFrame: null,
          lastHeatmapTs: 0,
          footprintCandles: [],
          lastFootprintCandle: null,
          lastFootprintTs: 0
        });
      },

      // ── Subscribe: backward-compatible, now slice-aware ──
      // subscribe(fn)              → broad (all changes)
      // subscribe(fn, selectorFn) → selector-filtered (legacy)
      // subscribe(fn, 'trader')    → only notified on trader slice changes
      // subscribe(fn, ['trader','transport']) → multi-slice
      subscribe: function (fn, opts) {
        if (typeof fn !== 'function') return function () {};
        var entry = { fn: fn };
        if (typeof opts === 'function') {
          // Legacy selector mode
          entry.selector = opts;
          entry.needsSelectorCheck = true;
          entry.hasLast = false;
          entry.lastSelected = undefined;
        } else if (typeof opts === 'string') {
          entry.slices = [opts];
        } else if (Array.isArray(opts)) {
          entry.slices = opts.slice();
        }
        // else: opts is undefined/falsy → broad subscription
        listeners.push(entry);
        return function () {
          listeners = listeners.filter(function (item) { return item !== entry; });
        };
      },

      // ── Domain accessors ──
      getTrader: function () {
        return V6OF.Contract.getTraderState(state);
      },
      getRender: function () {
        return V6OF.Contract.getRenderState(state);
      },
      getTransport: function () {
        return V6OF.Contract.getTransportState(state);
      },
      getWorkspace: function () {
        return V6OF.Contract.getWorkspaceState(state);
      }
    };
  }, 'createStore');
})();
