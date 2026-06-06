// ---------- 079_v6_orderflow_settings.js ----------
// Phase 15: localStorage persistence for V6 orderflow settings.
// Key: cockpitV6.orderflow.settings
// No SQLite. No Flask routes. UI-only.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var STORAGE_KEY = 'cockpitV6.orderflow.settings';
  var SETTINGS_SCHEMA_VERSION = 1;

  var DEFAULT_DOM_COLUMNS = ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs'];
  var VALID_DOM_KEYS = { vol: 1, sell: 1, buy: 1, bid: 1, price: 1, ask: 1, delta: 1, imb: 1, stack: 1, abs: 1 };

  var DEFAULTS = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
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
    heatmapMaxFrames: 3600,
    footprintMaxCandles: 1200,
    domDepth: 1000,
    domRangeLevels: 1000,
    domWallsOnly: false,
    domWallRatio: 4,
    domMinNotionalUsd: 100,
    domFollowThresholdTicks: 1,
    domScaleMode: 'book',
    domValueMode: 'coin',
    domGroup: 1,
    domColumns: DEFAULT_DOM_COLUMNS.slice(),
    minQty: 0,
    maxRows: 420,
    restTradePrefillLimit: 500,
    tapeFontSize: 10,
    deltaIntervalMs: 60000,
    tickSize: 1,
    showLastPrice: true,
    showGrid: true,
    bgColor: '#ffffff',
    upColor: '#089981',
    downColor: '#f23645',
    theme: 'light-tv',
    indicators: [],
    indicatorSources: [],
    activeTab: 'dom',
    dockCollapsed: false,
    cvdCollapsed: false,
    showFootprintVA: true,
    showVwapBands: false,
    vwapBand1: 1.0,
    vwapBand2: 2.0,
    alertsEnabled: false,
    largeTradeAlertQty: 10,
    deltaAlertThreshold: 100,
    imbalanceRatio: 3.0,
    imbalanceStack: 3,
    minWickTicks: 0
  };

  var VALID_CHART_MODES = { heatmap: 1, footprint: 1, both: 1, none: 1 };
  // DOM bid/ask value display modes. 'usd' is the legacy alias of 'notional'.
  var VALID_VALUE_MODES = { coin: 1, notional: 1, contracts: 1, ticks: 1 };
  var VALID_THEMES = { 'light-tv': 1, 'dark-tv': 1 };

  function clampInt(value, min, max, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function validateSettings(raw) {
    if (!raw || typeof raw !== 'object') return Object.assign({}, DEFAULTS);
    var out = {};
    out.schemaVersion = SETTINGS_SCHEMA_VERSION;
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
    out.theme = VALID_THEMES[raw.theme] ? raw.theme : DEFAULTS.theme;
    out.bgColor = typeof raw.bgColor === 'string' ? raw.bgColor : DEFAULTS.bgColor;
    out.upColor = typeof raw.upColor === 'string' ? raw.upColor : DEFAULTS.upColor;
    out.downColor = typeof raw.downColor === 'string' ? raw.downColor : DEFAULTS.downColor;
    if (out.theme === 'light-tv') {
      if (out.bgColor === '#080b12' || out.bgColor === '#131722') out.bgColor = DEFAULTS.bgColor;
      if (out.upColor === '#3ddc97' || out.upColor === '#00b0ff') out.upColor = DEFAULTS.upColor;
      if (out.downColor === '#ff5f73' || out.downColor === '#000000') out.downColor = DEFAULTS.downColor;
    }
    out.maxTrades = clampInt(raw.maxTrades, 50, 5000, DEFAULTS.maxTrades);
    out.heatmapMaxFrames = clampInt(raw.heatmapMaxFrames, 60, 10000, DEFAULTS.heatmapMaxFrames);
    out.footprintMaxCandles = clampInt(raw.footprintMaxCandles, 30, 3000, DEFAULTS.footprintMaxCandles);
    out.domDepth = clampInt(raw.domDepth, 5, 5000, DEFAULTS.domDepth);
    out.domRangeLevels = clampInt(raw.domRangeLevels, 250, 5000, DEFAULTS.domRangeLevels);
    out.domWallsOnly = typeof raw.domWallsOnly === 'boolean' ? raw.domWallsOnly : DEFAULTS.domWallsOnly;
    out.domWallRatio = clampInt(raw.domWallRatio, 2, 12, DEFAULTS.domWallRatio);
    out.domMinNotionalUsd = Math.max(0, Math.min(10000000, Number(raw.domMinNotionalUsd) || DEFAULTS.domMinNotionalUsd));
    out.domFollowThresholdTicks = clampInt(raw.domFollowThresholdTicks, 1, 20, DEFAULTS.domFollowThresholdTicks);
    out.domScaleMode = raw.domScaleMode === 'visible' ? 'visible' : DEFAULTS.domScaleMode;
    out.domGroup = clampInt(raw.domGroup, 1, 100, DEFAULTS.domGroup);
    var rawValueMode = raw.domValueMode === 'usd' ? 'notional' : raw.domValueMode;
    out.domValueMode = VALID_VALUE_MODES[rawValueMode] ? rawValueMode : DEFAULTS.domValueMode;
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
    out.maxRows = clampInt(raw.maxRows, 8, 5000, DEFAULTS.maxRows);
    out.restTradePrefillLimit = clampInt(raw.restTradePrefillLimit, 50, 5000, DEFAULTS.restTradePrefillLimit);
    out.tapeFontSize = clampInt(raw.tapeFontSize, 8, 20, DEFAULTS.tapeFontSize);
    out.deltaIntervalMs = Number(raw.deltaIntervalMs) || DEFAULTS.deltaIntervalMs;
    out.tickSize = Math.max(0.01, Number(raw.tickSize) || DEFAULTS.tickSize);
    out.activeTab = typeof raw.activeTab === 'string' ? raw.activeTab : DEFAULTS.activeTab;
    out.dockCollapsed = typeof raw.dockCollapsed === 'boolean' ? raw.dockCollapsed : DEFAULTS.dockCollapsed;
    out.cvdCollapsed = typeof raw.cvdCollapsed === 'boolean' ? raw.cvdCollapsed : DEFAULTS.cvdCollapsed;
    out.showFootprintVA = typeof raw.showFootprintVA === 'boolean' ? raw.showFootprintVA : DEFAULTS.showFootprintVA;
    out.showVwapBands = typeof raw.showVwapBands === 'boolean' ? raw.showVwapBands : DEFAULTS.showVwapBands;
    out.vwapBand1 = Math.max(0.1, Math.min(5, Number(raw.vwapBand1) || DEFAULTS.vwapBand1));
    out.vwapBand2 = Math.max(out.vwapBand1, Math.min(8, Number(raw.vwapBand2) || DEFAULTS.vwapBand2));
    out.alertsEnabled = typeof raw.alertsEnabled === 'boolean' ? raw.alertsEnabled : DEFAULTS.alertsEnabled;
    out.largeTradeAlertQty = Math.max(0, Math.min(1000000, Number(raw.largeTradeAlertQty) || DEFAULTS.largeTradeAlertQty));
    out.deltaAlertThreshold = Math.max(0, Math.min(10000000, Number(raw.deltaAlertThreshold) || DEFAULTS.deltaAlertThreshold));
    out.imbalanceRatio = Math.max(1.5, Math.min(8.0, Number(raw.imbalanceRatio) || DEFAULTS.imbalanceRatio));
    out.imbalanceStack = clampInt(raw.imbalanceStack, 2, 6, DEFAULTS.imbalanceStack);
    out.minWickTicks = clampInt(raw.minWickTicks, 0, 10, DEFAULTS.minWickTicks);
    out.indicatorSources = sanitizeIndicatorSources(raw.indicatorSources);
    out.indicators = sanitizeIndicators(raw.indicators, out.indicatorSources);
    return out;
  }

  function sanitizeIndicatorSources(rawSources) {
    if (!Array.isArray(rawSources)) return DEFAULTS.indicatorSources.slice();
    var seen = {};
    var out = [];
    rawSources.forEach(function (src) {
      if (!src || typeof src !== 'object') return;
      var sourceId = typeof src.sourceId === 'string' ? src.sourceId.trim() : '';
      var code = typeof src.code === 'string' ? src.code : '';
      if (!sourceId || !code || seen[sourceId]) return;
      seen[sourceId] = true;
      out.push({
        sourceId: sourceId.slice(0, 80),
        name: (typeof src.name === 'string' && src.name.trim() ? src.name.trim() : sourceId).slice(0, 80),
        code: code.slice(0, 200000),
        updatedAt: Number(src.updatedAt) || Date.now()
      });
    });
    return out;
  }

  function sanitizeIndicators(rawIndicators, sources) {
    if (!Array.isArray(rawIndicators)) return DEFAULTS.indicators.slice();
    var sourceMap = {};
    (sources || []).forEach(function (src) { sourceMap[src.sourceId] = 1; });
    var seen = {};
    var out = [];
    rawIndicators.forEach(function (inst) {
      if (!inst || typeof inst !== 'object') return;
      var instanceId = typeof inst.instanceId === 'string' ? inst.instanceId.trim() : '';
      var sourceId = typeof inst.sourceId === 'string' ? inst.sourceId.trim() : '';
      if (!instanceId || !sourceId || !sourceMap[sourceId] || seen[instanceId]) return;
      seen[instanceId] = true;
      out.push({
        instanceId: instanceId.slice(0, 80),
        sourceId: sourceId.slice(0, 80),
        name: (typeof inst.name === 'string' && inst.name.trim() ? inst.name.trim() : sourceId).slice(0, 80),
        pane: inst.pane === 'separate' ? 'separate' : 'overlay',
        visible: inst.visible !== false,
        inputs: inst.inputs && typeof inst.inputs === 'object' ? Object.assign({}, inst.inputs) : {},
        style: inst.style && typeof inst.style === 'object' ? Object.assign({}, inst.style) : {},
        height: clampInt(inst.height, 56, 280, 112),
        locked: inst.locked === true
      });
    });
    return out;
  }

  function load() {
    try {
      var json = localStorage.getItem(STORAGE_KEY);
      if (!json) return Object.assign({}, DEFAULTS);
      var parsed = JSON.parse(json);
      var validated = validateSettings(parsed);
      if (parsed.schemaVersion !== SETTINGS_SCHEMA_VERSION) save(validated);
      return validated;
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
    }, function (state) {
      return state ? state.settings : null;
    });
  }

  V6OF.Settings = {
    SCHEMA_VERSION: SETTINGS_SCHEMA_VERSION,
    DEFAULTS: DEFAULTS,
    load: load,
    save: save,
    reset: reset,
    validate: validateSettings,
    bindStore: bindStore
  };
})();
