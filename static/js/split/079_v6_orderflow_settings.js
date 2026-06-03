// ---------- 079_v6_orderflow_settings.js ----------
// Phase 15: localStorage persistence for V6 orderflow settings.
// Key: cockpitV6.orderflow.settings
// No SQLite. No Flask routes. UI-only.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var STORAGE_KEY = 'cockpitV6.orderflow.settings';

  var DEFAULT_DOM_COLUMNS = ['bid', 'price', 'ask', 'buy', 'sell', 'delta'];
  var VALID_DOM_KEYS = { vol: 1, sell: 1, buy: 1, bid: 1, price: 1, ask: 1, delta: 1 };

  var DEFAULTS = {
    chartMode: 'both',
    showTape: true,
    showDOM: true,
    showCVD: true,
    showVwap: false,
    showCandles: true,
    showBubbles: false,
    showHeatmap: false,
    showFootprint: false,
    maxTrades: 5000,
    heatmapMaxFrames: 360,
    footprintMaxCandles: 120,
    domDepth: 20,
    domRangeLevels: 100,
    domWallsOnly: false,
    domWallRatio: 4,
    domGroup: 1,
    domColumns: DEFAULT_DOM_COLUMNS.slice(),
    minQty: 0,
    maxRows: 42,
    tapeFontSize: 10,
    deltaIntervalMs: 60000,
    tickSize: 1,
    showLastPrice: true,
    showGrid: true,
    bgColor: '#080b12',
    upColor: '#3ddc97',
    downColor: '#ff5f73'
  };

  var VALID_CHART_MODES = { heatmap: 1, footprint: 1, both: 1, none: 1 };

  function clampInt(value, min, max, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function validateSettings(raw) {
    if (!raw || typeof raw !== 'object') return Object.assign({}, DEFAULTS);
    var out = {};
    out.chartMode = VALID_CHART_MODES[raw.chartMode] ? raw.chartMode : DEFAULTS.chartMode;
    out.showTape = typeof raw.showTape === 'boolean' ? raw.showTape : DEFAULTS.showTape;
    out.showDOM = typeof raw.showDOM === 'boolean' ? raw.showDOM : DEFAULTS.showDOM;
    out.showCVD = typeof raw.showCVD === 'boolean' ? raw.showCVD : DEFAULTS.showCVD;
    out.showVwap = typeof raw.showVwap === 'boolean' ? raw.showVwap : DEFAULTS.showVwap;
    out.showCandles = typeof raw.showCandles === 'boolean' ? raw.showCandles : DEFAULTS.showCandles;
    out.showBubbles = typeof raw.showBubbles === 'boolean' ? raw.showBubbles : DEFAULTS.showBubbles;
    out.showHeatmap = typeof raw.showHeatmap === 'boolean' ? raw.showHeatmap : DEFAULTS.showHeatmap;
    out.showFootprint = typeof raw.showFootprint === 'boolean' ? raw.showFootprint : DEFAULTS.showFootprint;
    out.showLastPrice = typeof raw.showLastPrice === 'boolean' ? raw.showLastPrice : DEFAULTS.showLastPrice;
    out.showGrid = typeof raw.showGrid === 'boolean' ? raw.showGrid : DEFAULTS.showGrid;
    out.bgColor = typeof raw.bgColor === 'string' ? raw.bgColor : DEFAULTS.bgColor;
    out.upColor = typeof raw.upColor === 'string' ? raw.upColor : DEFAULTS.upColor;
    out.downColor = typeof raw.downColor === 'string' ? raw.downColor : DEFAULTS.downColor;
    out.maxTrades = clampInt(raw.maxTrades, 50, 5000, DEFAULTS.maxTrades);
    out.heatmapMaxFrames = clampInt(raw.heatmapMaxFrames, 60, 600, DEFAULTS.heatmapMaxFrames);
    out.footprintMaxCandles = clampInt(raw.footprintMaxCandles, 30, 240, DEFAULTS.footprintMaxCandles);
    out.domDepth = clampInt(raw.domDepth, 5, 50, DEFAULTS.domDepth);
    out.domRangeLevels = clampInt(raw.domRangeLevels, 25, 500, DEFAULTS.domRangeLevels);
    out.domWallsOnly = typeof raw.domWallsOnly === 'boolean' ? raw.domWallsOnly : DEFAULTS.domWallsOnly;
    out.domWallRatio = clampInt(raw.domWallRatio, 2, 12, DEFAULTS.domWallRatio);
    out.domGroup = clampInt(raw.domGroup, 1, 100, DEFAULTS.domGroup);
    // Validate domColumns: must be a non-empty array of unique valid keys.
    if (Array.isArray(raw.domColumns) && raw.domColumns.length > 0) {
      var seen = {};
      var validCols = [];
      raw.domColumns.forEach(function (k) {
        if (VALID_DOM_KEYS[k] && !seen[k]) {
          seen[k] = true;
          validCols.push(k);
        }
      });
      if (validCols.length > 0) {
        out.domColumns = validCols;
      } else {
        out.domColumns = DEFAULT_DOM_COLUMNS.slice();
      }
    } else {
      out.domColumns = DEFAULT_DOM_COLUMNS.slice();
    }
    out.minQty = Math.max(0, Number(raw.minQty) || 0);
    out.maxRows = clampInt(raw.maxRows, 8, 500, DEFAULTS.maxRows);
    out.tapeFontSize = clampInt(raw.tapeFontSize, 8, 20, DEFAULTS.tapeFontSize);
    out.deltaIntervalMs = Number(raw.deltaIntervalMs) || DEFAULTS.deltaIntervalMs;
    out.tickSize = Math.max(0.01, Number(raw.tickSize) || DEFAULTS.tickSize);
    return out;
  }

  function load() {
    try {
      var json = localStorage.getItem(STORAGE_KEY);
      if (!json) return Object.assign({}, DEFAULTS);
      var parsed = JSON.parse(json);
      return validateSettings(parsed);
    } catch (err) {
      console.warn('[V6OF Settings] invalid localStorage, using defaults', err);
      return Object.assign({}, DEFAULTS);
    }
  }

  function save(settings) {
    try {
      var validated = validateSettings(settings);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
    } catch (err) {
      console.warn('[V6OF Settings] failed to save to localStorage', err);
    }
  }

  function reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) { /* ignore */ }
    return Object.assign({}, DEFAULTS);
  }

  function bindStore(store) {
    if (!store) return;
    var lastJson = '';
    store.subscribe(function (state) {
      if (!state || !state.settings) return;
      var json = JSON.stringify(validateSettings(state.settings));
      if (json !== lastJson) {
        lastJson = json;
        save(state.settings);
      }
    });
  }

  V6OF.Settings = {
    DEFAULTS: DEFAULTS,
    load: load,
    save: save,
    reset: reset,
    validate: validateSettings,
    bindStore: bindStore
  };
})();
